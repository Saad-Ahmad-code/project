import type { Metadata } from "next";
import { Providers } from "@/components/ui/Providers";
import { Navbar } from "@/components/ui/Navbar";
import "./globals.css";

export const metadata: Metadata = {
  title: "MenuLens",
  description: "Scan and analyze restaurant menus with AI",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <Navbar />
          {children}
        </Providers>
      </body>
    </html>
  );
}
