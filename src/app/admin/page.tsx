export const dynamic = "force-dynamic";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";

export default async function AdminPage() {
  const session = await getServerSession(authOptions);

  let stats = { totalScans: 0, totalDishes: 0, completedScans: 0 };

  if (session) {
    try {
      const { db } = await import("@/lib/storage");
      const [totalScans, totalDishes, completedScans] = await Promise.all([
        db.count("scans"),
        db.count("dishes"),
        db.count("scans", { status: "completed" }),
      ]);
      stats = { totalScans, totalDishes, completedScans };
    } catch {
      // stats remain default
    }
  }

  return (
    <main style={{ maxWidth: 800, margin: "0 auto", padding: "2rem" }}>
      <h1 style={{ marginBottom: "1rem" }}>Admin Dashboard</h1>
      {!session && <p style={{ color: "#f87171" }}>Unauthorized — please log in.</p>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem" }}>
        <div style={{ background: "#111", borderRadius: 12, padding: "1.5rem" }}>
          <p style={{ color: "#666", fontSize: "0.9rem" }}>Total Scans</p>
          <p style={{ fontSize: "2rem", fontWeight: "bold" }}>{stats.totalScans}</p>
        </div>
        <div style={{ background: "#111", borderRadius: 12, padding: "1.5rem" }}>
          <p style={{ color: "#666", fontSize: "0.9rem" }}>Total Dishes</p>
          <p style={{ fontSize: "2rem", fontWeight: "bold" }}>{stats.totalDishes}</p>
        </div>
        <div style={{ background: "#111", borderRadius: 12, padding: "1.5rem" }}>
          <p style={{ color: "#666", fontSize: "0.9rem" }}>Completed</p>
          <p style={{ fontSize: "2rem", fontWeight: "bold" }}>{stats.completedScans}</p>
        </div>
      </div>
    </main>
  );
}
