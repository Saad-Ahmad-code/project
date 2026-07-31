import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col">
      {/* Hero Section */}
      <section className="flex-1 flex flex-col items-center justify-center px-4 py-20">
        <div className="max-w-2xl text-center space-y-6">
          <h1 className="text-5xl md:text-6xl font-bold tracking-tight text-white">
            MenuLens
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-md mx-auto leading-relaxed">
            Take a photo of any restaurant menu and let AI extract dishes,
            analyze nutrition, and suggest the best picks.
          </p>
          <div className="flex gap-4 justify-center pt-4">
            <Link
              href="/scan"
              className="inline-flex h-10 items-center justify-center rounded-lg bg-primary text-primary-foreground px-6 text-sm font-medium whitespace-nowrap transition-all hover:bg-primary/80 active:translate-y-px"
            >
              Scan a Menu
            </Link>
            <Link
              href="/history"
              className="inline-flex h-10 items-center justify-center rounded-lg border border-border bg-background px-6 text-sm font-medium whitespace-nowrap transition-all hover:bg-muted hover:text-foreground active:translate-y-px"
            >
              View History
            </Link>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="border-t border-border py-12 px-4">
        <div className="max-w-2xl mx-auto grid grid-cols-3 gap-8 text-center">
          <div className="space-y-2">
            <span className="text-xs font-semibold text-primary block tracking-widest uppercase">
              01
            </span>
            <p className="text-sm text-muted-foreground font-medium">Upload</p>
            <p className="text-xs text-muted-foreground/70">
              Snap or upload a menu photo
            </p>
          </div>
          <div className="space-y-2">
            <span className="text-xs font-semibold text-primary block tracking-widest uppercase">
              02
            </span>
            <p className="text-sm text-muted-foreground font-medium">Scan</p>
            <p className="text-xs text-muted-foreground/70">
              AI extracts every dish and detail
            </p>
          </div>
          <div className="space-y-2">
            <span className="text-xs font-semibold text-primary block tracking-widest uppercase">
              03
            </span>
            <p className="text-sm text-muted-foreground font-medium">Review</p>
            <p className="text-xs text-muted-foreground/70">
              Explore nutrition, ratings & recipes
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-6 px-4">
        <p className="text-xs text-muted-foreground/50 text-center">
          MenuLens &mdash; AI-powered menu scanning
        </p>
      </footer>
    </main>
  );
}
