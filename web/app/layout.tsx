import type { Metadata } from "next";
import Link from "next/link";
import { LuBox } from "react-icons/lu";

import { NavTabs } from "@/components/layout/nav-tabs";
import { ThemeToggle } from "@/components/layout/theme-toggle";

import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "3D Catalog",
  description: "A catalog of my 3D models, generated from the repository itself.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <body className="flex min-h-full flex-col">
        <Providers>
          <header className="sticky top-0 z-40 border-b border-[var(--card-border)] bg-[var(--background)]/85 backdrop-blur">
            <div className="mx-auto flex w-full max-w-6xl items-center gap-6 px-4 py-3">
              <Link
                href="/"
                className="flex shrink-0 items-center gap-2 font-semibold tracking-tight"
              >
                <LuBox className="size-5 text-[var(--accent-strong)]" />
                3D Catalog
              </Link>
              <NavTabs />
              <div className="ml-auto">
                <ThemeToggle />
              </div>
            </div>
          </header>
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
            {children}
          </main>
          <footer className="border-t border-[var(--card-border)] px-4 py-6 text-center text-sm text-muted">
            Built from the contents of <code>models/</code> — no database.
          </footer>
        </Providers>
      </body>
    </html>
  );
}
