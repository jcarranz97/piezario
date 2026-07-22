"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider defaultTheme="system" attribute="data-theme">
      {children}
    </NextThemesProvider>
  );
}
