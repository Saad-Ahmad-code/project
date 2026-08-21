/**
 * Dish Image Classification API
 *
 * POST /api/classify
 *   FormData: { image: File }
 *   Returns: { dishes: [{ name: string, confidence: number }] }
 *
 * Calls a PyTorch ResNet18 classifier running in the project .venv.
 */

import { NextRequest } from 'next/server';
import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import { logger } from '@/lib/logger';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { logError } from '@/lib/error-handler';
import { sanitizeErrorMessage } from '@/lib/utils';
import { requireCsrf } from '@/lib/csrf';
import { resolvePythonCmd } from '@/lib/ocr/candidates';

const SCRIPT = path.resolve(process.cwd(), 'src/scripts/food_classifier.py');
const TMP_DIR = path.resolve(process.cwd(), '.tmp');

export async function POST(request: NextRequest) {
  try {
    const csrfError = requireCsrf(request);
    if (csrfError) return csrfError;

    if (!checkRateLimit(getClientIp(request))) {
      return Response.json({ error: 'Too many requests. Wait a minute and try again.', dishes: [] }, { status: 429 });
    }

    const formData = await request.formData();
    const file = formData.get('image') as File | null;

    if (!file) {
      return Response.json({ error: 'image file is required', dishes: [] }, { status: 400 });
    }

    // Save uploaded file to temp
    if (!fs.existsSync(TMP_DIR)) {
      fs.mkdirSync(TMP_DIR, { recursive: true });
    }

    const ext = file.name?.split('.').pop() || 'jpg';
    const tmpPath = path.join(TMP_DIR, `classify_${Date.now()}.${ext}`);
    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(tmpPath, buffer);

    // Run classifier (async)
    const output = await new Promise<string>((resolve, reject) => {
      execFile(
        resolvePythonCmd(),
        [SCRIPT, tmpPath],
        {
          encoding: 'utf-8',
          timeout: 30000,
          env: { ...process.env, PYTHONPATH: '' },
        },
        (error, stdout, stderr) => {
          if (error) reject(error);
          else resolve(stdout);
        }
      );
    });

    // Clean up temp file
    try { fs.unlinkSync(tmpPath); } catch {}

    const result = JSON.parse(output.trim());

    if (result.error) {
      return Response.json({ error: result.error, dishes: [] }, { status: 500 });
    }

    return Response.json({ dishes: result.dishes || [] });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[Classify] API error: ${message}`);
    logError(error, { endpoint: "/api/classify" });
    return Response.json({ error: sanitizeErrorMessage(error), dishes: [] }, { status: 500 });
  }
}
