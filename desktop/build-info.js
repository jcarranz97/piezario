// Bake the build stamp into the packaged app.
//
// The About dialog shows *when* a build was produced and *what commit* it came
// from. Neither is knowable at runtime — a packaged AppImage has no git repo and
// its file mtimes are normalised by squashfs — so they are captured here, at
// build time, into build-info.json, which electron-builder ships alongside
// main.js (see `build.files` in package.json).
//
// The version is NOT stored here: it lives in package.json, which the release
// workflow rewrites from the git tag, and main.js reads it via app.getVersion().
// Keeping one source of truth avoids the two drifting apart.
//
// This runs in both `build:linux` and `build:win`. It must never fail a build:
// the stamp is diagnostic, so anything unavailable degrades to null and the
// About dialog just omits that line.

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function git(args) {
  try {
    return execFileSync("git", args, {
      cwd: __dirname,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    // No git, no repo, or a shallow/exportless tarball — all non-fatal.
    return null;
  }
}

// SOURCE_DATE_EPOCH is the reproducible-builds convention; honour it when set so
// a rebuild of the same source can produce the same stamp.
const epoch = Number(process.env.SOURCE_DATE_EPOCH);
const builtAt = Number.isFinite(epoch) && epoch > 0 ? new Date(epoch * 1000) : new Date();

const info = {
  // ISO 8601 UTC — formatted for display at runtime, so the stored value stays
  // locale-independent and sortable.
  builtAt: builtAt.toISOString(),
  commit: git(["rev-parse", "--short", "HEAD"]),
};

const target = path.join(__dirname, "build-info.json");
fs.writeFileSync(target, `${JSON.stringify(info, null, 2)}\n`);
console.log(
  `[build-info] ${info.builtAt}${info.commit ? ` (${info.commit})` : ""} → ${target}`,
);
