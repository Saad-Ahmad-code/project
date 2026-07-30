"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

interface DailyVolume {
  date: string;
  count: number;
}

interface RecentScan {
  id: string;
  date: string;
  items: number;
  status: string;
  userId: string;
}

interface Stats {
  totalScans: number;
  totalDishes: number;
  completedScans: number;
  dailyVolume: DailyVolume[];
  recentScans: RecentScan[];
}

export default function AdminPage() {
  const { data: session } = useSession();
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    if (session) {
      fetch("/api/admin/stats")
        .then((r) => r.json())
        .then(setStats)
        .catch(() => {});
    }
  }, [session]);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  if (!session) {
    return (
      <main className="max-w-4xl mx-auto p-8">
        <h1 className="text-2xl font-bold mb-4">Admin Dashboard</h1>
        <p className="text-destructive">Unauthorized — please log in.</p>
      </main>
    );
  }

  const StatCard = ({
    label,
    value,
  }: {
    label: string;
    value: number | string;
  }) => (
    <div className="bg-surface border border-border rounded-xl p-5">
      <p className="text-xs text-muted font-medium uppercase tracking-wider mb-1">
        {label}
      </p>
      <p className="text-3xl font-bold text-white">{value}</p>
    </div>
  );

  return (
    <main className="max-w-4xl mx-auto p-8 space-y-8">
      <h1 className="text-2xl font-bold">Admin Dashboard</h1>

      {/* Stats Cards */}
      {stats ? (
        <div className="grid grid-cols-3 gap-4">
          <StatCard label="Total Scans" value={stats.totalScans} />
          <StatCard label="Total Dishes" value={stats.totalDishes} />
          <StatCard label="Completed" value={stats.completedScans} />
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      )}

      {/* Chart */}
      {stats?.dailyVolume && stats.dailyVolume.length > 0 && (
        <section className="bg-surface border border-border rounded-xl p-6">
          <h2 className="text-sm font-semibold text-muted uppercase tracking-wider mb-4">
            Scan Volume (Last 7 Days)
          </h2>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.dailyVolume}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="hsl(var(--border))"
                />
                <XAxis
                  dataKey="date"
                  tick={{ fill: "#a1a1aa", fontSize: 12 }}
                  tickFormatter={(v) => formatDate(v)}
                  axisLine={{ stroke: "hsl(var(--border))" }}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fill: "#a1a1aa", fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{
                    background: "#18181b",
                    border: "1px solid #27272a",
                    borderRadius: 8,
                    fontSize: 13,
                  }}
                  labelFormatter={(v: any) => formatDate(String(v))}
                />
                <Bar
                  dataKey="count"
                  fill="#059669"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={40}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {/* Recent Scans Table */}
      {stats?.recentScans && stats.recentScans.length > 0 && (
        <section className="bg-surface border border-border rounded-xl p-6">
          <h2 className="text-sm font-semibold text-muted uppercase tracking-wider mb-4">
            Recent Scans
          </h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>User</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stats.recentScans.map((scan) => (
                <TableRow key={scan.id}>
                  <TableCell className="text-sm text-muted">
                    {formatDate(scan.date)}
                  </TableCell>
                  <TableCell>{scan.items}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        scan.status === "completed" ? "default" : "outline"
                      }
                    >
                      {scan.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted">
                    {scan.userId}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}
    </main>
  );
}
