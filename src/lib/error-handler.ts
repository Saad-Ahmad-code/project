/**
 * Auto-Diagnostic Error Handler
 *
 * Automatically detects, diagnoses, and attempts to fix common errors.
 * Exposes a health endpoint and logging system.
 */

// ============================================================
// Types
// ============================================================

interface DiagnosticResult {
  ok: boolean;
  component: string;
  message: string;
  error?: string;
  fix?: string;
  timestamp: string;
}

interface FixAction {
  component: string;
  action: string;
  status: 'pending' | 'applied' | 'failed' | 'not_needed';
}

// ============================================================
// Error Log (in-memory + persisted)
// ============================================================

const errorLog: { time: string; error: string; stack?: string; diagnosis?: DiagnosticResult[] }[] = [];
const MAX_LOG = 100;

function getTimestamp(): string {
  return new Date().toISOString();
}

// ============================================================
// Component Health Checks
// ============================================================

async function checkLocalStorage(): Promise<DiagnosticResult> {
  try {
    const { connectToDatabase } = await import('./mongodb');
    const { db } = await connectToDatabase();
    db('scans').countDocuments();
    return { ok: true, component: 'storage', message: 'Local JSON storage OK', timestamp: getTimestamp() };
  } catch (err: any) {
    return {
      ok: false,
      component: 'storage',
      message: 'Local storage failed',
      error: err?.message || String(err),
      fix: 'Check that src/lib/mongodb.ts exports connectToDatabase. Run: npm run build to recompile.',
      timestamp: getTimestamp(),
    };
  }
}

async function checkOllamaDiagnostics(): Promise<DiagnosticResult> {
  const { checkOllama } = await import('./diagnostics');
  const result = await checkOllama();
  return {
    ok: result.ok,
    component: 'ollama',
    message: result.ok
      ? `Ollama reachable (${result.models.length} models)`
      : 'Ollama unreachable',
    error: result.ok ? undefined : result.error,
    fix: result.ok ? undefined : 'Start Ollama (ollama serve) or set OLLAMA_URL',
    timestamp: getTimestamp(),
  };
}

async function checkAIProviders(): Promise<DiagnosticResult> {
  const results: DiagnosticResult[] = [];
  const providers = [
    { name: 'openrouter', envVar: 'OPENROUTER_API_KEY', url: 'https://openrouter.ai/api/v1/models' },
    { name: 'gemini', envVar: 'GEMINI_API_KEY', url: 'https://generativelanguage.googleapis.com/v1/models' },
  ];

  for (const provider of providers) {
    const apiKey = process.env[provider.envVar];
    if (!apiKey) {
      results.push({
        ok: false,
        component: `ai:${provider.name}`,
        message: `No ${provider.envVar} configured`,
        error: 'Missing API key',
        fix: `Add ${provider.envVar}=your_key to .env.local`,
        timestamp: getTimestamp(),
      });
      continue;
    }
    try {
      const res = await fetch(provider.url, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      results.push({
        ok: res.ok,
        component: `ai:${provider.name}`,
        message: res.ok ? `${provider.name} API reachable` : `${provider.name} returned ${res.status}`,
        error: res.ok ? undefined : `HTTP ${res.status}`,
        fix: res.ok ? undefined : 'Check API key validity and billing status',
        timestamp: getTimestamp(),
      });
    } catch (err: any) {
      results.push({
        ok: false,
        component: `ai:${provider.name}`,
        message: `${provider.name} unreachable`,
        error: err.message || String(err),
        fix: 'Check network connectivity and API endpoint URL',
        timestamp: getTimestamp(),
      });
    }
  }

  return {
    ok: results.every(r => r.ok),
    component: 'ai-providers',
    message: results.every(r => r.ok) ? 'All AI providers OK' : 'Some AI providers have issues',
    error: results.filter(r => !r.ok).map(r => r.error).filter(Boolean).join('; '),
    timestamp: getTimestamp(),
  };
}

async function checkFilePermissions(): Promise<DiagnosticResult> {
  try {
    const fs = require('fs');
    const testDir = process.cwd() + '/data';
    if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });
    const testFile = testDir + '/.write-test';
    fs.writeFileSync(testFile, 'ok');
    fs.unlinkSync(testFile);
    return { ok: true, component: 'filesystem', message: 'File read/write OK', timestamp: getTimestamp() };
  } catch (err: any) {
    return {
      ok: false,
      component: 'filesystem',
      message: 'File permission issue',
      error: err.message || String(err),
      fix: 'Grant write permission to the project/data/ directory',
      timestamp: getTimestamp(),
    };
  }
}

