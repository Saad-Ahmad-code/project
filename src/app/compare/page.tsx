"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

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
    <main className="max-w-3xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-6">Compare Scans</h1>

      <div className="flex gap-3 mb-4">
        <Input
          placeholder="Scan ID 1"
          value={scanId}
          onChange={(e) => setScanId(e.target.value)}
        />
        <Input
          placeholder="Scan ID 2"
          value={targetId}
          onChange={(e) => setTargetId(e.target.value)}
        />
        <Button onClick={handleCompare} disabled={loading}>
          {loading ? "Loading..." : "Compare"}
        </Button>
      </div>

      {error && (
        <p className="text-red-400 text-sm mb-4">{error}</p>
      )}

      {data && (
        <Card>
          <CardHeader>
            <CardTitle>{data.label}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-border">
              {data.dishes.map((d, i) => (
                <div key={i} className="flex justify-between items-center py-3">
                  <Link href={`/results/${d.scan_id}`} className="text-sm hover:text-primary transition-colors">
                    {d.name}
                  </Link>
                  <span className="text-accent font-medium text-sm">
                    {d.price !== undefined && d.price !== null ? `$${d.price.toFixed(2)}` : "-"}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
