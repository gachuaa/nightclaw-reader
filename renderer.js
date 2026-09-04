/* NightClaw Reader — v13: no password reset (change only),
   per-row add slots that stick, drag & drop between rows / drawer */
const $ = s => document.querySelector(s);

function fatal(msg) {
  document.body.insertAdjacentHTML('afterbegin',
    `<div style="position:fixed;top:0;left:0;right:0;z-index:999;background:#8a2020;color:#fff;padding:10px 16px;font:14px sans-serif">${msg}</div>`);
}
if (!window.pdfjsLib || !window.St) {
  fatal('Missing libraries (pdfjs / page-flip). Check the script tags in index.html and run npm install.');
  throw new Error('libraries missing');
}

const REQUIRED = ['shelf','shelves','reader','btnAdd','btnBack','bookTitle','btnToc','btnBmList','btnBm',
  'jumpBox','btnGo','btnZoomOut','zoomPct','btnZoomIn','zoomSlider','themeSel','btnLight','lightPop',
  'btnSound','btnFs','stage','stageDull','bookWrap','book','gutter','edgeL','edgeR','pageLight','stageDim','lightBeam',
  'slider','pageLabel','panel','panelTitle','panelClose','panelBody',
  'loading','loadMsg','toast','progWrap','progBar','progTxt',
  'drawerVault','vaultLabel','vaultTray','modal','mTitle','mMsg','mInput','mCancel','mOk'];
const missing = REQUIRED.filter(id => !document.getElementById(id));
if (missing.length) {
  fatal('index.html mismatched — missing elements: ' + missing.join(', '));
  throw new Error('missing elements: ' + missing.join(', '));
}

const St = window.St;
const pdfjs = window.pdfjsLib;
pdfjs.GlobalWorkerOptions.workerSrc = './node_modules/pdfjs-dist/build/pdf.worker.min.js';

const BASE_W = 560, QUALITY = 2.4, CACHE_MAX = 28;

const LIGHTS = [
  { n: 'Amber',     c: '#ffb75e' },
  { n: 'Candle',    c: '#ff9d45' },
  { n: 'Ember',     c: '#ff7b39' },
  { n: 'Soft',      c: '#fff3d6' },
  { n: 'Rose',      c: '#ffb3a7' },
  { n: 'Moonlight', c: '#bcd6ff' }
];

const state = {
  lib: null, book: null, pdf: null, flip: null,
  pages: [], numPages: 0, cur: 0, ratio: 1.5, zoom: 1,
  toc: null, panel: null, saveT: 0,
  flipping: false, fw: 0, fh: 0, refitT: 0,
  vaultOpen: false, dragId: null,
  cache: new Map(), order: [], busy: new Map()
};

/* ---------- helpers ---------- */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const trunc = (s, n) => { s = String(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const cleanLib = () => ({ ...state.lib, books: state.lib.books.map(({ thumbUrl, ...b }) => b) });
const saveLib = () => api.saveLibrary(cleanLib());
function saveSoon(){ clearTimeout(state.saveT); state.saveT = setTimeout(saveLib, 400); }
function toast(m, ms = 2600){
  const t = $('#toast'); t.textContent = m; t.hidden = false;
  clearTimeout(t._t); t._t = setTimeout(() => t.hidden = true, ms);
}
function debounce(fn, ms){ let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function hexRgb(h){ const v = parseInt(h.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; }

function canvasToUrl(cv){
  return new Promise(res => {
    cv.toBlob(b => res(b ? URL.createObjectURL(b) : cv.toDataURL('image/jpeg', 0.82)), 'image/jpeg', 0.82);
  });
}

/* ---------- SHA-256 (drawer password) ---------- */
const _K = [], _H = [];
(function(){
  let pc = 0; const isC = {};
  for (let cand = 2; pc < 64; cand++) {
    if (!isC[cand]) {
      for (let i = 0; i < 313; i += cand) isC[i] = cand;
      if (pc < 8) _H[pc] = (Math.pow(cand, .5) * 4294967296) | 0;
      _K[pc++] = (Math.pow(cand, 1/3) * 4294967296) | 0;
    }
  }
})();
const _rr = (v, a) => (v >>> a) | (v << (32 - a));
function sha256(str){
  let ascii; try { ascii = unescape(encodeURIComponent(str)); } catch (e) { ascii = String(str); }
  const bl = ascii.length * 8;
  const words = [];
  ascii += '\x80';
  while (ascii.length % 64 - 56) ascii += '\x00';
  for (let i = 0; i < ascii.length; i++) words[i >> 2] |= ascii.charCodeAt(i) << ((3 - i) % 4) * 8;
  words[words.length] = (bl / 4294967296) | 0;
  words[words.length] = bl | 0;
  const H = _H.slice();
  for (let j = 0; j < words.length;) {
    const w = words.slice(j, j += 16);
    for (let i = 16; i < 64; i++) {
      const w15 = w[i-15], w2 = w[i-2];
      w[i] = (w[i-16] + (_rr(w15,7) ^ _rr(w15,18) ^ (w15>>>3)) + w[i-7] + (_rr(w2,17) ^ _rr(w2,19) ^ (w2>>>10))) | 0;
    }
    let a=H[0],b=H[1],c=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7];
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (_rr(e,6) ^ _rr(e,11) ^ _rr(e,25)) + ((e&f) ^ (~e&g)) + _K[i] + w[i]) | 0;
      const t2 = ((_rr(a,2) ^ _rr(a,13) ^ _rr(a,22)) + ((a&b) ^ (a&c) ^ (b&c))) | 0;
      h=g; g=f; f=e; e=(d+t1)|0; d=c; c=b; b=a; a=(t1+t2)|0;
    }
    H[0]=(H[0]+a)|0; H[1]=(H[1]+b)|0; H[2]=(H[2]+c)|0; H[3]=(H[3]+d)|0;
    H[4]=(H[4]+e)|0; H[5]=(H[5]+f)|0; H[6]=(H[6]+g)|0; H[7]=(H[7]+h)|0;
  }
  return H.map(x => ('00000000' + (x >>> 0).toString(16)).slice(-8)).join('');
}

/* ---------- password modal (resolves string or null) ---------- */
function askSecret({ title, msg, okText = 'OK' }){
  return new Promise(resolve => {
    const m = $('#modal'), inp = $('#mInput');
    $('#mTitle').textContent = title;
    $('#mMsg').textContent = msg || '';
    $('#mOk').textContent = okText;
    inp.value = '';
    m.hidden = false;
    setTimeout(() => inp.focus(), 30);
    let done = false;
    const finish = val => {
      if (done) return; done = true;
      m.hidden = true;
      window.removeEventListener('keydown', onKey);
      resolve(val);
    };
    $('#mOk').onclick = () => finish(inp.value);
    $('#mCancel').onclick = () => finish(null);
    inp.onkeydown = e => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(inp.value);
    };
    function onKey(e){
      if (e.key === 'Escape') { e.preventDefault(); finish(null); }
    }
    window.addEventListener('keydown', onKey);
    m.onclick = e => { if (e.target === m) finish(null); };
  });
}

