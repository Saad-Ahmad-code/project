import Link from "next/link";

export default function HomePage() {
  return (
    <main style={{ maxWidth: 800, margin: "0 auto", padding: "2rem", textAlign: "center" }}>
      <h1 style={{ fontSize: "3rem", marginBottom: "0.5rem" }}>MenuLens</h1>
      <p style={{ fontSize: "1.2rem", color: "#999", marginBottom: "2rem" }}>
        Scan and analyze restaurant menus with AI
      </p>
      <div style={{ display: "flex", gap: "1rem", justifyContent: "center" }}>
        <Link href="/scan" style={{ padding: "0.75rem 2rem", background: "#2563eb", color: "#fff", borderRadius: 8, textDecoration: "none" }}>
          Scan a Menu
        </Link>
        <Link href="/history" style={{ padding: "0.75rem 2rem", background: "#1f2937", color: "#e0e0e0", borderRadius: 8, textDecoration: "none" }}>
          View History
        </Link>
      </div>
    </main>
  );
}
