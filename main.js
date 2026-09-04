const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

let win = null;
const root      = () => app.getPath('userData');
const libPath   = () => path.join(root(), 'library.json');
const booksDir  = () => path.join(root(), 'books');
const thumbsDir = () => path.join(root(), 'thumbs');

const DEFAULT_LIB = { settings: { theme: 'paper', sound: true }, books: [] };
const okId = id => typeof id === 'string' && /^[a-z0-9]+$/i.test(id);

function ensureDirs() {
  fs.mkdirSync(booksDir(), { recursive: true });
  fs.mkdirSync(thumbsDir(), { recursive: true });
}
function readLib() {
  try {
    const l = JSON.parse(fs.readFileSync(libPath(), 'utf8'));
    if (l && Array.isArray(l.books)) return l;
  } catch {}
  return JSON.parse(JSON.stringify(DEFAULT_LIB));
}
function writeLib(lib) { fs.writeFileSync(libPath(), JSON.stringify(lib, null, 2)); }
function hue(id) { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }

/* ---------------- IPC ---------------- */
ipcMain.handle('lib:load', async () => {
  const lib = readLib();
  for (const b of lib.books) {
    if (b.thumb) {
      try {
        const p = path.join(thumbsDir(), path.basename(b.thumb));
        b.thumbUrl = 'data:image/jpeg;base64,' + (await fsp.readFile(p)).toString('base64');
      } catch {}
    }
  }
  return lib;
});
ipcMain.handle('lib:save', (e, lib) => { writeLib(lib); return true; });
ipcMain.on('lib:save-sync', (e, lib) => { try { writeLib(lib); } catch {} });

ipcMain.handle('books:add', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Add PDF books to shelf',
    filters: [{ name: 'PDF books', extensions: ['pdf'] }],
    properties: ['openFile', 'multiSelections']
  });
  if (res.canceled || !res.filePaths.length) return null;
  ensureDirs();
  const lib = readLib();
  for (const src of res.filePaths) {
    const id = 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    await fsp.copyFile(src, path.join(booksDir(), id + '.pdf'));
    lib.books.push({
      id,
      title: path.basename(src, path.extname(src)),
      author: '', pages: 0, added: Date.now(),
      thumb: null, lastPage: 1, bookmarks: [], hue: hue(id)
    });
  }
  writeLib(lib);
  return lib;
});

ipcMain.handle('books:remove', async (e, id) => {
  if (!okId(id)) return readLib();
  const lib = readLib();
  lib.books = lib.books.filter(b => b.id !== id);
  writeLib(lib);
  await fsp.rm(path.join(booksDir(),  id + '.pdf'), { force: true });
  await fsp.rm(path.join(thumbsDir(), id + '.jpg'), { force: true });
  return lib;
});

ipcMain.handle('books:read', async (e, id) => {
  if (!okId(id)) throw new Error('bad id');
  return new Uint8Array(await fsp.readFile(path.join(booksDir(), id + '.pdf')));
});

ipcMain.handle('thumb:write', async (e, id, dataUrl) => {
  if (!okId(id)) return null;
  const b64 = String(dataUrl).split(',')[1] || '';
  const file = id + '.jpg';
  await fsp.writeFile(path.join(thumbsDir(), file), Buffer.from(b64, 'base64'));
  return 'thumbs/' + file;
});

/* ---------------- window ---------------- */
function createWindow() {
  win = new BrowserWindow({
    width: 1300, height: 850, minWidth: 760, minHeight: 560,
    backgroundColor: '#20150c', autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false
    }
  });
  win.loadFile('index.html');
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
  });
  win.on('closed', () => { win = null; });
}
Menu.setApplicationMenu(null);
app.whenReady().then(() => {
  ensureDirs();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => app.quit());
