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
import { getDatabase } from '@/lib/mongodb';
import { enqueueAndProcessInBackground } from '@/lib/agent/queue';
import type { MenuItem } from '@/types/menu';
import type { OCRItem } from '@/lib/ocr/engine';

const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW = 60 * 1000;

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}

async function checkRateLimit(ip: string): Promise<boolean> {
  try {
    const now = Date.now();
    const windowStart = new Date(now - RATE_LIMIT_WINDOW);
    const database = await getDatabase();
    const rateLimits = database.collection('rate_limits');

    const result = await rateLimits.findOneAndUpdate(
      { ip, created_at: { $gte: windowStart.toISOString() } },
      { $inc: { count: 1 }, $setOnInsert: { created_at: new Date().toISOString(), expires_at: new Date(now + RATE_LIMIT_WINDOW).toISOString() } },
      { upsert: true, returnDocument: 'after' }
    );

    if (!result?.value) return true;
    return (result.value.count || 0) <= RATE_LIMIT_MAX;
  } catch {
    return true;
  }
}

function sseEncode(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const ip = getClientIp(request);

    if (!(await checkRateLimit(ip))) {
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

    const arrayBuffer = await imageFile.arrayBuffer();
    const userId = ((session?.user as Record<string, unknown>)?.id as string) || 'anonymous';

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const send = (event: string, data: unknown) => {
          try { controller.enqueue(encoder.encode(sseEncode(event, data))); } catch {}
        };

        try {
          send('status', { status: 'uploading', progress: 5, message: 'Image received' });

          // ── Step 1: Run OCR pipeline ──
          send('status', { status: 'ocr_started', progress: 10, message: 'Starting OCR analysis...' });

          const { runOCRPipeline } = require('@/lib/ocr/engine');
          const ocrResult = await runOCRPipeline(arrayBuffer, send);

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
          let scanId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

          try {
            const result = await storage.saveScan(userId, '', ocrResult.raw_text, ocrResult.items);
            if (result?.insertedId) {
              scanId = result.insertedId;
            }
          } catch {
            logger.warn('Failed to persist scan, continuing without DB');
          }

          // Create items
          const items: MenuItem[] = ocrResult.items.map((item: OCRItem, index: number) => ({
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

          // Persist dishes
          try {
            const database = await getDatabase();
            await database.collection('dishes').insertMany(items);
          } catch {
            logger.warn('Failed to persist dishes, continuing without DB');
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
          try { send('error', { message }); } catch {}
        } finally {
          try { controller.close(); } catch {}
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
    return new Response(sseEncode('error', { message }), {
      status: 500,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }
}
