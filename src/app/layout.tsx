import type { Metadata } from "next";
import { Providers } from "@/components/ui/Providers";
import { Navbar } from "@/components/ui/Navbar";
import "./globals.css";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";
import { Toaster } from "@/components/ui/sonner";
import { ErrorBoundary } from "@/components/ErrorBoundary";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: "MenuLens",
  description: "Scan and analyze restaurant menus with AI",
};

// Fetch CSRF token client-side and inject into meta tag + sessionStorage.
// The cookie is set by the /api/csrf/token endpoint (HttpOnly, SameSite=Strict).

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn("font-sans dark", geist.variable)}>
      <head>
        {/* CSRF token for client-side POST/PUT/DELETE requests */}
        <meta name="csrf-token" content="" data-csrf-fetch="true" />
      </head>
      <body>
        <Providers>
          <ErrorBoundary>
            <Navbar />
            <Toaster position="bottom-right" />
            {children}
          </ErrorBoundary>
        </Providers>
      <script
        dangerouslySetInnerHTML={{
          __html: `
            // Fetch CSRF token and inject into meta tag + sessionStorage
            fetch('/api/csrf/token')
              .then(r => r.json())
              .then(data => {
                const meta = document.querySelector('meta[name="csrf-token"]');
                if (meta) meta.setAttribute('content', data.token || '');
                if (data.token) sessionStorage.setItem('csrf_token', data.token);
              })
              .catch(() => {});
          `,
        }}
      />
    </body>
    </html>
  );
}
