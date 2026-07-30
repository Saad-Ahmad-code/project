"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface ScanSummary {
  id: string;
  items_count: number;
  created_at: string;
  status: string;
}

export default function HistoryPage() {
  const [scans, setScans] = useState<ScanSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/scans")
      .then((r) => r.json())
      .then((data) => setScans(data.scans || []))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <main style={{ padding: "2rem", textAlign: "center" }}><p>Loading...</p></main>;

  return (
    <main style={{ maxWidth: 800, margin: "0 auto", padding: "2rem" }}>
      <h1 style={{ marginBottom: "1rem" }}>Scan History</h1>

      {error && (
        <div style={{ background: "#2d1b1b", border: "1px solid #5c2a2a", borderRadius: 8, padding: "1rem", marginBottom: "1rem" }}>
          <p style={{ color: "#f87171" }}>{error}</p>
          <button onClick={() => window.location.reload()} style={{ background: "#374151", color: "#e0e0e0", border: "none", padding: "0.5rem 1rem", borderRadius: 6, marginTop: "0.5rem" }}>Retry</button>
        </div>
      )}

      {scans.length === 0 ? (
        <div style={{ textAlign: "center", padding: "3rem", color: "#666" }}>
          <p>No scans yet</p>
          <Link href="/scan" style={{ color: "#60a5fa", display: "inline-block", marginTop: "1rem" }}>Scan a Menu</Link>
        </div>
      ) : (
        <div style={{ display: "grid", gap: "0.75rem" }}>
          {scans.map((scan) => (
            <Link key={scan.id} href={`/results/${scan.id}`} style={{ display: "flex", justifyContent: "space-between", background: "#111", borderRadius: 8, padding: "1rem", textDecoration: "none" }}>
              <div>
                <p style={{ color: "#e0e0e0" }}>{scan.items_count} items</p>
                <p style={{ color: "#666", fontSize: "0.8rem" }}>{new Date(scan.created_at).toLocaleDateString()}</p>
              </div>
              <span style={{ color: scan.status === "completed" ? "#4ade80" : "#fbbf24", fontSize: "0.9rem" }}>{scan.status}</span>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
