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

const { app, BrowserWindow, dialog, Menu, shell } = require("electron");
const { spawn, execFileSync } = require("node:child_process");

// Run without Chromium's sandbox. An AppImage mounts read-only, so its
// `chrome-sandbox` helper can't be root:4755, and modern Ubuntu/GNOME also
// restrict the namespace-sandbox fallback via AppArmor — either way Electron
// would refuse to start on many end-user machines. Disabling the sandbox is the
// standard fix for a distributable AppImage and is safe here: Piezario only
// loads its OWN localhost server, never untrusted web content, so the sandbox
// (which exists to contain hostile web pages) protects nothing.
app.commandLine.appendSwitch("no-sandbox");

// Run the GPU pipeline inside the main process instead of a separate GPU
// process. On some Linux desktops (observed on a fresh Ubuntu 26.04 / GNOME
// Wayland session with this Electron's bundled GPU stack) the out-of-process
// GPU compositor wedges: the page renders fully in the DOM but the compositor
// never produces a painted frame, so the window shows only its background — a
// blank screen. `--disable-gpu` does NOT fix it (the compositor still stalls);
// running the GPU in-process does. The cost is negligible for a local catalog
// browser, and it makes the distributed AppImage paint reliably across the wide
// range of end-user Linux machines Piezario has to run on unmodified.
if (process.platform === "linux") {
  app.commandLine.appendSwitch("in-process-gpu");
}

// Use native Wayland when we're in a Wayland session.
//
// Electron otherwise runs under XWayland, and on a fractional-scaled or
// ultrawide display XWayland can expose a bogus low virtual refresh rate
// (e.g. a 10240×2880 framebuffer reported at ~24 Hz). Electron then paints at
// that rate, so scrolling and animations stutter badly — while the user's
// browser, on native Wayland, runs at the display's true (high) refresh and
// looks smooth. Forcing the Wayland backend fixes both the refresh rate and
// fractional DISPLAY scaling in one go. We fall back to the default (X11) on
// non-Wayland sessions so the same AppImage still runs everywhere.
//
// (TEXT scaling — Settings → Accessibility → Large Text — is separate; GTK apps
// and browsers apply it but Electron does not, so desktopTextScale() below
// reads it and applies it as the window zoom.)
const isWaylandSession =
  process.platform === "linux" &&
  (process.env.XDG_SESSION_TYPE === "wayland" || Boolean(process.env.WAYLAND_DISPLAY));
if (isWaylandSession) {
  app.commandLine.appendSwitch("ozone-platform", "wayland");
  // Ensure GNOME (client-side decorations) still gives the window a title bar
  // and resize borders under the Wayland backend.
  app.commandLine.appendSwitch("enable-features", "WaylandWindowDecorations");
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

  serverProc.on("exit", (code) => {
    serverProc = null;
    if (code && code !== 0 && !app.isQuitting) {
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
    serverProc.kill();
    serverProc = null;
  }
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
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        { role: "toggleDevTools" },
      ],
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