/* ---------- reading lamp ---------- */
function applyLight(){
  const s = state.lib.settings;
  s.light = s.light || { on: true, color: LIGHTS[0].c };
  const col = s.light.color || LIGHTS[0].c;
  const on = s.light.on !== false;
  const [r, g, b] = hexRgb(col);
  const rs = document.documentElement.style;
  rs.setProperty('--light', col);
  rs.setProperty('--lightGlow', `rgba(${r},${g},${b},.34)`);
  rs.setProperty('--lightSoft', `rgba(${r},${g},${b},.4)`);
  rs.setProperty('--lightTint', `rgba(${r},${g},${b},.4)`);
  rs.setProperty('--lightTintSoft', `rgba(${r},${g},${b},.18)`);
  document.body.classList.toggle('lamp-on', on);
  document.body.classList.toggle('lamp-off', !on);
  $('#btnLight').classList.toggle('on', on);
  document.querySelectorAll('.lp-dot').forEach(d => d.classList.toggle('on', d.dataset.c === col));
  const lt = document.getElementById('lightToggle');
  if (lt) lt.textContent = on ? 'On' : 'Off';
}
function buildLightPop(){
  const pop = $('#lightPop'); pop.innerHTML = '';
  const t = document.createElement('div'); t.className = 'lp-title';
  const lbl = document.createElement('span'); lbl.textContent = 'Reading light';
  const tg = document.createElement('button'); tg.className = 'lp-toggle'; tg.id = 'lightToggle';
  tg.onclick = e => {
    e.stopPropagation();
    const s = state.lib.settings; s.light = s.light || { on: true, color: LIGHTS[0].c };
    s.light.on = !(s.light.on !== false);
    saveSoon(); applyLight();
  };
  t.appendChild(lbl); t.appendChild(tg); pop.appendChild(t);
  const row = document.createElement('div'); row.className = 'lp-row';
  LIGHTS.forEach(l => {
    const d = document.createElement('button');
    d.className = 'lp-dot'; d.dataset.c = l.c;
    d.style.background = l.c; d.title = l.n;
    d.onclick = e => {
      e.stopPropagation();
      const s = state.lib.settings; s.light = s.light || { on: true, color: l.c };
      s.light.color = l.c; s.light.on = true;
      saveSoon(); applyLight();
    };
    row.appendChild(d);
  });
  pop.appendChild(row);
}

/* ---------- auto-hiding bars + scrollbar reveal ---------- */
let barsHideT = null, barFadeT = null;
const barsShown = () => !$('#reader').classList.contains('bars-hidden');
function showBars(){ clearTimeout(barsHideT); $('#reader').classList.remove('bars-hidden'); scheduleRefit(); }
function hideBars(){
  if ($('#panel').classList.contains('open') || !$('#loading').hidden) return;
  $('#reader').classList.add('bars-hidden');
  scheduleRefit();
}
function hideBarsSoon(d = 800){ clearTimeout(barsHideT); barsHideT = setTimeout(hideBars, d); }

function scheduleRefit(d = 340){
  clearTimeout(state.refitT);
  state.refitT = setTimeout(() => {
    if ($('#reader').hidden || !state.pdf || !state.flip) return;
    if (state.zoom > 1) return;
    if (state.flipping) { scheduleRefit(400); return; }
    const { pw, ph } = computeSize();
    if (pw === state.fw && ph === state.fh) return;
    rebuild();
  }, d);
}

document.addEventListener('mousemove', e => {
  if ($('#reader').hidden || !state.flip) return;
  const tb = $('#topbar').getBoundingClientRect();
  const bb = $('#botbar').getBoundingClientRect();
  const overBar = barsShown() && (e.clientY <= tb.bottom + 2 || e.clientY >= bb.top - 2);
  const hotEdge = !barsShown() && (e.clientY <= 14 || e.clientY >= window.innerHeight - 14);
  if (overBar) { showBars(); }
  else if (hotEdge) { showBars(); hideBarsSoon(1000); }
  else if (barsShown()) { hideBarsSoon(600); }
});

document.addEventListener('click', e => {
  const p = $('#lightPop');
  if (p.classList.contains('open') && !e.target.closest('#lightPop') && !e.target.closest('#btnLight')) {
    p.classList.remove('open');
  }
});

