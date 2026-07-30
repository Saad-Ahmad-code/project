"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface DishComparison {
  name: string;
  price: number;
  scan_id: string;
}

interface ComparisonData {
  label: string;
  dishes: DishComparison[];
}

export default function ComparePage() {
  const [scanId, setScanId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [data, setData] = useState<ComparisonData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleCompare = async () => {
    if (!scanId || !targetId) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/scans/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scanId, targetId }),
      });
      const json = await res.json();
      if (json.error) setError(json.error);
      else setData(json);
    } catch {
      setError("Comparison failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={{ maxWidth: 800, margin: "0 auto", padding: "2rem" }}>
      <h1 style={{ marginBottom: "1rem" }}>Compare Scans</h1>

      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem" }}>
        <input placeholder="Scan ID 1" value={scanId} onChange={(e) => setScanId(e.target.value)}
          style={{ flex: 1, padding: "0.75rem", background: "#111", border: "1px solid #333", borderRadius: 8, color: "#e0e0e0" }} />
        <input placeholder="Scan ID 2" value={targetId} onChange={(e) => setTargetId(e.target.value)}
          style={{ flex: 1, padding: "0.75rem", background: "#111", border: "1px solid #333", borderRadius: 8, color: "#e0e0e0" }} />
        <button onClick={handleCompare} disabled={loading}
          style={{ padding: "0.75rem 1.5rem", background: "#2563eb", color: "#fff", border: "none", borderRadius: 8 }}>
          {loading ? "Loading..." : "Compare"}
        </button>
      </div>

      {error && <p style={{ color: "#f87171", marginBottom: "1rem" }}>{error}</p>}

      {data && (
        <div style={{ background: "#111", borderRadius: 12, padding: "1.5rem" }}>
          <h2 style={{ marginBottom: "1rem" }}>{data.label}</h2>
          <div style={{ display: "grid", gap: "0.75rem" }}>
            {data.dishes.map((d, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "0.5rem 0", borderBottom: "1px solid #222" }}>
                <Link href={`/results/${d.scan_id}`} style={{ color: "#e0e0e0" }}>{d.name}</Link>
                <span style={{ color: "#4ade80" }}>{d.price !== undefined && d.price !== null ? `$${d.price.toFixed(2)}` : "-"}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
