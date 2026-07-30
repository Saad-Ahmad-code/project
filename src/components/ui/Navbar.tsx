"use client";

import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export function Navbar() {
  const { data: session, status } = useSession();

  return (
    <nav className="flex items-center justify-between px-12 py-5 border-b border-border">
      <Link href="/" className="text-xl font-bold text-white no-underline">
        MenuLens
      </Link>

      <div className="flex gap-8 items-center">
        <Link href="/scan" className="text-sm text-muted hover:text-white transition-colors no-underline">
          Scan
        </Link>
        <Link href="/history" className="text-sm text-muted hover:text-white transition-colors no-underline">
          History
        </Link>

        {status === "loading" && (
          <Skeleton className="h-4 w-20" />
        )}

        {status === "authenticated" && (
          <>
            <span className="text-sm text-muted">{session?.user?.email}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => signOut({ callbackUrl: "/" })}
            >
              Logout
            </Button>
          </>
        )}

        {status === "unauthenticated" && (
          <Link href="/auth/login" className="inline-flex h-7 items-center justify-center rounded-lg border border-border bg-background px-2.5 text-sm font-medium whitespace-nowrap transition-all hover:bg-muted hover:text-foreground active:translate-y-px no-underline text-muted">
            Login
          </Link>
        )}
      </div>
    </nav>
  );
}