function wireStageUI(){
  const st = $('#stage');
  st.addEventListener('scroll', () => {
    st.classList.add('show-bars');
    clearTimeout(barFadeT);
    barFadeT = setTimeout(() => st.classList.remove('show-bars'), 900);
  });
  st.addEventListener('mousemove', e => {
    if (!st.classList.contains('stage-zoom')) return;
    const r = st.getBoundingClientRect();
    if (r.right - e.clientX < 30 || r.bottom - e.clientY < 30) {
      st.classList.add('show-bars');
      clearTimeout(barFadeT);
    }
  });
  st.addEventListener('mouseleave', () => {
    clearTimeout(barFadeT);
    barFadeT = setTimeout(() => st.classList.remove('show-bars'), 500);
  });
  let pan = null;
  st.addEventListener('mousedown', e => {
    if (state.zoom <= 1 || e.button !== 0) return;
    if (e.target.closest('.page')) return;
    pan = { x: e.clientX, y: e.clientY, sl: st.scrollLeft, stp: st.scrollTop };
    st.classList.add('panning');
    e.preventDefault();
  });
  window.addEventListener('mousemove', e => {
    if (!pan) return;
    st.scrollLeft = pan.sl - (e.clientX - pan.x);
    st.scrollTop  = pan.stp - (e.clientY - pan.y);
  });
  window.addEventListener('mouseup', () => { if (pan) { pan = null; st.classList.remove('panning'); } });
}

/* ---------- page-turn sound ---------- */
let actx = null;
function flipSound(){
  if (!state.lib || !state.lib.settings.sound) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    const dur = 0.26, sr = actx.sampleRate;
    const buf = actx.createBuffer(1, Math.floor(sr * dur), sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
    const src = actx.createBufferSource(); src.buffer = buf;
    src.playbackRate.value = 0.85 + Math.random() * 0.4;
    const f = actx.createBiquadFilter(); f.type = 'bandpass';
    f.frequency.value = 900 + Math.random() * 800; f.Q.value = 0.9;
    const g = actx.createGain(); const t = actx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.45, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(actx.destination); src.start();
  } catch (e) { console.warn('sound', e); }
}

/* ============================ SHELF / BOOKCASE ============================ */
function bookWidth(){
  const vmin = Math.min(window.innerWidth, window.innerHeight) / 100;
  return Math.max(74, Math.min(118, 10.2 * vmin));
}

/* drag & drop: books carry their row; trays accept drops */
function wireTrayDnD(tray, row){
  tray.addEventListener('dragover', e => { e.preventDefault(); tray.classList.add('drag-over'); });
  tray.addEventListener('dragleave', () => tray.classList.remove('drag-over'));
  tray.addEventListener('drop', e => {
    e.preventDefault();
    tray.classList.remove('drag-over');
    const id = e.dataTransfer.getData('text/plain');
    const b = state.lib.books.find(x => x.id === id);
    if (!b) return;
    const fromVault = !!b.hidden;
    b.hidden = false;
    b.row = row;
    saveSoon(); renderShelf();
    if (fromVault) toast('"' + trunc(b.title, 28) + '" back on the shelf — row ' + (row + 1));
  });
}

function renderShelf(){
  const wrap = $('#shelves'); wrap.innerHTML = '';
  const books = state.lib.books;
  /* normalize: every visible book must have a row */
  let maxRow = 0;
  books.forEach(b => {
    if (!b.hidden) {
      if (typeof b.row !== 'number') b.row = 0;
      maxRow = Math.max(maxRow, b.row);
    }
  });
  const bw = bookWidth();
  const rows = Math.max(2, maxRow + 1);          /* always at least 2 rows */
  for (let r = 0; r < rows; r++) {
    const row = document.createElement('div'); row.className = 'shelf-row';
    const tray = document.createElement('div'); tray.className = 'tray';
    books.filter(b => !b.hidden && b.row === r).forEach(b => tray.appendChild(bookEl(b, false)));
    tray.appendChild(ghostEl(r));                /* add slot on EVERY row */
    wireTrayDnD(tray, r);
    row.appendChild(tray);
    const board = document.createElement('div'); board.className = 'board';
    row.appendChild(board);
    wrap.appendChild(row);
  }
  renderVaultTray();
  updateDrawerUI();
}
function bookEl(b, inVault){
  const d = document.createElement('div'); d.className = 'bk';
  d.style.setProperty('--hue', b.hue != null ? b.hue : 32);
  d.title = b.title + (b.pages ? ` — page ${b.lastPage}/${b.pages}` : '');
  if (b.thumbUrl) {
    const im = new Image(); im.src = b.thumbUrl; im.draggable = false; d.appendChild(im);
    const t = document.createElement('div'); t.className = 'bk-title';
    t.textContent = b.title;
    d.classList.add('has-title');
    d.appendChild(t);
  } else {
    const s = document.createElement('div'); s.className = 'spine-txt'; s.textContent = b.title; d.appendChild(s);
  }
  if (b.pages && b.lastPage > 1) {
    const pr = document.createElement('div'); pr.className = 'prog';
    const f = document.createElement('i'); f.style.width = Math.round(100 * b.lastPage / b.pages) + '%';
    pr.appendChild(f); d.appendChild(pr);
  }
  const acts = document.createElement('div'); acts.className = 'bk-actions';
  if (!inVault) {
    const hide = document.createElement('button'); hide.className = 'bk-x'; hide.textContent = '⤵';
    hide.title = 'Hide in secret drawer';
    hide.onclick = async ev => { ev.stopPropagation(); await hideBook(b); };
    acts.appendChild(hide);
    const x = document.createElement('button'); x.className = 'bk-x'; x.textContent = '✕'; x.title = 'Remove';
    x.onclick = async ev => {
      ev.stopPropagation();
      if (!confirm('Remove "' + b.title + '" from the shelf?')) return;
      state.lib = await api.removeBook(b.id); renderShelf(); toast('Removed');
    };
    acts.appendChild(x);
  } else {
    const back = document.createElement('button'); back.className = 'bk-x'; back.textContent = '↑';
    back.title = 'Put back on shelf';
    back.onclick = ev => {
      ev.stopPropagation();
      b.hidden = false; if (typeof b.row !== 'number') b.row = 0;
      saveSoon(); renderShelf(); toast('"' + trunc(b.title, 28) + '" back on the shelf');
    };
    acts.appendChild(back);
  }
  d.appendChild(acts);
  /* drag & drop */
  d.draggable = true;
  d.addEventListener('dragstart', e => {
    state.dragId = b.id;
    d.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', b.id); } catch (err) {}
  });
  d.addEventListener('dragend', () => {
    d.classList.remove('dragging');
    setTimeout(() => { state.dragId = null; }, 50);
  });
  d.onclick = () => {
    if (state.dragId === b.id) return;   /* ignore click right after a drag */
    openBook(b);
  };
  return d;
}
function ghostEl(row){
  const g = document.createElement('div'); g.className = 'ghost'; g.textContent = '＋';
  g.title = 'Add PDF books to this shelf';
  g.onclick = () => addFlow(row);
  return g;
}

