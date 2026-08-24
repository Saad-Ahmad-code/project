/**
 * Agent Health Endpoint (Admin Only)
 *
 * Invisible to regular users — no frontend link, no public access.
 * Only authenticated admin users can view agent status.
 *
 * GET  /api/admin/agent       → Queue stats + system health
 * POST /api/admin/agent       → Process next queued job
 * POST /api/admin/agent/clear → Clear failed jobs
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/options';
import { getQueueStats, getNextJob, processJob, updateJob, retryJob } from '@/lib/agent/queue';
import { checkDatabaseConnection } from '@/lib/diagnostics';
import { requireCsrf } from '@/lib/csrf';

async function requireAdmin(): Promise<boolean> {
  try {
    const session = await getServerSession(authOptions);
    return !!session && (session.user as { isAdmin?: boolean }).isAdmin === true;
  } catch {
    return false;
  }
}

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [queueStats, dbHealth] = await Promise.all([
    Promise.resolve(getQueueStats()),
    checkDatabaseConnection().catch(() => ({ ok: false, error: 'Check failed' })),
  ]);

  return NextResponse.json({
    status: 'ok',
    queue: queueStats,
    storage: {
      type: 'local-json',
      healthy: dbHealth.ok,
      ...(dbHealth.error ? { error: dbHealth.error } : {}),
    },
    system: {
      node: process.version,
      platform: process.platform,
      uptime: Math.floor(process.uptime()),
    },
  });
}

export async function POST(request: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const csrfError = requireCsrf(request);
  if (csrfError) return csrfError;

  try {
    const body = await request.json().catch(() => ({}));
    const action = body.action || 'process';

    if (action === 'process') {
      const job = getNextJob();
      if (!job) {
        return NextResponse.json({ message: 'No pending jobs', processed: false });
      }

      // Process in background — don't await
      processJob(job).then((success) => {
        // Logged in processJob
      });

      return NextResponse.json({
        message: `Processing job ${job.id} for scan ${job.scan_id}`,
        processed: true,
        job_id: job.id,
        scan_id: job.scan_id,
        items_count: job.items_count,
      });
    }

    if (action === 'retry') {
      const jobIdToRetry = body.jobId || body.job_id;
      if (!jobIdToRetry || typeof jobIdToRetry !== 'string') {
        return NextResponse.json({ error: 'jobId required for retry action' }, { status: 400 });
      }
      const result = retryJob(jobIdToRetry);
      if (!result.ok) {
        return NextResponse.json({ error: result.message }, { status: 400 });
      }
      return NextResponse.json({ message: result.message, retried: true, job_id: jobIdToRetry });
    }

    if (action === 'clear-failed') {
      // findBy (no limit) — findAll's 50-doc default hides older jobs.
      const { db } = await import('@/lib/storage');
      const jobs = db.findBy<any>('agent_log', { status: 'failed' });
      for (const job of jobs) {
        updateJob(job._id || job.id, { status: 'queued', retries: 0, error: '' });
      }
      return NextResponse.json({ message: `Reset ${jobs.length} failed jobs`, cleared: jobs.length });
    }

    if (action === 'clear-all') {
      const { db } = await import('@/lib/storage');
      const finished = [
        ...db.findBy<any>('agent_log', { status: 'completed' }),
        ...db.findBy<any>('agent_log', { status: 'failed' }),
      ];
      let deleted = 0;
      for (const job of finished) {
        db.deleteOne('agent_log', { id: job.id ?? job._id });
        deleted++;
      }
      return NextResponse.json({ message: `Deleted ${deleted} old jobs`, deleted });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
