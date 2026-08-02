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
 *   4. Job marked "completed" or "failed"
 */

import { logger } from '@/lib/logger';
import { db } from '@/lib/storage';
import { runAgent } from '@/lib/agent';
import type { MenuItem } from '@/types/menu';

// ── Types ──

export interface AgentJob {
  id: string;
  scan_id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  items_count: number;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  error?: string;
  retries: number;
  max_retries: number;
}

// ── Create a job ──

export function createJob(scanId: string, itemsCount: number): AgentJob {
  const job: AgentJob = {
    id: `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    scan_id: scanId,
    status: 'queued',
    items_count: itemsCount,
    created_at: new Date().toISOString(),
    retries: 0,
    max_retries: 3,
  };

  try {
    db.create('agent_log', job);
    logger.info(`[AgentQueue] Job ${job.id} created for scan ${scanId}`);
  } catch (err: any) {
    logger.warn(`[AgentQueue] Failed to persist job: ${err.message}`);
  }

  return job;
}

// ── Get next pending job ──

export function getNextJob(): AgentJob | null {
  try {
    const jobs = db.findAll<AgentJob>('agent_log');
    const pending = jobs
      .filter(j => j.status === 'queued')
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    return pending[0] || null;
  } catch {
    return null;
  }
}

// ── Get job by scan ID ──

export function getJobByScanId(scanId: string): AgentJob | null {
  try {
    const jobs = db.findAll<AgentJob>('agent_log');
    return jobs.find(j => j.scan_id === scanId) || null;
  } catch {
    return null;
  }
}

// ── Update job status ──

export function updateJob(jobId: string, updates: Partial<AgentJob>): void {
  try {
    db.update('agent_log', jobId, updates);
  } catch (err: any) {
    logger.warn(`[AgentQueue] Failed to update job ${jobId}: ${err.message}`);
  }
}

// ── Get queue stats (for admin health endpoint) ──

export function getQueueStats() {
  try {
    const jobs = db.findAll<AgentJob>('agent_log');
    return {
      total: jobs.length,
      queued: jobs.filter(j => j.status === 'queued').length,
      processing: jobs.filter(j => j.status === 'processing').length,
      completed: jobs.filter(j => j.status === 'completed').length,
      failed: jobs.filter(j => j.status === 'failed').length,
      last_processed: jobs
        .filter(j => j.completed_at)
        .sort((a, b) => new Date(b.completed_at!).getTime() - new Date(a.completed_at!).getTime())[0] || null,
    };
  } catch {
    return { total: 0, queued: 0, processing: 0, completed: 0, failed: 0, last_processed: null };
  }
}

// ── Background worker ──
//
// Booted once from src/instrumentation.ts (server start) and ensured
// idempotently by enqueueAndProcessInBackground. Picks up queued jobs with
// bounded concurrency and re-claims jobs a previous process left
// 'processing' — in-flight work dies with the process, so those claims are
// stale by definition.

const WORKER_POLL_MS = 5000;
const WORKER_MAX_CONCURRENT = 3;

let workerStarted = false;
let workerCycleRunning = false;
let activeJobs = 0;

export function startWorker(): void {
  if (workerStarted) return;
  workerStarted = true;

  // Re-claim stale claims from a previous server process (crash/restart).
  try {
    const jobs = db.findAll<AgentJob>('agent_log');
    const stale = jobs.filter(j => j.status === 'processing');
    for (const job of stale) {
      updateJob(job.id, { status: 'queued', error: 'Re-queued: server restarted mid-job' });
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
      updateJob(job.id, { status: 'processing', started_at: new Date().toISOString() });
      activeJobs += 1;
      processJob(job)
        .catch((err: Error) => logger.error(`[AgentQueue] Worker job ${job.id} crashed: ${err.message}`))
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
  updateJob(job.id, { status: 'processing', started_at: new Date().toISOString() });
  logger.info(`[AgentQueue] Processing job ${job.id} for scan ${job.scan_id}`);

  try {
    // Get the scan's dishes from DB
    const scan = db.findById<any>('scans', job.scan_id);
    if (!scan) {
      throw new Error(`Scan ${job.scan_id} not found`);
    }

    const dishes = db.findBy<any>('dishes', { scan_id: job.scan_id });
    if (!dishes || dishes.length === 0) {
      throw new Error(`No dishes found for scan ${job.scan_id}`);
    }

    // Convert dishes to menu item input for the agent
    const menuItems = dishes.map((d: any) => ({
      id: d.id || d._id,
      name: d.name,
      description: d.description || '',
      price: d.price,
      category: d.category || 'other',
    }));

    // Run agent enrichment (bounded pool inside runAgent — ≤3 dishes at a
    // time — with per-dish progress reported here).
    const agentResult = await runAgent(menuItems, job.scan_id, (done, total, dish) => {
      logger.info(`[AgentQueue] Job ${job.id}: enriched ${done}/${total} — ${dish}`);
    });

    // Update dishes with enriched data — ONE batched write instead of N
    // per-dish full-file rewrites (bulkUpdate = single read + single write).
    try {
      const updates = agentResult.dishes
        .filter((enriched: any) => enriched.id)
        .map((enriched: any) => ({
          query: { id: enriched.id },
          $set: {
            ai_description: enriched.ai_description,
            origin: enriched.origin,
            dietary_tags: enriched.dietary_tags,
            image_url: enriched.images[0] || '',
            confidence: enriched.confidence,
          },
        }));
      db.bulkUpdate('dishes', updates);
    } catch (err: any) {
      // A failed write-back shouldn't fail the job — enrichment already ran.
      logger.warn(`[AgentQueue] Dish write-back failed: ${err.message}`);
    }

    // Update scan with summary
    db.update('scans', job.scan_id, {
      agent_summary: agentResult.summary,
      enriched: true,
      status: 'completed',
    });

    // Mark job complete
    updateJob(job.id, {
      status: 'completed',
      completed_at: new Date().toISOString(),
    });

    logger.info(`[AgentQueue] Job ${job.id} completed — ${agentResult.dishes.length} dishes enriched`);
    return true;
  } catch (err: any) {
    const errorMsg = err.message || String(err);
    logger.error(`[AgentQueue] Job ${job.id} failed (attempt ${job.retries + 1}/${job.max_retries}): ${errorMsg}`);

    if (job.retries < job.max_retries) {
      updateJob(job.id, {
        status: 'queued',
        retries: job.retries + 1,
        error: errorMsg,
      });
    } else {
      updateJob(job.id, {
        status: 'failed',
        completed_at: new Date().toISOString(),
        error: errorMsg,
      });

      // Mark scan with error
      try {
        db.update('scans', job.scan_id, {
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
  items: any[]
): Promise<void> {
  // Create the job; the background worker picks it up (startWorker is
  // idempotent and booted from instrumentation.ts at server start, so jobs
  // also survive restarts — leftover 'queued'/'processing' jobs are resumed).
  createJob(scanId, items.length);
  startWorker();
}