/* ---------- secret drawer ---------- */
function updateDrawerUI(){
  const v = (state.lib.settings && state.lib.settings.vault) || {};
  const lbl = $('#vaultLabel');
  if (state.vaultOpen) lbl.textContent = 'Open';
  else if (v.hash) lbl.textContent = 'Locked';
  else lbl.textContent = 'Secret drawer';
}
function renderVaultTray(){
  const tray = $('#vaultTray');
  const hidden = state.lib.books.filter(b => b.hidden);
  if (!state.vaultOpen) { tray.classList.remove('open'); tray.innerHTML = ''; return; }
  tray.classList.add('open');
  tray.innerHTML = '';
  const inner = document.createElement('div'); inner.className = 'vault-inner';
  if (!hidden.length) {
    inner.innerHTML = '<div class="vault-empty">Drawer is empty — hover any book on the shelf and press ⤵ (or drag it here) to hide it.</div>';
  } else {
    const tray2 = document.createElement('div'); tray2.className = 'tray';
    hidden.forEach(b => tray2.appendChild(bookEl(b, true)));
    inner.appendChild(tray2);
    const board = document.createElement('div'); board.className = 'board';
    board.style.background = 'linear-gradient(#7a5222,#5e3d17 55%,#462c10)';
    inner.appendChild(board);
  }
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;margin-top:10px;flex-wrap:wrap';
  const ch = document.createElement('button');
  ch.className = 'btn vault-lock'; ch.textContent = 'Change password';
  ch.onclick = () => changeVaultPassword();
  const lock = document.createElement('button');
  lock.className = 'btn vault-lock'; lock.textContent = 'Lock drawer';
  lock.onclick = () => { state.vaultOpen = false; renderShelf(); toast('Drawer locked'); };
  row.appendChild(ch); row.appendChild(lock);
  inner.appendChild(row);
  tray.appendChild(inner);
}
async function ensureVaultAccess(){
  const s = state.lib.settings;
  s.vault = s.vault || { hash: null };
  const v = s.vault;
  if (!v.hash) {
    const p1 = await askSecret({ title: 'Create drawer password', msg: 'Choose a password for your secret drawer.', okText: 'Continue' });
    if (p1 == null || !p1) return false;
    const p2 = await askSecret({ title: 'Confirm password', msg: 'Type the same password again.', okText: 'Create' });
    if (p2 == null) return false;
    if (p1 !== p2) { toast('Passwords did not match'); return false; }
    v.hash = sha256(p1); saveSoon();
    state.vaultOpen = true;
    toast('Secret drawer ready');
    return true;
  }
  if (!state.vaultOpen) {
    const p = await askSecret({ title: 'Unlock secret drawer', msg: 'Enter your drawer password.', okText: 'Unlock' });
    if (p == null) return false;
    if (sha256(p) !== v.hash) { toast('Wrong password'); return false; }
    state.vaultOpen = true;
  }
  return true;
}
async function changeVaultPassword(){
  const v = state.lib.settings.vault;
  if (!v.hash) { toast('No password set yet'); return; }
  const cur = await askSecret({ title: 'Change drawer password', msg: 'Enter your current password.', okText: 'Continue' });
  if (cur == null) return;
  if (sha256(cur) !== v.hash) { toast('Wrong password'); return; }
  const p1 = await askSecret({ title: 'New password', msg: 'Choose a new password.', okText: 'Continue' });
  if (p1 == null || !p1) return;
  const p2 = await askSecret({ title: 'Confirm new password', msg: 'Type the new password again.', okText: 'Save' });
  if (p2 == null) return;
  if (p1 !== p2) { toast('Passwords did not match'); return; }
  v.hash = sha256(p1); saveSoon();
  toast('Drawer password changed');
}
async function hideBook(b){
  if (!(await ensureVaultAccess())) return;
  b.hidden = true; saveSoon(); renderShelf();
  toast('"' + trunc(b.title, 28) + '" hidden in the drawer');
}
async function drawerClick(){
  state.lib.settings.vault = state.lib.settings.vault || { hash: null };
  if (state.vaultOpen) { state.vaultOpen = false; renderShelf(); toast('Drawer locked'); return; }
  if (!(await ensureVaultAccess())) return;
  renderShelf();
}

