import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MQTT Chat",
  description: "Realtime chat demo — MQTT + Next.js monorepo",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="h-full">{children}</body>
    </html>
  );
}
