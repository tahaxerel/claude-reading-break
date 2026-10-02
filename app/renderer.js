import * as pdfjsLib from './vendor/pdf.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.mjs', import.meta.url).href;

const $ = (id) => document.getElementById(id);
const drop = $('drop'), reader = $('reader'), canvas = $('canvas'), ctx = canvas.getContext('2d');
const pageinfo = $('pageinfo'), titleEl = $('title'), hud = $('hud'), flash = $('flash');
const docinfo = $('docinfo'), hookBtn = $('hook');
const library = $('library'), libGrid = $('lib-grid');

let pdf = null, pageNum = 1, bookId = null, rendering = false, pending = false;

const store = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
};
if (store.get('night', false)) document.body.classList.add('night');
updateThemeBtn();
document.body.classList.add('empty');

// ---------- opening a book ----------
let openSeq = 0;
async function openBook(book) {
  if (!book) return;
  const seq = ++openSeq;
  let doc;
  try {
    doc = await pdfjsLib.getDocument({ data: book.data }).promise;
  } catch (e) {
    say('Could not open PDF: ' + (e.message || e));
    return;
  }
  // A newer open request arrived while this one was loading: drop this one.
  if (seq !== openSeq) { doc.destroy(); return; }
  if (pdf) pdf.destroy();
  pdf = doc;
  bookId = book.id;
  pageNum = Math.min(Math.max(book.page || 1, 1), pdf.numPages);
  titleEl.textContent = book.name.replace(/\.pdf$/i, '');
  document.title = book.name;
  drop.classList.add('hidden');
  reader.classList.remove('hidden');
  docinfo.classList.remove('hidden');
  document.body.classList.remove('empty');
  hideLibrary();
  showHud();
  render();
}

async function addAndOpen(p) { openBook(await window.api.openDialog()); }
$('pick').onclick = addAndOpen;
$('lib-add').onclick = addAndOpen;
window.api.onMenuOpen(addAndOpen);
let explicitOpen = false;
window.api.onOpenPath(async (p) => { explicitOpen = true; openBook(await window.api.addPath(p)); });

// drag and drop
for (const ev of ['dragenter', 'dragover']) {
  document.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); });
}
document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) drop.classList.remove('over'); });
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  const files = [...e.dataTransfer.files].filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
  if (!files.length) { say('Only PDF files are supported'); return; }
  let last = null;
  for (const f of files) {
    const p = window.api.pathForFile(f);
    last = p ? await window.api.addPath(p) : await window.api.addBuffer(f.name, await f.arrayBuffer());
  }
  if (files.length > 1) say(`${files.length} books added`);
  openBook(last);
});

// ---------- library ----------
async function showLibrary() {
  const list = await window.api.libList();
  libGrid.innerHTML = '';
  if (!list.length) {
    const p = document.createElement('div'); p.className = 'lib-empty';
    p.textContent = 'No books yet. Drop a PDF or press ⌘O to add one.';
    libGrid.appendChild(p);
  }
  for (const b of list) {
    const card = document.createElement('div');
    card.className = 'book' + (b.id === bookId ? ' current' : '');
    const pct = b.pages ? Math.round((b.page / b.pages) * 100) : 0;
    card.innerHTML = `
      <button class="book-rm" title="Remove from library">×</button>
      <div class="book-name"></div>
      <div class="book-meta">
        <span>${b.pages ? `${b.page} / ${b.pages}` : 'not started'}</span>
        <div class="book-bar"><i style="width:${pct}%"></i></div>
      </div>`;
    card.querySelector('.book-name').textContent = b.name.replace(/\.pdf$/i, '');
    card.onclick = async () => openBook(await window.api.libOpen(b.id));
    card.querySelector('.book-rm').onclick = async (e) => {
      e.stopPropagation();
      await window.api.libRemove(b.id);
      if (b.id === bookId) { bookId = null; }
      showLibrary();
    };
    libGrid.appendChild(card);
  }
  const add = document.createElement('div');
  add.className = 'book add'; add.textContent = '+ Add PDF';
  add.onclick = addAndOpen;
  libGrid.appendChild(add);
  library.classList.remove('hidden');
  document.body.classList.add('lib');
}
function hideLibrary() { library.classList.add('hidden'); document.body.classList.remove('lib'); }
function toggleLibrary() { library.classList.contains('hidden') ? showLibrary() : hideLibrary(); }
$('lib-toggle').onclick = toggleLibrary;
$('lib-close').onclick = hideLibrary;
window.api.onMenuLibrary(toggleLibrary);