async function checkNodeVersion(): Promise<DiagnosticResult> {
  const version = process.version;
  const major = parseInt(version.slice(1).split('.')[0], 10);
  const ok = major >= 18;
  return {
    ok,
    component: 'node-version',
    message: `Node.js ${version} ${ok ? 'OK (>=18)' : 'too old'}`,
    error: ok ? undefined : `Node ${version} may not be supported`,
    fix: ok ? undefined : 'Install Node.js 18+ from https://nodejs.org',
    timestamp: getTimestamp(),
  };
}

// ============================================================
// Auto-Fix Logic
// ============================================================

function autoFix(diagnosis: DiagnosticResult[]): FixAction[] {
  const fixes: FixAction[] = [];

  for (const d of diagnosis) {
    if (d.ok) {
      fixes.push({ component: d.component, action: 'No fix needed', status: 'not_needed' });
      continue;
    }

    if (d.component === 'storage') {
      try {
        const fs = require('fs');
        const dataDir = process.cwd() + '/data';
        if (!fs.existsSync(dataDir)) {
          fs.mkdirSync(dataDir, { recursive: true });
          fixes.push({ component: 'storage', action: 'Created data/ directory', status: 'applied' });
        }
      } catch {
        fixes.push({ component: 'storage', action: 'Could not create data/ directory', status: 'failed' });
      }
    }

    if (d.component === 'filesystem') {
      try {
        const fs = require('fs');
        const dataDir = process.cwd() + '/data';
        fs.mkdirSync(dataDir, { recursive: true });
        fixes.push({ component: 'filesystem', action: 'Ensured data/ directory exists', status: 'applied' });
      } catch {
        fixes.push({ component: 'filesystem', action: 'Could not fix permissions', status: 'failed' });
      }
    }
  }

  return fixes;
}

// ============================================================
// Main API
// ============================================================

export async function runDiagnostics(): Promise<{
  healthy: boolean;
  checks: DiagnosticResult[];
  fixes: FixAction[];
}> {
  const checks = await Promise.all([
    checkNodeVersion(),
    checkLocalStorage(),
    checkFilePermissions(),
    checkAIProviders(),
    checkOllamaDiagnostics(),
  ]);

  const fixes = autoFix(checks);
  const healthy = checks.every(c => c.ok);

  return { healthy, checks, fixes };
}

export function logError(error: Error | string | unknown, context?: Record<string, any>) {
  const entry = {
    time: getTimestamp(),
    error: typeof error === 'string' ? error : (error instanceof Error ? error.message : String(error)),
    stack: typeof error === 'string' ? undefined : (error instanceof Error ? error.stack : undefined),
    context,
  };
  errorLog.unshift(entry);
  if (errorLog.length > MAX_LOG) errorLog.length = MAX_LOG;

  // Also try to persist to disk
  try {
    const fs = require('fs');
    const logDir = process.cwd() + '/data/logs';
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(
      logDir + '/errors.jsonl',
      JSON.stringify(entry) + '\n'
    );
  } catch {
    // silently fail — can't log if logger is broken
  }
}

export function getErrorLog(count = 10) {
  return errorLog.slice(0, count);
}

export async function diagnoseError(error: Error | string): Promise<{
  error: string;
  diagnosis: DiagnosticResult[];
  fixes: FixAction[];
}> {
  logError(error);
  const diagnosis = await runDiagnostics();
  return {
    error: typeof error === 'string' ? error : error.message,
    diagnosis: diagnosis.checks,
    fixes: diagnosis.fixes,
  };
}
