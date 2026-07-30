"use client";

import Link from "next/link";
import { useSession, signOut } from "next-auth/react";

export function Navbar() {
  const { data: session, status } = useSession();

  return (
    <nav style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 2rem", borderBottom: "1px solid #222" }}>
      <Link href="/" style={{ fontSize: "1.25rem", fontWeight: "bold", color: "#fff", textDecoration: "none" }}>
        MenuLens
      </Link>

      <div style={{ display: "flex", gap: "1.5rem", alignItems: "center" }}>
        <Link href="/scan" style={{ color: "#e0e0e0", textDecoration: "none", fontSize: "0.95rem" }}>Scan</Link>
        <Link href="/history" style={{ color: "#e0e0e0", textDecoration: "none", fontSize: "0.95rem" }}>History</Link>

        {status === "loading" && (
          <span style={{ color: "#666", fontSize: "0.9rem" }}>Loading...</span>
        )}

        {status === "authenticated" && (
          <>
            <span style={{ color: "#999", fontSize: "0.9rem" }}>{session?.user?.email}</span>
            <button
              onClick={() => signOut({ callbackUrl: "/" })}
              style={{ background: "#333", color: "#e0e0e0", border: "none", padding: "0.4rem 0.9rem", borderRadius: 6, fontSize: "0.9rem", cursor: "pointer" }}
            >
              Logout
            </button>
          </>
        )}

        {status === "unauthenticated" && (
          <Link href="/auth/login" style={{ color: "#60a5fa", textDecoration: "none", fontSize: "0.9rem" }}>Login</Link>
        )}
      </div>
    </nav>
  );
}
