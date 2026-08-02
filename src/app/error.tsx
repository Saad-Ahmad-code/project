"use client";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="max-w-md mx-auto p-8 text-center">
      <h1 className="text-2xl font-bold mb-4">Something went wrong</h1>
      <p className="text-sm text-muted-foreground mb-6">{error.message}</p>
      <button
        onClick={reset}
        className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm cursor-pointer border-none"
      >
        Try again
      </button>
    </div>
  );
}