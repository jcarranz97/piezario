// Intentionally minimal. The catalog is a normal web app served over
// http://127.0.0.1, so the renderer needs nothing from Electron — no bridge is
// exposed. contextIsolation stays on and nodeIntegration off (see main.js).
//
// If a future feature needs a native capability from the page (e.g. a nicer
// folder picker), expose it here with contextBridge.exposeInMainWorld rather
// than turning on nodeIntegration.
