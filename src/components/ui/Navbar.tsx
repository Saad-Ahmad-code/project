"use client";

import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export function Navbar() {
  const { data: session, status } = useSession();

  return (
    <nav className="flex items-center justify-between px-8 py-4 border-b border-border">
      <Link href="/" className="text-xl font-bold text-white no-underline">
        MenuLens
      </Link>

      <div className="flex gap-6 items-center">
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
          <Link href="/auth/login" className="text-sm text-primary hover:text-primary/80 transition-colors no-underline">
            Login
          </Link>
        )}
      </div>
    </nav>
  );
}
