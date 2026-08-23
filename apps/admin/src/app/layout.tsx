import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MQTT Chat — Admin",
  description: "Admin dashboard for the MQTT chat demo platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="h-full">{children}</body>
    </html>
  );
}
