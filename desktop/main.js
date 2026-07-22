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
const { spawn } = require("node:child_process");
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
    // Dev: run the catalog's own dev server (needs Node/npm on the dev machine).
    serverProc = spawn("npm", ["run", "dev"], {
      cwd: path.join(__dirname, "..", "catalog"),
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
