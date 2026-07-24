// Piezario desktop shell.
//
// Piezario is a real server-side Next.js app (it reads the catalog off disk,
// spawns the file manager, writes back to READMEs). So instead of shipping
// static HTML, this Electron shell runs the production Next server as a child
// process and points a window at it. The server is the one built by
// `next build` (output: "standalone"); we run it with Electron's OWN bundled
// Node (ELECTRON_RUN_AS_NODE=1), which is why an end user needs no Node, npm or
// terminal — they open the AppImage and that is it.
//
// The whole catalog is wired from one env var: CATALOG_CONFIG points at the
// user's catalog.yaml, and Next resolves models/ fonts/ icons/ relative to it.

const { app, BrowserWindow, clipboard, dialog, Menu, shell } = require("electron");
const { spawn, execFileSync } = require("node:child_process");

// Run without Chromium's sandbox. An AppImage mounts read-only, so its
// `chrome-sandbox` helper can't be root:4755, and modern Ubuntu/GNOME also
// restrict the namespace-sandbox fallback via AppArmor — either way Electron
// would refuse to start on many end-user machines. Disabling the sandbox is the
// standard fix for a distributable AppImage and is safe here: Piezario only
// loads its OWN localhost server, never untrusted web content, so the sandbox
// (which exists to contain hostile web pages) protects nothing.
app.commandLine.appendSwitch("no-sandbox");

// (The window's X11 WM_CLASS — which GNOME uses to pick the taskbar icon — is
// "piezario-desktop", derived by Electron from this package's `name`. Chromium's
// --class switch does NOT override it under Ozone. The .desktop file's
// StartupWMClass is pinned to match in package.json; see desktop/AGENTS.md.)

// In a Wayland session: run under XWayland and uncap the frame rate.
//
// Two separate problems have to be balanced here:
//
//  1. Native Wayland (`--ozone-platform=wayland`) WEDGES THE COMPOSITOR on some
//     setups — reproduced on Ubuntu 26.04 / GNOME with an AMD/Mesa-26 GPU: the
//     page renders fully in the DOM but no frame is ever painted, so the window
//     is blank. So we must NOT force native Wayland; we run under XWayland
//     (Electron's default), where the same machine paints correctly with full
//     out-of-process, hardware-accelerated compositing.
//
//  2. But under XWayland a fractional-scaled or ultrawide display can expose a
//     bogus low virtual refresh rate (e.g. a 10240×2880 framebuffer reported at
//     ~24 Hz). Electron would then paint at that rate and scrolling/animations
//     stutter. Uncapping the frame rate (disable-gpu-vsync +
//     disable-frame-rate-limit) makes Electron paint as fast as it can instead
//     of throttling to the bogus refresh, so scrolling is smooth again.
//
// Net effect: it both renders AND scrolls smoothly, without the native-Wayland
// blank-window risk. Explicitly pin ozone to x11 so this holds even if a future
// Electron changes its default backend.
//
// (TEXT scaling — Settings → Accessibility → Large Text — is separate; GTK apps
// and browsers apply it but Electron does not, so desktopTextScale() below
// reads it and applies it as the window zoom.)
const isWaylandSession =
  process.platform === "linux" &&
  (process.env.XDG_SESSION_TYPE === "wayland" || Boolean(process.env.WAYLAND_DISPLAY));
if (isWaylandSession) {
  app.commandLine.appendSwitch("ozone-platform", "x11");
  app.commandLine.appendSwitch("disable-gpu-vsync");
  app.commandLine.appendSwitch("disable-frame-rate-limit");
}

// GNOME's text-scaling-factor (1.0 when unset). Best-effort, Linux/GNOME only.
function desktopTextScale() {
  if (process.platform !== "linux") return 1;
  try {
    const out = execFileSync(
      "gsettings",
      ["get", "org.gnome.desktop.interface", "text-scaling-factor"],
      { encoding: "utf8" },
    );
    const factor = parseFloat(out.trim());
    return Number.isFinite(factor) && factor > 0 ? factor : 1;
  } catch {
    return 1;
  }
}
const http = require("node:http");
const net = require("node:net");
const fs = require("node:fs");
const path = require("node:path");

const IS_DEV = process.env.NEXT_DEV === "1";

// --- persisted settings -----------------------------------------------------

function configFile() {
  return path.join(app.getPath("userData"), "config.json");
}

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(configFile(), "utf8"));
  } catch {
    return {};
  }
}

