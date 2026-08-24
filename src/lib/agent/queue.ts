/**
 * Background Agent Job Queue
 *
 * Manages background enrichment jobs for scanned menus.
 * Jobs are stored in local JSON DB and processed asynchronously.
 *
 * Flow:
 *   1. Scan completes → job added to queue (status: "queued")
 *   2. Agent processes job → dish research + image search
 *   3. Scan record updated with enriched data
 *   4. Job marked "completed", "failed", or moved to the dead-letter queue
 *
 * Reliability:
 *   - Retries use EXPONENTIAL BACKOFF (retry_at = now + base * 2^attempt),
 *     so a temporarily-down AI provider isn't hammered every poll cycle.
 *   - Jobs that exhaust their retries move to the `agent_log_dlq` collection
 *     with the full error, scan_id, dish names, and per-dish outcomes, so
 *     failures are inspectable and re-runnable via the admin retry endpoint.
 *   - Per-dish errors are recorded on the job (dish_errors) so partial
 *     enrichment results aren't lost when one dish's research fails.
 */

import { logger } from '@/lib/logger';
import { db } from '@/lib/storage';
import { runAgent } from '@/lib/agent';
import { generateDishDetails } from '@/lib/agent/dish-details';
import type { MenuItemInput } from '@/lib/agent';
import {
  WORKER_POLL_MS,
  WORKER_MAX_CONCURRENT,
  AGENT_MAX_RETRIES,
  AGENT_RETRY_BASE_DELAY_MS,
  PREWARM_DISH_LIMIT,
} from '@/lib/config';
import type { AgentJobDoc, ScanDoc, DishDoc, AgentLogDlqDoc } from '@/lib/db-types';

// ── Types ──

export interface AgentJob extends AgentJobDoc {
  /** Back-compat: jobs persisted before _id-only storage carry an explicit
   *  `id` field; `_id` is always present. Use jobId(job) to resolve. */
  id?: string;
}

/** Resolve the stable identifier for a job (prefers the explicit id field
 *  for legacy docs, falls back to _id for _id-only docs). */
function jobId(job: AgentJob): string {
  return job.id || job._id;
}

/** Normalize jobs read from the DB so `job.id` always resolves. */
function normalizeJob(job: AgentJobDoc): AgentJob {
  return { ...job, id: job.id || job._id };
}

// ── Create a job ──

export function createJob(scanId: string, itemsCount: number): AgentJob {
  const now = new Date().toISOString();
  const job: AgentJob = {
    _id: `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    scan_id: scanId,
    status: 'queued',
    items_count: itemsCount,
    created_at: now,
    updated_at: now,
    retries: 0,
    max_retries: AGENT_MAX_RETRIES,
  };

  try {
    // Persist _id-only (AGENTS.md rule 5): no parallel `id` field.
    const { id: _omitId, ...doc } = job;
    db.create('agent_log', doc);
    logger.info(`[AgentQueue] Job ${job._id} created for scan ${scanId}`);
  } catch (err: any) {
    logger.warn(`[AgentQueue] Failed to persist job: ${err.message}`);
  }

  return job;
}

// ── Get next pending job ──

export function getNextJob(): AgentJob | null {
  try {
    // Query by status — NOT findAll(), whose default limit=50 hides every
    // job past the first 50 docs once early jobs complete (the bug that left
    // dozens of scans stuck "processing").
    const pending = db.findBy<AgentJobDoc>('agent_log', { status: 'queued' });
    const now = Date.now();
    const ready = pending
      .filter(j => !j.retry_at || new Date(j.retry_at).getTime() <= now)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    return ready[0] ? normalizeJob(ready[0]) : null;
  } catch (err: any) {
    logger.warn(`[AgentQueue] getNextJob failed: ${err.message}`);
    return null;
  }
}

// ── Get job by scan ID ──

export function getJobByScanId(scanId: string): AgentJob | null {
  try {
    const jobs = db.findBy<AgentJobDoc>('agent_log', { scan_id: scanId });
    return jobs[0] ? normalizeJob(jobs[0]) : null;
  } catch {
    return null;
  }
}

// ── Update job status ──

export function updateJob(jobId: string, updates: Partial<AgentJob>): void {
  try {
    const { id: _omitId, _id: _omitId2, ...rest } = updates as AgentJob;
    db.update('agent_log', jobId, rest);
  } catch (err: any) {
    logger.warn(`[AgentQueue] Failed to update job ${jobId}: ${err.message}`);
  }
}

// ── Dead-letter queue ──

export function moveToDeadLetter(job: AgentJob, error: string, errorStack?: string): void {
  try {
    const dlqDoc = {
      _id: `dlq_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      scan_id: job.scan_id,
      job_id: jobId(job),
      status: job.status,
      items_count: job.items_count,
      error: error.slice(0, 2000),
      ...(errorStack ? { error_stack: errorStack.slice(0, 8000) } : {}),
      dish_names: (job.dish_errors ? Object.keys(job.dish_errors) : []),
      ...(job.dish_errors ? { dish_errors: job.dish_errors } : {}),
      retries: job.retries,
      max_retries: job.max_retries,
      job_created_at: job.created_at,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    db.create('agent_log_dlq', dlqDoc);
    logger.error(`[AgentQueue] Job ${jobId(job)} moved to dead-letter queue (scan ${job.scan_id}): ${error.slice(0, 200)}`);
  } catch (err: any) {
    logger.warn(`[AgentQueue] Failed to persist DLQ entry for ${jobId(job)}: ${err.message}`);
  }
}

