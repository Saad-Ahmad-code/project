/**
 * Next.js instrumentation hook.
 * Uses dynamic import to prevent webpack from bundling
 * server-only Node built-ins (fs, path, crypto) on the client.
 */
export async function register() {
  // Dynamic import ensures webpack doesn't trace into mongodb.ts at build time
  const { connectToDatabase } = await require('./lib/mongodb');
  await connectToDatabase();
  console.log('📦 MenuLens: Local storage ready (no MongoDB)');
}
