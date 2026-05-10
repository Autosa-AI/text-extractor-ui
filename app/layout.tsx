import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Text Extractor — Autosa",
  description: "Extract text from PDFs, images, and office documents",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
