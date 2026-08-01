/**
 * Next.js instrumentation hook.
 * Uses dynamic import to prevent webpack from bundling
 * server-only Node built-ins (fs, path, crypto) on the client.
 */
export async function register() {
  // Dynamic import ensures webpack doesn't trace into mongodb.ts at build time
  const { connectToDatabase } = await require('./lib/mongodb');
  await connectToDatabase();
  console.log('MenuLens: Local storage ready (no MongoDB)');

  // Resume background enrichment: the worker re-claims jobs a previous run
  // left queued/processing and processes them with bounded concurrency.
  // Skipped during `next build` — the worker only belongs in a live server.
  if (process.env.NEXT_PHASE !== 'phase-production-build') {
    const { startWorker } = await require('./lib/agent/queue');
    startWorker();
  }
}