/* ---------- add books (respect the row you clicked) ---------- */
async function addFlow(row = 0){
  try {
    const before = new Set(state.lib.books.map(b => b.id));
    const lib = await api.addBooks();
    if (lib) {
      state.lib = lib;
      let n = 0;
      state.lib.books.forEach(b => {
        if (!before.has(b.id)) {
          n++;
          if (typeof b.row !== 'number') b.row = (typeof row === 'number') ? row : 0;
        }
      });
      renderShelf();
      toast(n > 0 ? 'Added ' + n + ' book(s) to shelf ' + ((typeof row === 'number' ? row : 0) + 1) : 'Nothing added');
      generateMissingThumbs();
    }
  } catch (e) { console.error(e); toast('Add failed: ' + e.message); }
}
async function generateMissingThumbs(){
  const pending = state.lib.books.filter(b => !b.thumb);
  for (let k = 0; k < pending.length; k++) {
    toast('Generating preview ' + (k + 1) + ' / ' + pending.length + ' — ' + pending[k].title, 120000);
    await genThumbFor(pending[k]);
    if (!$('#shelf').hidden) renderShelf();
  }
  if (pending.length) { toast('Shelf ready — ' + pending.length + ' preview(s) generated'); renderShelf(); }
}
async function genThumbFor(b){
  try {
    const data = await api.readBook(b.id);
    const pdf = await pdfjs.getDocument({ data }).promise;
    const page = await pdf.getPage(1);
    const v0 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: 170 / v0.width });
    const cv = document.createElement('canvas');
    cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
    await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
    const url = cv.toDataURL('image/jpeg', 0.8);
    const rel = await api.writeThumb(b.id, url);
    if (rel) { b.thumb = rel; b.thumbUrl = url; saveSoon(); }
  } catch (e) { console.warn('genThumb', e); }
}

/* ============================ READER ============================ */
async function openBook(meta){
  $('#shelf').hidden = true;
  $('#reader').hidden = false;
  showBars();
  $('#loading').hidden = false;
  $('#progWrap').hidden = true; $('#progTxt').hidden = true; $('#progBar').style.width = '0%';
  $('#loadMsg').textContent = 'Opening "' + meta.title + '"…';
  closePanel();
  try {
    const data = await api.readBook(meta.id);
    const pdf = await pdfjs.getDocument({ data }).promise;
    state.pdf = pdf; state.book = meta; state.numPages = pdf.numPages;
    state.toc = null; state.zoom = 1; $('#zoomPct').textContent = '100%';
    $('#zoomSlider').value = 100;
    state.cache.clear(); state.order = []; state.busy.clear(); state.pages = [];

    if (meta.pages !== pdf.numPages) { meta.pages = pdf.numPages; saveSoon(); }
    $('#bookTitle').textContent = meta.title;

    const p1 = await pdf.getPage(1);
    const v1 = p1.getViewport({ scale: 1 });
    state.ratio = v1.height / v1.width;

    state.cur = clamp((meta.lastPage || 1) - 1, 0, pdf.numPages - 1);
    buildFlip();
    $('#slider').max = pdf.numPages;
    $('#jumpBox').max = pdf.numPages;
    updateUI();

    const c = state.cur;
    const batch = [...new Set([c, c + 1, c + 2, c + 3, c + 4, c - 1].filter(i => i >= 0 && i < state.numPages))].sort((a, b) => a - b);
    $('#progWrap').hidden = false; $('#progTxt').hidden = false;
    for (let k = 0; k < batch.length; k++) {
      $('#progTxt').textContent = 'Rendering page ' + (batch[k] + 1) + ' / ' + state.numPages;
      await renderPage(batch[k]);
      $('#progBar').style.width = Math.round(100 * (k + 1) / batch.length) + '%';
    }
    renderAround();
    makeThumb();
  } catch (err) {
    console.error('openBook failed:', err);
    toast('Could not open this PDF: ' + (err && err.message ? err.message : err), 5000);
    backToShelf();
  } finally {
    $('#loading').hidden = true;
    $('#progWrap').hidden = true; $('#progTxt').hidden = true;
    hideBarsSoon(1600);
  }
}

function freshBookHolder(){
  const fresh = document.createElement('div');
  fresh.id = 'book';
  const old = document.getElementById('book');
  const wrap = $('#bookWrap');
  const gutter = document.getElementById('gutter');
  if (old) old.replaceWith(fresh);
  else if (gutter) wrap.insertBefore(fresh, gutter);
  else wrap.appendChild(fresh);
  return fresh;
}

