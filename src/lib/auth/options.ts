/**
 * NextAuth options — uses local JSON storage (no MongoDB needed)
 */
import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        try {
          const { db } = await import("@/lib/mongodb");
          const users = db("users");

          const user = users.findOne({ email: credentials.email.toLowerCase() });
          if (!user) return null;

          const valid = await bcrypt.compare(credentials.password, user.password);
          if (!valid) return null;

          return {
            id: user._id || user.id,
            email: user.email,
            name: user.name || user.email.split("@")[0],
          };
        } catch {
          return null;
        }
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: {
    signIn: "/auth/login",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { id: string }).id = token.id as string;
      }
      return session;
    },
  },
};
