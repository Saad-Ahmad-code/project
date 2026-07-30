"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Registration failed");
        return;
      }
      router.push("/auth/login");
    } catch {
      setError("Registration failed");
    }
  };

  return (
    <main style={{ maxWidth: 400, margin: "0 auto", padding: "2rem" }}>
      <h1 style={{ marginBottom: "1rem" }}>Register</h1>
      {error && <p style={{ color: "#f87171", marginBottom: "1rem" }}>{error}</p>}
      <form onSubmit={handleSubmit}>
        <input type="text" placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)}
          style={{ width: "100%", padding: "0.75rem", marginBottom: "0.75rem", background: "#111", border: "1px solid #333", borderRadius: 8, color: "#e0e0e0" }} />
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required
          style={{ width: "100%", padding: "0.75rem", marginBottom: "0.75rem", background: "#111", border: "1px solid #333", borderRadius: 8, color: "#e0e0e0" }} />
        <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required
          style={{ width: "100%", padding: "0.75rem", marginBottom: "1rem", background: "#111", border: "1px solid #333", borderRadius: 8, color: "#e0e0e0" }} />
        <button type="submit" style={{ width: "100%", padding: "0.75rem", background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, fontSize: "1rem" }}>
          Register
        </button>
      </form>
      <p style={{ textAlign: "center", marginTop: "1rem", color: "#666" }}>
        Already have an account? <Link href="/auth/login" style={{ color: "#60a5fa" }}>Login</Link>
      </p>
    </main>
  );
}
