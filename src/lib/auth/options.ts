import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { MongoClient } from "mongodb";
import bcrypt from "bcryptjs";

const MONGODB_URI = process.env.MONGODB_URI || "";

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
          if (!MONGODB_URI) return null;
          const client = await MongoClient.connect(MONGODB_URI);
          try {
            const db = client.db(process.env.MONGODB_DB || "menulens");
            const users = db.collection("users");

            const user = await users.findOne({ email: credentials.email.toLowerCase() });
            if (!user) return null;

            const valid = await bcrypt.compare(credentials.password, user.password);
            if (!valid) return null;

            return {
              id: user._id.toString(),
              email: user.email,
              name: user.name || user.email.split("@")[0],
            };
          } finally {
            await client.close();
          }
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
