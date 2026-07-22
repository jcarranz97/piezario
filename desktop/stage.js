// Assemble the self-contained Next server that gets bundled into the AppImage.
//
// `next build` (with output: "standalone") leaves the server in
// ../web/.next/standalone but, by Next's design, does NOT copy the static
// assets or a public/ folder into it — that is the caller's job. We gather
// everything into desktop/staging/app-server, which electron-builder then ships
// as an extraResource. main.js runs staging/app-server/server.js at runtime.
const fs = require("node:fs");
const path = require("node:path");

const webApp = path.join(__dirname, "..", "web");
const standalone = path.join(webApp, ".next", "standalone");
const staticDir = path.join(webApp, ".next", "static");
const staging = path.join(__dirname, "staging");
const out = path.join(staging, "app-server");

if (!fs.existsSync(standalone)) {
  console.error(
    `[stage] ${standalone} not found — run the web build first ` +
      `(npm run build:web).`,
  );
  process.exit(1);
}

// Start clean so a stale server can never leak into a new build.
fs.rmSync(staging, { recursive: true, force: true });
fs.mkdirSync(staging, { recursive: true });

// The standalone tree already carries server.js, its minimal node_modules and
// the server-side .next chunks.
fs.cpSync(standalone, out, { recursive: true });

// Static assets live outside the standalone tree; Next expects them copied to
// <server>/.next/static. There is no public/ folder in this app.
fs.cpSync(staticDir, path.join(out, ".next", "static"), { recursive: true });

if (!fs.existsSync(path.join(out, "server.js"))) {
  console.error(
    `[stage] server.js not found in ${out}. The standalone layout is ` +
      `unexpected — check outputFileTracingRoot in web/next.config.ts.`,
  );
  process.exit(1);
}

console.log(`[stage] staged Next server → ${out}`);