function computeSize(){
  const st = $('#stage');
  const hidden = $('#reader').classList.contains('bars-hidden');
  const mW = hidden ? 40 : 60, mH = hidden ? 36 : 46;
  const availW = Math.max(300, st.clientWidth - mW);
  const availH = Math.max(300, st.clientHeight - mH);
  let ph = availH, pw = ph / (state.ratio || 1.5);
  const maxW = (availW - 8) / 2;
  if (pw > maxW) { pw = maxW; ph = pw * (state.ratio || 1.5); }
  pw *= state.zoom; ph *= state.zoom;
  pw = Math.round(pw); ph = Math.round(ph);
  if (!pw || !ph || pw < 80 || ph < 80) { pw = 400; ph = Math.round(400 * (state.ratio || 1.5)); }
  return { pw, ph };
}
function attachImg(i, d){
  const url = state.cache.get(i);
  if (url && d && !d.firstChild) {
    const im = new Image(); im.src = url; im.className = 'pg-img'; im.draggable = false;
    d.appendChild(im);
  }
}
function makePageDivs(holder){
  state.pages = [];
  for (let i = 0; i < state.numPages; i++) {
    const d = document.createElement('div');
    d.className = 'page';
    d.dataset.side = (i % 2 === 0) ? 'r' : 'l';
    attachImg(i, d);
    state.pages.push(d); holder.appendChild(d);
  }
}
function buildFlip(){
  if (state.flip) { try { state.flip.destroy(); } catch (e) {} state.flip = null; }
  const st = $('#stage');
  st.classList.toggle('stage-zoom', state.zoom > 1);
  st.classList.toggle('can-pan', state.zoom > 1);
  if (state.zoom <= 1) { st.scrollLeft = 0; st.scrollTop = 0; }
  const holder = freshBookHolder();
  makePageDivs(holder);
  const { pw, ph } = computeSize();
  state.fw = pw; state.fh = ph;
  holder.style.width  = (pw * 2) + 'px';
  holder.style.height = ph + 'px';
  state.flip = new St.PageFlip(holder, {
    width: pw, height: ph,
    size: 'fixed',
    showCover: true,
    usePortrait: false,
    maxShadowOpacity: 0.5,
    mobileScrollSupport: false,
    flippingTime: 700,
    startPage: clamp(state.cur, 0, state.numPages - 1),
    showPageCorners: false,
    swipeDistance: 20
  });
  state.flip.loadFromHTML(holder.querySelectorAll('.page'));
  state.flip.on('flip', onFlip);
  state.flip.on('changeState', e => {
    state.flipping = (e.data !== 'read');
    const g = document.getElementById('gutter');
    if (g) g.style.opacity = (e.data === 'read') ? '1' : '0';
  });
  const g = document.getElementById('gutter');
  g.style.display = (state.cur === 0) ? 'none' : '';
  g.style.opacity = '1';
}
function rebuild(){
  buildFlip(); updateUI(); renderAround();
  if (state.zoom > 1) centerView();
}
function centerView(){
  const st = $('#stage');
  requestAnimationFrame(() => {
    st.scrollLeft = (st.scrollWidth - st.clientWidth) / 2;
    st.scrollTop  = (st.scrollHeight - st.clientHeight) / 2;
  });
}

function onFlip(e){
  state.cur = e.data;
  flipSound();
  updateUI();
  if (state.book) { state.book.lastPage = primary(); saveSoon(); }
  requestAnimationFrame(() => renderAround());
}

function spreadStartIndex(cur){
  if (cur <= 0) return 0;
  return (cur % 2 === 1) ? cur : cur - 1;
}
function primary(){
  const s = spreadStartIndex(state.cur);
  return s === 0 ? 1 : s + 1;
}
function spreadLabel(){
  const n = state.numPages, s = spreadStartIndex(state.cur);
  if (s === 0) return '1 / ' + n;
  const left = s + 1, right = s + 2;
  return (right <= n ? left + '-' + right : String(left)) + ' / ' + n;
}
function isBookmarked(p){ return !!(state.book && state.book.bookmarks && state.book.bookmarks.some(m => m.page === p)); }
function updateUI(){
  const p = primary();
  const sl = $('#slider'); sl.max = state.numPages || 1; sl.value = p;
  const jb = $('#jumpBox'); jb.max = state.numPages || 1; jb.value = p;
  $('#pageLabel').textContent = spreadLabel();
  $('#btnBm').textContent = isBookmarked(p) ? '★' : '☆';
  $('#btnBm').classList.toggle('on', isBookmarked(p));
  const g = document.getElementById('gutter');
  if (g) g.style.display = (state.cur === 0) ? 'none' : '';
}

async function renderPage(i){
  if (i < 0 || i >= state.numPages) return;
  if (state.cache.has(i)) { attachImg(i, state.pages[i]); return; }
  if (state.busy.has(i)) return state.busy.get(i);
  const job = (async () => {
    try {
      const page = await state.pdf.getPage(i + 1);
      const v0 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: (BASE_W * QUALITY) / v0.width });
      const cv = document.createElement('canvas');
      cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
      await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
      const url = await canvasToUrl(cv);
      state.cache.set(i, url); state.order.push(i);
      attachImg(i, state.pages[i]);
      evict();
    } catch (err) { console.warn('render fail p' + (i + 1), err); }
    finally { state.busy.delete(i); }
  })();
  state.busy.set(i, job);
  return job;
}
function evict(){
  while (state.order.length > CACHE_MAX) {
    const k = state.order.findIndex(i => Math.abs(i - state.cur) > 3);
    if (k < 0) break;
    const i = state.order.splice(k, 1)[0];
    const url = state.cache.get(i);
    state.cache.delete(i);
    const d = state.pages[i];
    if (d) d.innerHTML = '';
    if (url && url.startsWith('blob:')) URL.revokeObjectURL(url);
  }
}
async function renderAround(){
  const c = state.cur;
  const near = [c - 1, c, c + 1, c + 2].filter(i => i >= 0 && i < state.numPages);
  for (const i of near) await renderPage(i);
  [c + 3, c + 4, c - 2, c - 3].forEach(i => { if (i >= 0 && i < state.numPages) renderPage(i); });
}

async function makeThumb(){
  const b = state.book; if (!b || b.thumb) return;
  await genThumbFor(b);
  renderShelf();
}

function goPage(p){
  if (!state.flip) return;
  p = clamp(Math.round(p), 1, state.numPages);
  const idx = p - 1;
  if (Math.abs(idx - state.cur) <= 4) state.flip.flip(idx);
  else {
    state.flip.turnToPage(idx);
    state.cur = idx; updateUI(); renderAround();
    if (state.zoom > 1) centerView();
    if (state.book) { state.book.lastPage = primary(); saveSoon(); }
  }
}

function openPanel(kind){
  showBars();
  state.panel = kind; $('#panel').classList.add('open');
  if (kind === 'toc') { $('#panelTitle').textContent = 'Table of contents'; buildTOC(); }
  else { $('#panelTitle').textContent = 'Bookmarks'; buildBM(); }
}
function closePanel(){
  state.panel = null; $('#panel').classList.remove('open');
  if (!$('#reader').hidden) hideBarsSoon(900);
}

