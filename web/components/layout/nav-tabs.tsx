"use client";

import { Tabs } from "@heroui/react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { id: "models", href: "/", label: "Models" },
  { id: "fonts", href: "/fonts", label: "Fonts" },
  { id: "icons", href: "/icons", label: "Icons" },
  { id: "filaments", href: "/filaments", label: "Filaments" },
  { id: "supplies", href: "/supplies", label: "Supplies" },
  { id: "others", href: "/others", label: "Others" },
];

/**
 * Top navigation, HeroUI Tabs with the underlined indicator.
 *
 * Each tab is a Next link and the active one is derived from the pathname, so
 * it stays in sync with client-side navigation and with a hard reload alike.
 */
export function NavTabs() {
  const pathname = usePathname();
  const selectedKey = pathname.startsWith("/fonts")
    ? "fonts"
    : pathname.startsWith("/icons")
      ? "icons"
      : pathname.startsWith("/filaments")
        ? "filaments"
        : pathname.startsWith("/supplies")
          ? "supplies"
          : pathname.startsWith("/others")
            ? "others"
            : "models";

  return (
    <Tabs variant="secondary" selectedKey={selectedKey} className="h-11">
      <Tabs.ListContainer>
        <Tabs.List aria-label="Sections" className="min-h-11 border-b-0">
          {TABS.map((tab) => (
            <Tabs.Tab
              key={tab.id}
              id={tab.id}
              href={tab.href}
              className="min-h-11 w-auto whitespace-nowrap"
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              render={(domProps: any) => <Link {...domProps} />}
            >
              {tab.label}
              <Tabs.Indicator />
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs.ListContainer>
    </Tabs>
  );
}
