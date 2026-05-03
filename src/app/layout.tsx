import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Sidebar } from "./sidebar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Huny Money",
  description: "Crypto trading dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-screen flex bg-gray-900 text-gray-100">
        <Sidebar />
        <div className="flex-1 flex flex-col min-h-screen ml-56">
          <header className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-700 bg-gray-900/95 backdrop-blur px-6 py-3">
            <h1 className="text-xl font-bold tracking-tight text-white">
              Huny Money
            </h1>
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-900/50 border border-amber-600/40 px-3 py-1 text-xs font-medium text-amber-300">
                PAPER MODE
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-800 border border-gray-600/40 px-3 py-1 text-xs font-medium text-gray-300">
                System Active
              </span>
            </div>
          </header>
          <main className="flex-1 p-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
