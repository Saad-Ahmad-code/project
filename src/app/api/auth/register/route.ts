/**
 * Registration endpoint — uses local JSON storage (no MongoDB needed)
 */
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";

export async function POST(request: NextRequest) {
  try {
    const { email, password, name } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password required" }, { status: 400 });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }

    const { db } = await import("@/lib/mongodb");
    const users = db("users");

    const existing = users.findOne({ email: email.toLowerCase() });
    if (existing) {
      return NextResponse.json({ error: "Email already registered" }, { status: 409 });
    }

    const hashed = await bcrypt.hash(password, 12);
    users.insertOne({
      email: email.toLowerCase(),
      password: hashed,
      name: name || email.split("@")[0],
      created_at: new Date().toISOString(),
    });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Registration failed" }, { status: 500 });
  }
}
