/**
 * Scan Endpoint — Multi-Layer OCR + Background Agent Enrichment
 *
 * 1. Receives image via multipart form
 * 2. Runs multi-layer OCR pipeline (Tesseract.js → Sharp → Python → AI Vision)
 * 3. Saves results immediately via SSE streaming
 * 4. Queues background agent enrichment (non-blocking)
 */

import { NextRequest } from 'next/server';
import { logger } from '@/lib/logger';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/options';
import { db, storage } from '@/lib/storage';
import { db as mongodb } from '@/lib/mongodb';
import { enqueueAndProcessInBackground } from '@/lib/agent/queue';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { logError } from '@/lib/error-handler';
import { sanitizeErrorMessage } from '@/lib/utils';
import { requireCsrf } from '@/lib/csrf';
import { RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS, MAX_IMAGE_SIZE } from '@/lib/config';
import type { MenuItem } from '@/types/menu';
import type { OCRItem } from '@/lib/ocr/engine';

function sseEncode(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const ip = getClientIp(request);

    // CSRF validation — requires the X-CSRF-Token header to match the
    // csrf_secret cookie (generated via /api/csrf/token on page load).
    const csrfError = requireCsrf(request);
    if (csrfError) {
      return new Response(sseEncode('error', { message: 'Invalid or missing CSRF token' }), {
        status: 403,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }

    if (!checkRateLimit(ip, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)) {
      return new Response(sseEncode('error', { message: 'Too many scans. Wait a minute and try again.' }), {
        status: 429,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }

    const formData = await request.formData();
    const imageFile = formData.get('image');

    if (!imageFile || !(imageFile instanceof File)) {
      return new Response(sseEncode('error', { message: 'Image file is required' }), {
        status: 400,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }

    if (imageFile.size > MAX_IMAGE_SIZE) {
      return new Response(sseEncode('error', { message: 'Image too large. Maximum size is 10MB.' }), {
        status: 413,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }

    const arrayBuffer = await imageFile.arrayBuffer();
    const userId = ((session?.user as Record<string, unknown>)?.id as string) || 'anonymous';

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        // Stop streaming (and let the pipeline unwind) when the client
        // disconnects or aborts — previously the route kept enqueueing into a
        // closed controller and even persisted the scan after the user saw an error.
        const onAbort = () => {
          try { controller.close(); } catch { /* already closed */ }
        };
        request.signal?.addEventListener('abort', onAbort, { once: true });

const send = (event: string, data: unknown) => {
           try { controller.enqueue(encoder.encode(sseEncode(event, data))); } catch (e) { logger.warn(`[Scan] SSE send failed: ${e}`); }
         };

        try {
          send('status', { status: 'uploading', progress: 5, message: 'Image received' });

           // ── Step 1: Run OCR pipeline ──
           send('status', { status: 'ocr_started', progress: 10, message: 'Starting OCR analysis…' });

           const mode = request.nextUrl.searchParams.get('mode');
           let ocrResult;
           if (mode === 'offline') {
             const { runOfflineOCRPipeline } = require('@/lib/ocr/local');
             ocrResult = await runOfflineOCRPipeline(arrayBuffer, send);
           } else {
             const { runOCRPipeline } = require('@/lib/ocr/engine');
             ocrResult = await runOCRPipeline(arrayBuffer, send);
           }

          if (!ocrResult.items || ocrResult.items.length === 0) {
            send('error', { message: 'Could not identify any dishes from this image. Try a clearer photo.' });
            controller.close();
            return;
          }

          send('status', {
            status: 'ocr_complete',
            progress: 50,
            message: `Found ${ocrResult.items.length} items via ${ocrResult.layer}`,
            layer: ocrResult.layer,
            confidence: ocrResult.confidence,
          });

          // ── Step 2: Save to DB ──
          let scanId = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
          let items: MenuItem[] = [];

          try {
            const result = await storage.saveScan(userId, '', ocrResult.raw_text, ocrResult.items);
            if (result?.insertedId) {
              scanId = result.insertedId;
            }
            // Mark the scan as processing so the results page keeps polling
            // (every 4s) until the background enrichment finishes — otherwise
            // saveScan's default 'completed' status makes the page fetch once
            // and never refresh, so images/tags appear only on manual reload.
            try {
              mongodb('scans').updateOne({ id: scanId }, { $set: { status: 'processing' } });
            } catch { /* non-fatal */ }

            // Items keep a stable `id` (used by the client and the SSE payload);
            // ids derive from the FINAL scan id so they can't drift from the scan.
            items = ocrResult.items.map((item: OCRItem, index: number) => ({
              id: `${scanId}-${index}-${Date.now().toString(36)}`,
              name: item.name,
              description: item.description || '',
              price: item.price,
              category: item.category || 'other',
              image_url: '',
              confidence: item.confidence || 0.8,
              scan_id: scanId,
              created_at: new Date().toISOString(),
            }));

            // Persist dish docs in ONE batched write (previously N full-file
            // rewrites via insertOne). Stored docs carry `_id` ONLY per the
            // storage convention (AGENTS.md rule 5) — `{ id }` queries work via
            // the mongodb._match() alias; /api/scan/[id] normalizes _id → id.
            const dishDocs = items.map(({ id, ...rest }) => ({ _id: id, ...rest }));
            mongodb('dishes').insertMany(dishDocs);
          } catch (err: any) {
            logger.warn(`Failed to persist scan, continuing without DB: ${err.message}`);
          }

          send('status', {
            status: 'saved',
            progress: 60,
            message: `Saved ${items.length} dishes`,
          });

          // ── Step 3: Queue background agent enrichment ──
          send('status', {
            status: 'enrichment_queued',
            progress: 70,
            message: 'Background enrichment queued — results will update automatically',
          });

          // Fire-and-forget enrichment (non-blocking)
          const menuItems = ocrResult.items.map((i: OCRItem) => ({
            name: i.name,
            description: i.description,
            price: i.price,
            category: i.category,
          }));

          // Don't await — fire and forget after response
          enqueueAndProcessInBackground(scanId, menuItems).catch((err: Error) => {
            logger.warn(`Background enrichment launch failed: ${err.message}`);
          });

          // ── Step 4: Send complete ──
          send('complete', {
            scan_id: scanId,
            items,
            total_items: items.length,
            ocr_layer: ocrResult.layer,
            ocr_confidence: ocrResult.confidence,
            menu_name: ocrResult.menu_name || '',
            enriched: false,
            message: `Menu scanned with ${items.length} items via ${ocrResult.layer}`,
          });

        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : 'Failed to process menu';
          logger.error({ message, error: String(error) });
          logError(error, { endpoint: '/api/scan/new/stream', ip });
          try { send('error', { message: sanitizeErrorMessage(error) }); } catch (e) { logger.warn(`[Scan] SSE send failed: ${e}`); }
} finally {
           try { controller.close(); } catch (e) { logger.warn(`[Scan] Controller close failed: ${e}`); }
         }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to process menu';
    logger.error({ message, error: String(error) });
    logError(error, { endpoint: '/api/scan/new' });
    return new Response(sseEncode('error', { message: sanitizeErrorMessage(error) }), {
      status: 500,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }
}