/** Reset a failed (or DLQ'd) job back to `queued` so the worker re-processes it. */
export function retryJob(jobIdToRetry: string): { ok: boolean; message: string } {
  try {
    const job = db.findById<AgentJobDoc>('agent_log', jobIdToRetry);
    if (!job) {
      return { ok: false, message: `Job ${jobIdToRetry} not found` };
    }
    if (job.status !== 'failed' && job.status !== 'dlq') {
      return { ok: false, message: `Job ${jobIdToRetry} is ${job.status} — only failed jobs can be retried` };
    }
    updateJob(jobIdToRetry, {
      status: 'queued',
      retries: 0,
      error: '',
      dish_errors: undefined,
      retry_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    logger.info(`[AgentQueue] Job ${jobIdToRetry} retried by admin`);
    return { ok: true, message: `Job ${jobIdToRetry} reset to queued` };
  } catch (err: any) {
    return { ok: false, message: `Failed to retry job: ${err.message}` };
  }
}

// ── Get queue stats (for admin health endpoint) ──

export function getQueueStats() {
  try {
    // Counted per status — findAll()'s 50-doc default would undercount.
    const total = db.count('agent_log');
    const byStatus = (status: string) => db.findBy<AgentJobDoc>('agent_log', { status }).length;
    const dlq = db.count('agent_log_dlq');
    const lastProcessed = db
      .findBy<AgentJobDoc>('agent_log', { status: 'completed' })
      .filter(j => j.completed_at)
      .sort((a, b) => new Date(b.completed_at!).getTime() - new Date(a.completed_at!).getTime())[0] || null;
    return {
      total,
      queued: byStatus('queued'),
      processing: byStatus('processing'),
      completed: byStatus('completed'),
      failed: byStatus('failed'),
      dead_letter: dlq,
      last_processed: lastProcessed,
    };
  } catch {
    return { total: 0, queued: 0, processing: 0, completed: 0, failed: 0, dead_letter: 0, last_processed: null };
  }
}

// ── Background worker ──
//
// Booted once from src/instrumentation.ts (server start) and ensured
// idempotently by enqueueAndProcessInBackground. Picks up queued jobs with
// bounded concurrency and re-claims jobs a previous process left
// 'processing' — in-flight work dies with the process, so those claims are
// stale by definition.

let workerStarted = false;
let workerCycleRunning = false;
let activeJobs = 0;

export function startWorker(): void {
  if (workerStarted) return;
  workerStarted = true;

  // Re-claim stale claims from a previous server process (crash/restart).
  try {
    const stale = db.findBy<AgentJobDoc>('agent_log', { status: 'processing' });
    for (const job of stale) {
      updateJob(job._id, { status: 'queued', error: 'Re-queued: server restarted mid-job' });
    }
    if (stale.length > 0) {
      logger.info(`[AgentQueue] Re-queued ${stale.length} stale processing job(s) after restart`);
    }
  } catch (err: any) {
    logger.warn(`[AgentQueue] Stale-job re-claim failed: ${err.message}`);
  }

  workerLoop();
}

function workerLoop(): void {
  if (workerCycleRunning) return;
  workerCycleRunning = true;
  try {
    while (activeJobs < WORKER_MAX_CONCURRENT) {
      const job = getNextJob();
      if (!job) break;
      // Optimistic claim BEFORE dispatch, so a concurrent cycle or the admin
      // endpoint can't pick the same job (getNextJob only sees 'queued').
      updateJob(jobId(job), { status: 'processing', started_at: new Date().toISOString() });
      activeJobs += 1;
      processJob(job)
        .catch((err: Error) => logger.error(`[AgentQueue] Worker job ${jobId(job)} crashed: ${err.message}`))
        .finally(() => { activeJobs -= 1; });
    }
  } finally {
    workerCycleRunning = false;
  }
  if (workerStarted) {
    const timer = setTimeout(workerLoop, WORKER_POLL_MS);
    timer.unref?.();
  }
}

// ── Process a single job (called by agent worker) ──

export async function processJob(job: AgentJob): Promise<boolean> {
  const id = jobId(job);
  updateJob(id, { status: 'processing', started_at: new Date().toISOString() });
  logger.info(`[AgentQueue] Processing job ${id} for scan ${job.scan_id}`);

  try {
    // Get the scan's dishes from DB
    const scan = db.findById<ScanDoc>('scans', job.scan_id);
    if (!scan) {
      throw new Error(`Scan ${job.scan_id} not found`);
    }

    const dishes = db.findBy<DishDoc>('dishes', { scan_id: job.scan_id });
    if (!dishes || dishes.length === 0) {
      throw new Error(`No dishes found for scan ${job.scan_id}`);
    }

    // Convert dishes to menu item input for the agent
    const menuItems: MenuItemInput[] = dishes.map((d) => ({
      id: d._id,
      name: d.name,
      description: d.description || '',
      price: d.price,
      category: d.category || 'other',
    }));

    // Run agent enrichment (bounded pool inside runAgent — ≤3 dishes at a
    // time — with per-dish progress reported here). dishErrors records which
    // dishes failed research/image search so partial results aren't lost.
    const agentResult = await runAgent(menuItems, job.scan_id, (done, total, dish) => {
      logger.info(`[AgentQueue] Job ${id}: enriched ${done}/${total} — ${dish}`);
    });

    // Update dishes with enriched data — ONE batched write instead of N
    // per-dish full-file rewrites (bulkUpdate = single read + single write).
    try {
      const updates = agentResult.dishes
        .filter((enriched) => enriched.id)
        .map((enriched) => ({
          query: { id: enriched.id },
          $set: {
            ai_description: enriched.ai_description,
            origin: enriched.origin,
            dietary_tags: enriched.dietary_tags,
            image_url: enriched.images[0] || '',
            confidence: enriched.confidence,
          },
        }));
      db.bulkUpdate<DishDoc>('dishes', updates);
    } catch (err: any) {
      // A failed write-back shouldn't fail the job — enrichment already ran.
      logger.warn(`[AgentQueue] Dish write-back failed: ${err.message}`);
    }

    // Update scan with summary
    db.update<ScanDoc>('scans', job.scan_id, {
      agent_summary: agentResult.summary,
      enriched: true,
      status: 'completed',
    });

    // Pre-warm AI details for the first N dishes (fire-and-forget, never
    // awaited) so the results page shows descriptions immediately without
    // waiting for clicks. Runs AFTER the batched write-back so the batch
    // can't overwrite a freshly generated ai_description. The remaining
    // dishes generate on-demand when clicked.
    for (const dish of dishes.slice(0, PREWARM_DISH_LIMIT)) {
      void generateDishDetails({
        dishName: dish.name,
        category: dish.category || undefined,
        description: dish.description || undefined,
        id: dish._id,
      })
        .then(() => logger.info(`[AgentQueue] Pre-warmed details for "${dish.name}"`))
        .catch((err: Error) =>
          logger.warn(`[AgentQueue] Pre-warm details failed for "${dish.name}": ${err.message}`)
        );
    }

    // Mark job complete (record dish_errors so partial failures are visible)
    updateJob(id, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      ...(Object.keys(agentResult.dishErrors).length > 0
        ? { dish_errors: agentResult.dishErrors }
        : {}),
    });

    logger.info(`[AgentQueue] Job ${id} completed — ${agentResult.dishes.length} dishes enriched`);
    return true;
  } catch (err: any) {
    const errorMsg = err.message || String(err);
    logger.error(`[AgentQueue] Job ${id} failed (attempt ${job.retries + 1}/${job.max_retries}): ${errorMsg}`);

    if (job.retries < job.max_retries) {
      // Exponential backoff: 5s → 10s → 20s before the next attempt.
      const backoffMs = AGENT_RETRY_BASE_DELAY_MS * Math.pow(2, job.retries);
      updateJob(id, {
        status: 'queued',
        retries: job.retries + 1,
        error: errorMsg,
        retry_at: new Date(Date.now() + backoffMs).toISOString(),
      });
      logger.info(`[AgentQueue] Job ${id} will retry in ${backoffMs}ms (attempt ${job.retries + 2}/${job.max_retries})`);
    } else {
      // Exhausted retries → dead-letter queue for inspection/re-processing.
      moveToDeadLetter(job, errorMsg, err?.stack);
      updateJob(id, {
        status: 'failed',
        completed_at: new Date().toISOString(),
        error: errorMsg,
        dlq_at: new Date().toISOString(),
        dlq_reason: errorMsg.slice(0, 500),
      });

      // Mark scan with error
      try {
        db.update<ScanDoc>('scans', job.scan_id, {
          status: 'completed',
          agent_summary: `Enrichment failed after ${job.max_retries} attempts`,
          enriched: false,
        });
      } catch {}
    }

    return false;
  }
}

// ── Fire-and-forget: process after response is sent ──

export async function enqueueAndProcessInBackground(
  scanId: string,
  items: unknown[]
): Promise<void> {
  // Create the job; the background worker picks it up (startWorker is
  // idempotent and booted from instrumentation.ts at server start, so jobs
  // also survive restarts — leftover 'queued'/'processing' jobs are resumed).
  createJob(scanId, items.length);
  startWorker();
}
