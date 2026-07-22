import path from "node:path";

import type { NextConfig } from "next";

// The catalog reads the models tree on every request so that editing a README
// and refreshing the browser shows the change immediately. That freshness comes
// from `export const dynamic = "force-dynamic"` in the pages themselves, so
// there is nothing to configure there.
//
// `output: "standalone"` is what lets Piezario ship as a desktop app: `next
// build` emits a self-contained `.next/standalone/server.js` with only the
// node_modules it needs, and the Electron shell (../desktop) spawns that server
// with the bundled Node. Nothing else about the app changes.
//
// `outputFileTracingRoot` pins the standalone root to this folder. Without it,
// Next walks up looking for the workspace root and, seeing the sibling
// `desktop/` package, could place `server.js` under a nested path — pinning it
// keeps the layout predictable for the staging step.
const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
