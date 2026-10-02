const { app, BrowserWindow, dialog, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Keep the library in a fixed folder regardless of the package name.
if (!app.commandLine.hasSwitch('user-data-dir')) {
  app.setPath('userData', path.join(app.getPath('appData'), 'ereader'));
}

let win;

// ---------- library ----------
const LIB_DIR = () => path.join(app.getPath('userData'), 'books');
const LIB_FILE = () => path.join(app.getPath('userData'), 'library.json');

function loadLib() { try { return JSON.parse(fs.readFileSync(LIB_FILE(), 'utf8')); } catch { return []; } }
function saveLib(lib) { fs.mkdirSync(LIB_DIR(), { recursive: true }); fs.writeFileSync(LIB_FILE(), JSON.stringify(lib, null, 2)); }
function sortedLib() { return loadLib().sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0)); }

function addBuffer(buf, name) {
  const id = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16);
  const lib = loadLib();
  let e = lib.find((b) => b.id === id);
  if (!e) {
    fs.mkdirSync(LIB_DIR(), { recursive: true });
    const file = path.join(LIB_DIR(), id + '.pdf');
    fs.writeFileSync(file, buf);
    e = { id, name, file, added: Date.now(), page: 1, pages: 0 };
    lib.push(e);
  }
  e.lastOpened = Date.now();
  saveLib(lib);
  return e;
}
function addPath(p) { return addBuffer(fs.readFileSync(p), path.basename(p)); }

function bookPayload(e) {
  const data = fs.readFileSync(e.file);
  return { id: e.id, name: e.name, page: e.page || 1, data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) };
}

ipcMain.handle('lib-list', () => sortedLib());
ipcMain.handle('lib-open', (_e, id) => {
  const lib = loadLib(); const e = lib.find((b) => b.id === id);
  if (!e || !fs.existsSync(e.file)) return null;
  e.lastOpened = Date.now(); saveLib(lib);
  return bookPayload(e);
});
ipcMain.handle('lib-remove', (_e, id) => {
  const lib = loadLib(); const e = lib.find((b) => b.id === id);
  if (e) { try { fs.unlinkSync(e.file); } catch {} }
  saveLib(lib.filter((b) => b.id !== id));
  return sortedLib();
});
ipcMain.handle('lib-progress', (_e, id, page, pages) => {
  const lib = loadLib(); const e = lib.find((b) => b.id === id);
  if (e) { e.page = page; e.pages = pages; saveLib(lib); }
});
ipcMain.handle('add-path', (_e, p) => bookPayload(addPath(p)));
ipcMain.handle('add-buffer', (_e, name, buf) => bookPayload(addBuffer(Buffer.from(buf), name)));
ipcMain.handle('open-dialog', async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (r.canceled || !r.filePaths.length) return null;
  let last = null;
  for (const p of r.filePaths) last = addPath(p);
  return bookPayload(last);
});

// ---------- Claude hook toggle (hooks do nothing while this file exists) ----------
const OFF_FLAG = () => path.join(app.getPath('home'), '.ereader', 'claude-off');
ipcMain.handle('hook-get', () => !fs.existsSync(OFF_FLAG()));
ipcMain.handle('hook-set', (_e, enabled) => {
  fs.mkdirSync(path.dirname(OFF_FLAG()), { recursive: true });
  if (enabled) { try { fs.unlinkSync(OFF_FLAG()); } catch {} }
  else fs.writeFileSync(OFF_FLAG(), '');
  return !fs.existsSync(OFF_FLAG());
});

// ---------- window ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1100, height: 900, minWidth: 600, minHeight: 500,
    backgroundColor: '#0e0e0e',
    titleBarStyle: 'hiddenInset',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, 'app', 'index.html'));
  win.webContents.on('did-finish-load', () => {
    const arg = process.argv.slice(app.isPackaged ? 1 : 2).find((a) => /\.pdf$/i.test(a));
    if (arg && fs.existsSync(arg)) win.webContents.send('open-path', path.resolve(arg));
    // Dev helper: EREADER_SHOT=<file.png> saves a screenshot and quits.
    if (process.env.EREADER_SHOT) {
      setTimeout(async () => {
        fs.writeFileSync(process.env.EREADER_SHOT, (await win.webContents.capturePage()).toPNG());
        app.quit();
      }, 2500);
    }
  });
}

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', (_e, argv) => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
  const arg = argv.find((a) => /\.pdf$/i.test(a));
  if (arg && fs.existsSync(arg)) win.webContents.send('open-path', path.resolve(arg));
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { label: 'File', submenu: [
      { label: 'Add PDF…', accelerator: 'CmdOrCtrl+O', click: () => win.webContents.send('menu-open') },
      { label: 'Library', accelerator: 'CmdOrCtrl+L', click: () => win.webContents.send('menu-library') },
      { type: 'separator' }, { role: 'close' },
    ] },
    { label: 'View', submenu: [{ role: 'togglefullscreen' }, { role: 'reload' }, { role: 'toggleDevTools' }] },
  ]));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else { win.show(); win.focus(); }
  });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
