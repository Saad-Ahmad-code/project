"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

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

  if (loading) {
    return (
      <main className="max-w-3xl mx-auto p-8">
        <Skeleton className="h-8 w-48 mb-6" />
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-3xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-6">Scan History</h1>

      {error && (
        <div className="mb-4 p-4 rounded-lg bg-red-950 border border-red-800">
          <p className="text-red-400 text-sm">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-2 px-4 py-1.5 rounded-lg border border-border bg-background text-sm text-muted cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {scans.length === 0 ? (
        <div className="text-center py-12 text-muted">
          <p>No scans yet</p>
          <Link href="/scan" className="text-primary inline-block mt-4">
            Scan a Menu
          </Link>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Items</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">View</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {scans.map((scan) => (
              <TableRow key={scan.id}>
                <TableCell className="text-sm text-muted">
                  {new Date(scan.created_at).toLocaleDateString()}
                </TableCell>
                <TableCell className="font-medium">{scan.items_count}</TableCell>
                <TableCell>
                  <Badge
                    variant={scan.status === "completed" ? "default" : "outline"}
                    className={
                      scan.status === "completed"
                        ? "bg-green-900 text-green-300 border-green-700"
                        : "text-yellow-300 border-yellow-700"
                    }
                  >
                    {scan.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Link href={`/results/${scan.id}`} className="text-sm text-primary hover:text-primary/80 transition-colors">
                    View
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </main>
  );
}
