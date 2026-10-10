import type { Metadata } from "next";
import "./globals.css";
import QuickExit from "@/components/QuickExit";

export const metadata: Metadata = {
  title: "Daybook",
  description: "A private daily journal.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <QuickExit />
        {children}
      </body>
    </html>
  );
}