async function buildTOC(){
  const body = $('#panelBody');
  if (!state.toc) {
    body.innerHTML = '<div class="dim">Loading contents…</div>';
    const flat = [];
    try {
      const outline = await state.pdf.getOutline();
      const walk = async (items, depth) => {
        for (const it of items || []) {
          let pg = null;
          try {
            let d = it.dest;
            if (typeof d === 'string') d = await state.pdf.getDestination(d);
            if (Array.isArray(d)) pg = (await state.pdf.getPageIndex(d[0])) + 1;
          } catch (e) {}
          flat.push({ t: it.title || '(untitled)', d: depth, pg: pg });
          if (it.items && it.items.length) await walk(it.items, depth + 1);
        }
      };
      await walk(outline, 0);
    } catch (e) { console.warn('toc', e); }
    state.toc = flat;
  }
  body.innerHTML = '';
  if (!state.toc.length) { body.innerHTML = '<div class="dim">This book has no table of contents.</div>'; return; }
  for (const it of state.toc) {
    const r = document.createElement('div'); r.className = 'prow';
    r.style.paddingLeft = (10 + it.d * 14) + 'px';
    r.innerHTML = '<span class="pt">' + esc(it.t) + '</span><span class="pp">' + (it.pg ? 'p. ' + it.pg : '') + '</span>';
    if (it.pg) r.onclick = () => { goPage(it.pg); closePanel(); };
    body.appendChild(r);
  }
}
function buildBM(){
  const body = $('#panelBody'); body.innerHTML = '';
  const add = document.createElement('button');
  add.className = 'btn accent w100'; add.textContent = '＋ Bookmark current page';
  add.onclick = () => toggleBookmark();
  body.appendChild(add);
  const list = [...((state.book && state.book.bookmarks) || [])].sort((a, b) => a.page - b.page);
  if (!list.length) {
    body.insertAdjacentHTML('beforeend', '<div class="dim">No bookmarks yet. Press the star or B. Use the pen to attach a note.</div>');
    return;
  }
  for (const m of list) {
    const item = document.createElement('div');
    const r = document.createElement('div'); r.className = 'prow';
    r.innerHTML = '<span class="pt">Page ' + m.page + (m.note ? ' — ' + esc(trunc(m.note, 40)) : '') + '</span>' +
                  '<span class="pp">' + new Date(m.at || Date.now()).toLocaleDateString() + '</span>';
    const tools = document.createElement('span'); tools.className = 'bm-tools';
    const pen = document.createElement('button'); pen.className = 'mini-x'; pen.textContent = '✎'; pen.title = 'Edit note';
    pen.onclick = ev => { ev.stopPropagation(); showNoteEditor(m, item); };
    const x = document.createElement('button'); x.className = 'mini-x'; x.textContent = '✕'; x.title = 'Delete bookmark';
    x.onclick = ev => {
      ev.stopPropagation();
      state.book.bookmarks = state.book.bookmarks.filter(z => z.page !== m.page);
      saveSoon(); updateUI(); buildBM();
    };
    tools.appendChild(pen); tools.appendChild(x);
    r.appendChild(tools);
    r.onclick = () => { goPage(m.page); closePanel(); };
    item.appendChild(r);
    if (m.note) {
      const n = document.createElement('div'); n.className = 'bm-note'; n.textContent = m.note;
      n.title = 'Click to edit note';
      n.onclick = () => showNoteEditor(m, item);
      item.appendChild(n);
    }
    body.appendChild(item);
  }
}
function showNoteEditor(m, item){
  if (item.querySelector('textarea')) return;
  const noteEl = item.querySelector('.bm-note');
  if (noteEl) noteEl.remove();
  const box = document.createElement('div'); box.className = 'bm-editor';
  const ta = document.createElement('textarea'); ta.className = 'bm-edit';
  ta.value = m.note || ''; ta.placeholder = 'Add a note for this bookmark…';
  const row = document.createElement('div'); row.className = 'bm-btnrow';
  const save = document.createElement('button'); save.className = 'btn accent'; save.textContent = 'Save note';
  save.onclick = () => { m.note = ta.value.trim(); saveSoon(); buildBM(); };
  const cancel = document.createElement('button'); cancel.className = 'btn'; cancel.style.color = '#3a2a16'; cancel.textContent = 'Cancel';
  cancel.onclick = () => buildBM();
  row.appendChild(save); row.appendChild(cancel);
  box.appendChild(ta); box.appendChild(row);
  ta.onkeydown = e => {
    e.stopPropagation();
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save.click();
    if (e.key === 'Escape') { e.preventDefault(); buildBM(); }
  };
  item.appendChild(box);
  ta.focus();
}
function toggleBookmark(){
  const b = state.book; if (!b) return;
  b.bookmarks = b.bookmarks || [];
  const p = primary();
  const i = b.bookmarks.findIndex(m => m.page === p);
  if (i >= 0) { b.bookmarks.splice(i, 1); toast('Bookmark removed'); }
  else { b.bookmarks.push({ page: p, at: Date.now(), note: '' }); toast('Bookmark added — page ' + p); }
  saveSoon(); updateUI();
  if (state.panel === 'bm') buildBM();
}

