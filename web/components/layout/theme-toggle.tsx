"use client";

import { Button } from "@heroui/react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { LuMoon, LuSun } from "react-icons/lu";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // The server has no idea which theme the browser will resolve to, so
  // *everything* that depends on it — the icon and the label alike — has to
  // wait for hydration. Gating only the icon leaves the aria-label mismatching
  // between server and client, which React reports as a hydration error.
  useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === "dark";

  return (
    <Button
      isIconOnly
      variant="ghost"
      size="sm"
      aria-label={
        mounted
          ? isDark
            ? "Switch to light theme"
            : "Switch to dark theme"
          : "Toggle theme"
      }
      onPress={() => setTheme(isDark ? "light" : "dark")}
    >
      {mounted ? isDark ? <LuSun /> : <LuMoon /> : <span className="size-4" />}
    </Button>
  );
}
