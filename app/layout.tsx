import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "JobMonitor — Monitor job pages",
  description: "Add job search URLs and get alerted when new jobs appear.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
