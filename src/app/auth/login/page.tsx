"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = await signIn("credentials", { email, password, redirect: false });
    if (result?.error) {
      setError("Invalid email or password");
    } else {
      router.push("/scan");
    }
  };

  return (
    <main style={{ maxWidth: 400, margin: "0 auto", padding: "2rem" }}>
      <h1 style={{ marginBottom: "1rem" }}>Login</h1>
      {error && <p style={{ color: "#f87171", marginBottom: "1rem" }}>{error}</p>}
      <form onSubmit={handleSubmit}>
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required
          style={{ width: "100%", padding: "0.75rem", marginBottom: "0.75rem", background: "#111", border: "1px solid #333", borderRadius: 8, color: "#e0e0e0" }} />
        <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required
          style={{ width: "100%", padding: "0.75rem", marginBottom: "1rem", background: "#111", border: "1px solid #333", borderRadius: 8, color: "#e0e0e0" }} />
        <button type="submit" style={{ width: "100%", padding: "0.75rem", background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, fontSize: "1rem" }}>
          Sign In
        </button>
      </form>
      <p style={{ textAlign: "center", marginTop: "1rem", color: "#666" }}>
        No account? <Link href="/auth/register" style={{ color: "#60a5fa" }}>Register</Link>
      </p>
    </main>
  );
}