function saveSettings(settings) {
  fs.mkdirSync(path.dirname(configFile()), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify(settings, null, 2));
}

// A valid catalog folder is one that holds a catalog.yaml.
function isCatalogDir(dir) {
  return !!dir && fs.existsSync(path.join(dir, "catalog.yaml"));
}

// Create the minimal skeleton so an empty folder becomes a usable catalog.
function scaffoldCatalog(dir) {
  for (const sub of ["models", "fonts", "icons"]) {
    fs.mkdirSync(path.join(dir, sub), { recursive: true });
  }
  const yaml = path.join(dir, "catalog.yaml");
  if (!fs.existsSync(yaml)) {
    fs.writeFileSync(
      yaml,
      [
        "# Piezario catalog settings.",
        "models_dir: models",
        "fonts_dir: fonts",
        "icons_dir: icons",
        "",
      ].join("\n"),
    );
  }
}

// Ask the user for a catalog folder. Returns a valid dir or null if cancelled.
async function pickCatalogDir(win) {
  const result = await dialog.showOpenDialog(win ?? undefined, {
    title: "Choose your Piezario catalog folder",
    message: "Pick the folder that contains catalog.yaml (models, fonts, icons).",
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;

  const dir = result.filePaths[0];
  if (isCatalogDir(dir)) return dir;

  const { response } = await dialog.showMessageBox(win ?? undefined, {
    type: "question",
    buttons: ["Set up here", "Choose another folder", "Cancel"],
    defaultId: 0,
    cancelId: 2,
    title: "No catalog found",
    message: "This folder has no catalog.yaml.",
    detail: `Create an empty catalog (models/, fonts/, icons/) in:\n${dir}?`,
  });
  if (response === 0) {
    scaffoldCatalog(dir);
    return dir;
  }
  if (response === 1) return pickCatalogDir(win);
  return null;
}

// --- the Next server child --------------------------------------------------

function serverEntry() {
  // Packaged: extraResources put the staged server under resources/app-server.
  // Unpackaged production run: desktop/staging/app-server (from `npm run stage`).
  return app.isPackaged
    ? path.join(process.resourcesPath, "app-server", "server.js")
    : path.join(__dirname, "staging", "app-server", "server.js");
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function waitForServer(port, timeoutMs = 30000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(
        { host: "127.0.0.1", port, path: "/", timeout: 2000 },
        (res) => {
          res.destroy();
          resolve();
        },
      );
      req.on("error", retry);
      req.on("timeout", () => {
        req.destroy();
        retry();
      });
    };
    const retry = () => {
      if (Date.now() - started > timeoutMs) {
        reject(new Error("The catalog server did not start in time."));
      } else {
        setTimeout(attempt, 250);
      }
    };
    attempt();
  });
}

let serverProc = null;

async function startServer(catalogDir, port) {
  const env = {
    ...process.env,
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    CATALOG_CONFIG: path.join(catalogDir, "catalog.yaml"),
    NODE_ENV: "production",
  };

  if (IS_DEV) {
    // Dev: run the web app's own dev server (needs Node/npm on the dev machine).
    serverProc = spawn("npm", ["run", "dev"], {
      cwd: path.join(__dirname, "..", "web"),
      env,
      stdio: "inherit",
    });
  } else {
    const entry = serverEntry();
    if (!fs.existsSync(entry)) {
      throw new Error(
        `Catalog server not found at ${entry}. Run "npm run stage" (or ` +
          `"npm run build:linux") first.`,
      );
    }
    // ELECTRON_RUN_AS_NODE=1 runs the bundled Node with no Chromium, so the
    // packaged app carries its own runtime — nothing to install.
    serverProc = spawn(process.execPath, [entry], {
      cwd: path.dirname(entry),
      env: { ...env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: "inherit",
    });
  }

  const proc = serverProc;
  proc.on("exit", (code) => {
    if (serverProc === proc) serverProc = null;
    // A SIGTERM we sent (quit or catalog-folder restart) surfaces as code 143;
    // only report exits we did not ask for.
    if (code && code !== 0 && !app.isQuitting && !proc.expectedExit) {
      dialog.showErrorBox(
        "Catalog server stopped",
        `The catalog server exited unexpectedly (code ${code}).`,
      );
    }
  });

  await waitForServer(port);
}

function stopServer() {
  if (serverProc) {
    serverProc.expectedExit = true;
    serverProc.kill();
    serverProc = null;
  }
}

// --- about ------------------------------------------------------------------

// The build stamp written by build-info.js. Absent in dev (and if a build ever
// skips the step), so every field is optional and the dialog omits what it
// lacks — an About box must never be the thing that crashes the app.
function buildInfo() {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(__dirname, "build-info.json"), "utf8"),
    );
  } catch {
    return {};
  }
}