// ---------- rendering ----------
async function render() {
  if (!pdf) return;
  if (rendering) { pending = true; return; }
  rendering = true;
  const doc = pdf, id = bookId, num = pageNum;
  try {
    const page = await doc.getPage(num);
    const wrap = document.querySelector('.page-wrap');
    const availW = wrap.clientWidth - 120, availH = wrap.clientHeight - 92;
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(availW / base.width, availH / base.height);
    const dpr = window.devicePixelRatio || 1;
    const vp = page.getViewport({ scale: scale * dpr });
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    canvas.style.width = Math.floor(vp.width / dpr) + 'px';
    canvas.style.height = Math.floor(vp.height / dpr) + 'px';
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    if (doc === pdf) {
      pageinfo.textContent = `${num} / ${doc.numPages}`;
      window.api.libProgress(id, num, doc.numPages);
    }
  } catch (e) {
    // The book was switched mid-render; the queued render below draws the new one.
  } finally {
    rendering = false;
    if (pending) { pending = false; render(); }
  }
}

function go(delta) {
  if (!pdf || !library.classList.contains('hidden')) return;
  const n = Math.min(Math.max(pageNum + delta, 1), pdf.numPages);
  if (n === pageNum) return;
  pageNum = n;
  render();
  showHud();
}
$('prev').onclick = () => go(-1);
$('next').onclick = () => go(1);
$('theme').onclick = toggleTheme;

document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey) return;
  switch (e.key) {
    case 'ArrowRight': case 'ArrowDown': case ' ': case 'PageDown': case 'j': go(1); e.preventDefault(); break;
    case 'ArrowLeft': case 'ArrowUp': case 'PageUp': case 'k': case 'Backspace': go(-1); e.preventDefault(); break;
    case 'Home': if (pdf) { pageNum = 1; render(); } break;
    case 'End': if (pdf) { pageNum = pdf.numPages; render(); } break;
    case 't': case 'T': toggleTheme(); break;
    case 'l': case 'L': toggleLibrary(); break;
    case 'Escape': hideLibrary(); break;
  }
});

let wheelAcc = 0, wheelTimer = null;
document.addEventListener('wheel', (e) => {
  if (!pdf || !library.classList.contains('hidden')) return;
  wheelAcc += e.deltaY;
  clearTimeout(wheelTimer);
  if (Math.abs(wheelAcc) > 120) { go(wheelAcc > 0 ? 1 : -1); wheelAcc = 0; }
  wheelTimer = setTimeout(() => (wheelAcc = 0), 200);
}, { passive: true });

let rt = null;
window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(render, 120); });

function toggleTheme() {
  document.body.classList.toggle('night');
  store.set('night', document.body.classList.contains('night'));
  updateThemeBtn();
}
function updateThemeBtn() { $('theme').textContent = document.body.classList.contains('night') ? 'paper' : 'night'; }

// ---------- Claude hook toggle ----------
function paintHook(on) {
  hookBtn.classList.toggle('on', on);
  hookBtn.title = on ? 'Claude link is on: click to turn off' : 'Claude link is off: click to turn on';
}
window.api.hookGet().then(paintHook);
hookBtn.onclick = async () => {
  const on = await window.api.hookSet(!hookBtn.classList.contains('on'));
  paintHook(on);
  say(on ? 'Claude link on' : 'Claude link off');
};

let hudTimer = null;
function showHud() {
  hud.classList.add('show');
  clearTimeout(hudTimer);
  hudTimer = setTimeout(() => hud.classList.remove('show'), 1800);
}
let flashTimer = null;
function say(msg) {
  flash.textContent = msg; flash.classList.add('show');
  clearTimeout(flashTimer); flashTimer = setTimeout(() => flash.classList.remove('show'), 2200);
}

// ---------- startup: reopen the last book ----------
(async () => {
  const list = await window.api.libList();
  if (!list.length || explicitOpen) return;
  const book = await window.api.libOpen(list[0].id);
  if (!explicitOpen) openBook(book);
})();