function setZoom(z){
  let nz = Math.round(z * 100) / 100;
  if (Math.abs(nz - 1) < 0.03) nz = 1;
  nz = clamp(nz, 0.5, 3.0);
  $('#zoomPct').textContent = Math.round(nz * 100) + '%';
  const zs = document.getElementById('zoomSlider');
  if (zs) zs.value = Math.round(nz * 100);
  if (nz === state.zoom) return;
  state.zoom = nz;
  if (state.pdf && !$('#reader').hidden) rebuild();
}
function applyTheme(){
  document.body.classList.remove('theme-paper','theme-sepia','theme-night');
  document.body.classList.add('theme-' + (state.lib.settings.theme || 'paper'));
  $('#themeSel').value = state.lib.settings.theme || 'paper';
}
function toggleFs(){
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
}
function backToShelf(){
  clearTimeout(state.refitT);
  $('#reader').hidden = true;
  $('#shelf').hidden = false;
  showBars();
  closePanel();
  try { if (state.book) { state.book.lastPage = primary(); saveLib(); } } catch (e) { console.warn(e); }
  try { if (state.flip) state.flip.destroy(); } catch (e) { console.warn(e); }
  for (const url of state.cache.values()) if (url.startsWith('blob:')) URL.revokeObjectURL(url);
  state.flip = null; state.pdf = null; state.book = null; state.toc = null;
  state.cache.clear(); state.order = []; state.busy.clear();
  freshBookHolder();
  renderShelf();
}

function keys(e){
  if (!$('#modal').hidden) return;
  if (e.target.matches('input,select,textarea')) return;
  if (!$('#reader').hidden && state.flip) {
    switch (e.key) {
      case 'ArrowRight': e.preventDefault(); state.flip.flipNext(); return;
      case 'ArrowLeft':  e.preventDefault(); state.flip.flipPrev(); return;
      case 'f': case 'F': toggleFs(); return;
      case 'b': case 'B': toggleBookmark(); return;
      case 'h': case 'H': barsShown() ? hideBars() : showBars(); return;
      case '+': case '=': setZoom(state.zoom * 1.2); return;
      case '-': case '_': setZoom(state.zoom / 1.2); return;
      case 'g': case 'G': showBars(); $('#jumpBox').focus(); $('#jumpBox').select(); return;
      case 'Escape':
        if ($('#lightPop').classList.contains('open')) { $('#lightPop').classList.remove('open'); return; }
        if (state.panel) closePanel(); else backToShelf();
        return;
    }
  }
}

function wire(){
  $('#btnAdd').onclick = () => addFlow(0);   /* header button → shelf 1 */
  $('#btnBack').onclick = backToShelf;
  $('#drawerVault').onclick = drawerClick;
  $('#btnToc').onclick = () => openPanel('toc');
  $('#btnBmList').onclick = () => openPanel('bm');
  $('#btnBm').onclick = toggleBookmark;
  $('#btnGo').onclick = () => goPage(+$('#jumpBox').value);
  $('#jumpBox').addEventListener('keydown', e => {
    if (e.key === 'Enter') { goPage(+$('#jumpBox').value); $('#jumpBox').blur(); }
  });
  $('#btnZoomIn').onclick = () => setZoom(state.zoom * 1.2);
  $('#btnZoomOut').onclick = () => setZoom(state.zoom / 1.2);
  $('#zoomPct').onclick = () => setZoom(1);
  const sliderZoom = debounce(v => setZoom(v / 100), 180);
  $('#zoomSlider').addEventListener('input', () => {
    $('#zoomPct').textContent = $('#zoomSlider').value + '%';
    sliderZoom(+$('#zoomSlider').value);
  });
  $('#themeSel').onchange = e => { state.lib.settings.theme = e.target.value; applyTheme(); saveSoon(); };
  $('#btnLight').onclick = e => {
    e.stopPropagation();
    $('#lightPop').classList.toggle('open');
  };
  $('#btnSound').onclick = () => {
    state.lib.settings.sound = !state.lib.settings.sound;
    $('#btnSound').classList.toggle('on', state.lib.settings.sound);
    saveSoon();
  };
  $('#btnFs').onclick = toggleFs;
  $('#panelClose').onclick = closePanel;

  const sl = $('#slider');
  sl.addEventListener('input', () => { $('#pageLabel').textContent = '→ ' + sl.value + ' / ' + state.numPages; });
  sl.addEventListener('change', () => goPage(+sl.value));

  $('#stage').addEventListener('wheel', e => {
    if (e.ctrlKey) { e.preventDefault(); setZoom(state.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12)); }
  }, { passive: false });

  $('#stage').addEventListener('dblclick', e => {
    if (e.target.id === 'stage' || e.target.id === 'bookWrap') toggleFs();
  });

  wireStageUI();
  window.addEventListener('keydown', keys);
  window.addEventListener('resize', debounce(() => {
    if (!$('#reader').hidden && state.pdf) rebuild();
    else if (!$('#shelf').hidden) renderShelf();
  }, 220));
  document.addEventListener('fullscreenchange', () => {
    $('#btnFs').textContent = document.fullscreenElement ? '⤡' : '⛶';
    if (!$('#reader').hidden && state.pdf) rebuild();
  });
  window.addEventListener('beforeunload', () => {
    if (state.book) { state.book.lastPage = primary(); try { api.saveLibrarySync(cleanLib()); } catch (e) {} }
  });
}

(async function init(){
  state.lib = await api.loadLibrary();
  state.lib.settings = state.lib.settings || { theme: 'paper', sound: true, light: { on: true, color: LIGHTS[0].c } };
  state.lib.settings.light = state.lib.settings.light || { on: true, color: LIGHTS[0].c };
  state.lib.settings.vault = state.lib.settings.vault || { hash: null };
  state.lib.books = state.lib.books || [];
  applyTheme();
  applyLight();
  buildLightPop();
  $('#btnSound').classList.toggle('on', !!state.lib.settings.sound);
  wire();
  renderShelf();
  generateMissingThumbs();
  console.log('[NightClaw] renderer v13 ready');
})().catch(e => fatal('Init failed: ' + e.message));