// ISO 8601 UTC → the user's locale, so "2026-07-24T09:12:03Z" reads as a date
// rather than a machine string. Falls back to the raw value if unparseable.
function formatBuildDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    dateStyle: "long",
    timeStyle: "short",
  });
}

// The lines shown in the About dialog, also used verbatim for "Copy details" so
// a bug report can carry the exact build that produced it.
function aboutLines() {
  const { builtAt, commit } = buildInfo();
  const lines = [`Version ${app.getVersion()}`];

  if (builtAt) lines.push(`Built ${formatBuildDate(builtAt)}`);
  // A dev run has no stamp; say so rather than showing a bare version that
  // could be mistaken for a release build.
  else lines.push("Built from source (development)");

  if (commit) lines.push(`Commit ${commit}`);
  lines.push("", `Electron ${process.versions.electron}`);
  lines.push(`Chromium ${process.versions.chrome}`);
  lines.push(`Node ${process.versions.node}`);

  const { catalogDir } = loadSettings();
  if (catalogDir) lines.push("", `Catalog folder: ${catalogDir}`);

  return lines;
}

async function showAbout() {
  const detail = aboutLines().join("\n");
  const { response } = await dialog.showMessageBox(mainWindow ?? undefined, {
    type: "info",
    title: "About Piezario",
    message: "Piezario",
    detail,
    buttons: ["OK", "Copy details"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  if (response === 1) clipboard.writeText(`Piezario\n${detail}`);
}

// --- window + menu ----------------------------------------------------------

let mainWindow = null;
let currentPort = null;

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    title: "Piezario",
    backgroundColor: "#0a0a0a",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Keep external links (source URLs, licenses) in the real browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  // Apply GNOME's text-scaling factor as zoom so text matches the browser.
  // Re-applied on every load because a fresh navigation resets the zoom.
  const textScale = desktopTextScale();
  if (textScale !== 1) {
    mainWindow.webContents.on("did-finish-load", () => {
      mainWindow.webContents.setZoomFactor(textScale);
    });
  }

  mainWindow.loadURL(`http://127.0.0.1:${port}/`);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function changeCatalogFolder() {
  const dir = await pickCatalogDir(mainWindow);
  if (!dir) return;

  const settings = loadSettings();
  settings.catalogDir = dir;
  saveSettings(settings);

  // Restart the server against the new folder and reload.
  stopServer();
  const port = await freePort();
  currentPort = port;
  await startServer(dir, port);
  if (mainWindow) mainWindow.loadURL(`http://127.0.0.1:${port}/`);
}

function buildMenu() {
  const template = [
    {
      label: "File",
      submenu: [
        { label: "Change catalog folder…", click: () => changeCatalogFolder() },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { type: "separator" },
        // Not the built-in resetZoom role: that hardcodes 1.0 and would throw
        // away the desktop text scale applied in createWindow().
        {
          label: "Actual Size",
          accelerator: "CommandOrControl+0",
          click: (_item, win) => {
            const target = win ?? mainWindow;
            if (target) target.webContents.setZoomFactor(desktopTextScale());
          },
        },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Help",
      role: "help",
      submenu: [{ label: "About Piezario", click: () => showAbout() }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// --- lifecycle --------------------------------------------------------------

async function boot() {
  buildMenu();

  let settings = loadSettings();
  if (!isCatalogDir(settings.catalogDir)) {
    const dir = await pickCatalogDir(null);
    if (!dir) {
      app.quit();
      return;
    }
    settings.catalogDir = dir;
    saveSettings(settings);
  }

  try {
    const port = await freePort();
    currentPort = port;
    await startServer(settings.catalogDir, port);
    createWindow(port);
  } catch (err) {
    dialog.showErrorBox("Piezario failed to start", String(err?.message ?? err));
    app.quit();
  }
}

app.whenReady().then(boot);

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 && currentPort) {
    createWindow(currentPort);
  }
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", () => {
  app.isQuitting = true;
  stopServer();
});
