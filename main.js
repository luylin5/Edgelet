const {
  app, BrowserWindow, ipcMain, screen, shell,
  Menu, Tray, globalShortcut, dialog, clipboard, Notification,
} = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

const APP_ICON = path.join(__dirname, 'assets', 'icon.ico');
const I18N = require('./renderer/i18n.js');

// ---- 尺寸与交互参数（单位：DIP） ----
const PAD = 12;         // 面板内边距
const HEADER = 34;      // 标题栏高度（含顶部留白）
const MARGIN = 16;      // 非贴边一侧留给阴影的空间
const HOT = 5;          // 收起时，屏幕边缘的感应厚度
const KEEP = 10;        // 展开后，鼠标离开面板多少像素内仍保持展开
const POLL_MS = 60;
const SHOW_DELAY = 120; // 鼠标在边缘停留多久才弹出，避免误触
const HIDE_DELAY = 380;
const MEMO_W = 248;     // 面板最小尺寸（备忘页放得下），启动页和备忘页共用同一尺寸，切换时不改窗口大小
const MEMO_H = 420;
const MEMO_MAX = 500;   // 单条备忘最多字数
const REMIND_POLL_MS = 20000;
const DAY_REMIND = '09:00';        // 只有日期没有时间的备忘，当天这个时间统一提醒
const MISSED_MS = 6 * 3600 * 1000; // 错过超过这么久（比如关机了）就不再补发提醒

// ---- 配置 ----
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
const DEFAULTS = {
  items: [],            // [{ id, path }]
  edge: 'right',        // left | right | top | bottom
  along: 0.3,           // 沿边缘的位置，0~1
  displayId: null,
  hotkey: 'Alt+`',
  autoHide: true,
  layout: 'standard',   // 见 LAYOUTS
  iconSize: 'medium',   // small | medium | large
  showLabels: true,
  view: 'apps',         // apps | memo，顶部滑块切换
  memos: [],            // [{ id, text, done, createdAt, doneAt, due: { date, time } | null, reminded }]
  remind: true,         // 备忘到点提醒
  lang: 'auto',         // auto | zh | en，auto 时跟随系统语言
};

// 预制布局：列 × 行（贴左右边时；贴上下边时自动转置）
const LAYOUTS = [
  { id: 'strip', cols: 1, rows: 6 },
  { id: 'compact', cols: 2, rows: 4 },
  { id: 'standard', cols: 3, rows: 4 },
  { id: 'square', cols: 4, rows: 4 },
  { id: 'large', cols: 4, rows: 6 },
];
const ICON_SIZES = [
  { id: 'small', icon: 30, cell: 64, bare: 48 },
  { id: 'medium', icon: 38, cell: 78, bare: 58 },
  { id: 'large', icon: 48, cell: 92, bare: 70 },
];

let cfg = loadConfig();
let saveTimer = null;

// 界面语言：设置为 auto 时按系统语言（app.getLocale 需在 ready 之后才准确）
const uiLang = () => I18N.resolve(cfg.lang, app.isReady() ? app.getLocale() : '');
const t = (key, ...args) => I18N.make(uiLang())(key, ...args);

function loadConfig() {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8').replace(/^﻿/, '')) };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveConfig() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  }, 300);
}

// ---- 几何 ----
const isVertical = (edge) => edge === 'left' || edge === 'right';

function layoutFor(edge) {
  const v = isVertical(edge);
  const preset = LAYOUTS.find((l) => l.id === cfg.layout) || LAYOUTS[2];
  const size = ICON_SIZES.find((z) => z.id === cfg.iconSize) || ICON_SIZES[1];
  const cell = cfg.showLabels ? size.cell : size.bare;
  // 贴上下边时行列互换，让面板沿着边缘展开
  const cols = v ? preset.cols : preset.rows;
  const rows = v ? preset.rows : preset.cols;
  let pw = Math.max(cols * cell + PAD * 2, 104); // 至少放得下标题栏
  let ph = rows * cell + HEADER + PAD;
  pw = Math.max(pw, MEMO_W);
  ph = Math.max(ph, MEMO_H);
  const ww = v ? pw + MARGIN : pw + MARGIN * 2;
  const wh = v ? ph + MARGIN * 2 : ph + MARGIN;
  const ox = edge === 'left' ? 0 : MARGIN;
  const oy = edge === 'top' ? 0 : MARGIN;
  return {
    cols, rows, pw, ph, ww, wh, ox, oy, cell, pad: PAD, header: HEADER,
    icon: size.icon, showLabels: cfg.showLabels,
  };
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const inside = (p, r) => p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height;
const inflate = (r, n) => ({ x: r.x - n, y: r.y - n, width: r.width + 2 * n, height: r.height + 2 * n });

function panelRect() {
  const b = win.getBounds();
  const L = layoutFor(cfg.edge);
  return { x: b.x + L.ox, y: b.y + L.oy, width: L.pw, height: L.ph };
}

function hotRect(pr) {
  switch (cfg.edge) {
    case 'left': return { ...pr, width: HOT };
    case 'right': return { ...pr, x: pr.x + pr.width - HOT, width: HOT };
    case 'top': return { ...pr, height: HOT };
    default: return { ...pr, y: pr.y + pr.height - HOT, height: HOT };
  }
}

function currentDisplay() {
  return screen.getAllDisplays().find((d) => d.id === cfg.displayId) || screen.getPrimaryDisplay();
}

// ---- 窗口 ----
let win = null;
let tray = null;
let expanded = false;
let dragging = false;
let busy = false;        // 菜单/对话框打开期间不自动收起
let uiHold = false;      // 面板内正在重命名或选图标
let hotkeyHold = false;  // 由快捷键呼出：失焦或按 Esc 才收起
let hoverSince = 0;
let leaveSince = 0;
let programmaticMove = false;
let moveTimer = null;

function applyPlacement() {
  if (!win) return;
  const wa = currentDisplay().workArea;
  const L = layoutFor(cfg.edge);
  const along = clamp(cfg.along, 0, 1);
  let x, y;
  if (isVertical(cfg.edge)) {
    x = cfg.edge === 'left' ? wa.x : wa.x + wa.width - L.ww;
    y = wa.y + Math.round(along * Math.max(0, wa.height - L.wh));
  } else {
    x = wa.x + Math.round(along * Math.max(0, wa.width - L.ww));
    y = cfg.edge === 'top' ? wa.y : wa.y + wa.height - L.wh;
  }
  programmaticMove = true;
  win.setBounds({ x, y, width: L.ww, height: L.wh });
  setTimeout(() => { programmaticMove = false; }, 50);
  pushState();
}

// 拖动结束：吸附到最近的边
function finishDrag() {
  clearTimeout(moveTimer);
  if (!dragging) return;
  dragging = false;
  const b = win.getBounds();
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const d = screen.getDisplayNearestPoint({ x: Math.round(cx), y: Math.round(cy) });
  const wa = d.workArea;
  const dist = {
    left: b.x - wa.x,
    right: wa.x + wa.width - (b.x + b.width),
    top: b.y - wa.y,
    bottom: wa.y + wa.height - (b.y + b.height),
  };
  const edge = Object.keys(dist).reduce((a, k) => (dist[k] < dist[a] ? k : a));
  const L = layoutFor(edge);
  cfg.edge = edge;
  cfg.displayId = d.id;
  cfg.along = isVertical(edge)
    ? clamp((cy - L.wh / 2 - wa.y) / Math.max(1, wa.height - L.wh), 0, 1)
    : clamp((cx - L.ww / 2 - wa.x) / Math.max(1, wa.width - L.ww), 0, 1);
  saveConfig();
  applyPlacement();
  leaveSince = 0;
}

function setExpanded(v, { focus = false } = {}) {
  if (!win) return;
  if (expanded !== v) {
    expanded = v;
    win.setIgnoreMouseEvents(!v);
    win.webContents.send('expanded', { expanded: v, focus });
  } else if (v && focus) {
    win.webContents.send('expanded', { expanded: true, focus: true });
  }
  if (v && focus) win.focus();
  if (!v) hotkeyHold = false;
  hoverSince = 0;
  leaveSince = 0;
}

function tick() {
  if (!win || dragging || busy || uiHold) return;
  if (!cfg.autoHide) {
    if (!expanded) setExpanded(true);
    return;
  }
  const p = screen.getCursorScreenPoint();
  const pr = panelRect();
  const now = Date.now();

  if (!expanded) {
    if (inside(p, hotRect(pr))) {
      if (!hoverSince) hoverSince = now;
      if (now - hoverSince >= SHOW_DELAY) setExpanded(true);
    } else {
      hoverSince = 0;
    }
    return;
  }

  if (inside(p, inflate(pr, KEEP))) {
    leaveSince = 0;
    hotkeyHold = false; // 鼠标进来过之后，按普通悬停逻辑收起
    return;
  }
  if (hotkeyHold) return;
  if (!leaveSince) leaveSince = now;
  if (now - leaveSince >= HIDE_DELAY) setExpanded(false);
}

function toggleByHotkey() {
  if (!win) return;
  if (expanded && (hotkeyHold || win.isFocused()) && cfg.autoHide) {
    setExpanded(false);
  } else {
    hotkeyHold = cfg.autoHide;
    setExpanded(true, { focus: true });
  }
}

function createWindow() {
  const L = layoutFor(cfg.edge);
  win = new BrowserWindow({
    width: L.ww,
    height: L.wh,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });
  win.setAlwaysOnTop(true, 'pop-up-menu');
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  win.on('will-move', () => {
    if (programmaticMove) return;
    dragging = true;
  });
  win.on('move', () => {
    if (programmaticMove || !dragging) return;
    // 兜底：万一没收到 moved 事件
    clearTimeout(moveTimer);
    moveTimer = setTimeout(finishDrag, 500);
  });
  win.on('moved', finishDrag);
  win.on('blur', () => {
    if (hotkeyHold && !busy && !uiHold) setExpanded(false);
  });
  // 退出时窗口先销毁，定时器还可能再跑一次；置空后各处的 if (!win) 就能拦住
  win.on('closed', () => { win = null; });

  win.once('ready-to-show', () => {
    applyPlacement();
    expanded = !cfg.autoHide;
    win.setIgnoreMouseEvents(!expanded);
    win.webContents.send('expanded', { expanded, focus: false });
    win.showInactive();
  });
}

// ---- 图标与条目 ----
const iconCache = new Map();

// 图标取的是文件在资源管理器里的系统图标（不是内容预览），由 helpers/file-icons.ps1 提取 256px 版本，
// 结果按「路径 + 修改时间 + 大小」缓存到磁盘，只有新加入或变动的文件才会重新提取。
const ICON_DIR = path.join(app.getPath('userData'), 'icon-cache');
// 打包后 helpers 被解包到 app.asar.unpacked，PowerShell 读不了 asar 里的文件
const ICON_HELPER = path.join(__dirname, 'helpers', 'file-icons.ps1').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
let iconQueue = Promise.resolve();

function iconKey(p) {
  let st;
  try { st = fs.statSync(p); } catch { return null; }
  const hash = crypto.createHash('sha1').update(`v2|${p.toLowerCase()}|${st.mtimeMs}|${st.size}`).digest('hex');
  return `${hash.slice(0, 20)}.png`;
}

const pngDataURL = (file) => `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;

function runIconHelper(jobs) {
  const inFile = path.join(os.tmpdir(), `edgelet-icons-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(inFile, JSON.stringify(jobs));
  return new Promise((resolve) => {
    execFile('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ICON_HELPER, '-In', inFile,
    ], { windowsHide: true, timeout: 30000 }, () => {
      fs.rm(inFile, { force: true }, () => {});
      resolve();
    });
  });
}

async function loadIcons(paths) {
  const result = new Map();
  const jobs = [];
  fs.mkdirSync(ICON_DIR, { recursive: true });
  for (const p of paths) {
    const key = iconKey(p);
    if (!key) { result.set(p, null); continue; }
    if (iconCache.has(key)) { result.set(p, iconCache.get(key)); continue; }
    const file = path.join(ICON_DIR, key);
    if (fs.existsSync(file)) {
      iconCache.set(key, pngDataURL(file));
      result.set(p, iconCache.get(key));
    } else {
      jobs.push({ path: p, out: file, key });
    }
  }
  if (jobs.length) {
    await runIconHelper(jobs.map(({ path: p, out }) => ({ path: p, out })));
    for (const j of jobs) {
      let url = null;
      if (fs.existsSync(j.out)) {
        url = pngDataURL(j.out);
      } else {
        // 提取失败时退回 Electron 自带的 32px 图标
        try { url = (await app.getFileIcon(j.path, { size: 'large' })).toDataURL(); } catch { /* 显示首字母 */ }
      }
      iconCache.set(j.key, url);
      result.set(j.path, url);
    }
  }
  return result;
}

// 排队执行，避免多次刷新同时提取同一批图标
function loadIconsQueued(paths) {
  const run = iconQueue.then(() => loadIcons(paths));
  iconQueue = run.catch(() => {});
  return run;
}

function displayName(p) {
  const base = path.basename(p);
  if (!base) return p; // 盘符根目录，如 D:\
  return base.replace(/\.(lnk|url|exe|appref-ms)$/i, '');
}

async function buildState() {
  const icons = await loadIconsQueued(cfg.items.map((it) => it.path));
  const items = cfg.items.map((it) => ({
    id: it.id,
    path: it.path,
    name: it.name || displayName(it.path),
    defaultName: displayName(it.path),
    missing: !fs.existsSync(it.path),
    icon: icons.get(it.path) ?? null,          // 系统图标
    iconPreset: it.iconPreset || null,         // 预制图标 id
    customIcon: customIconURL(it),             // 用户选择的图片
  }));
  return {
    items,
    edge: cfg.edge,
    layout: layoutFor(cfg.edge),
    expanded,
    autoHide: cfg.autoHide,
    hotkey: cfg.hotkey,
    lang: uiLang(),
    view: cfg.view,
    memos: cfg.memos,
  };
}

const CUSTOM_ICON_DIR = path.join(app.getPath('userData'), 'custom-icons');

function customIconURL(it) {
  if (!it.iconFile) return null;
  const file = path.join(CUSTOM_ICON_DIR, it.iconFile);
  if (!fs.existsSync(file)) return null;
  const ext = path.extname(file).slice(1).toLowerCase();
  const mime = { svg: 'image/svg+xml', ico: 'image/x-icon', jpg: 'image/jpeg', jpeg: 'image/jpeg' }[ext] || `image/${ext}`;
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
}

function removeCustomIconFile(it) {
  if (it.iconFile) fs.rm(path.join(CUSTOM_ICON_DIR, it.iconFile), { force: true }, () => {});
  delete it.iconFile;
}

function updateItem(id, fn) {
  const item = cfg.items.find((i) => i.id === id);
  if (!item) return;
  fn(item);
  saveConfig();
  pushState();
}

async function pickIconFile(id) {
  busy = true;
  try {
    const r = await dialog.showOpenDialog(win, {
      title: t('dlg.pickIcon'),
      properties: ['openFile'],
      filters: [{ name: t('dlg.images'), extensions: ['png', 'jpg', 'jpeg', 'ico', 'svg', 'webp', 'gif', 'bmp'] }],
    });
    if (r.canceled || !r.filePaths[0]) return;
    const src = r.filePaths[0];
    fs.mkdirSync(CUSTOM_ICON_DIR, { recursive: true });
    const fileName = `${id}-${Date.now()}${path.extname(src).toLowerCase()}`;
    fs.copyFileSync(src, path.join(CUSTOM_ICON_DIR, fileName));
    updateItem(id, (it) => {
      removeCustomIconFile(it);
      delete it.iconPreset;
      it.iconFile = fileName;
    });
  } finally {
    busy = false;
  }
}

async function pushState() {
  if (!win) return;
  const s = await buildState();
  if (win) win.webContents.send('state', s); // 等待期间窗口可能已关闭
}

function addPaths(paths) {
  const known = new Set(cfg.items.map((i) => i.path.toLowerCase()));
  let added = 0;
  for (const p of paths) {
    if (!p || known.has(p.toLowerCase()) || !fs.existsSync(p)) continue;
    cfg.items.push({ id: Math.random().toString(36).slice(2, 10), path: p });
    known.add(p.toLowerCase());
    added++;
  }
  if (added) { saveConfig(); pushState(); }
}

// ---- 备忘 ----
const memoText = (t) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, MEMO_MAX);

function updateMemo(id, fn) {
  const m = cfg.memos.find((x) => x.id === id);
  if (!m) return;
  fn(m);
  saveConfig();
  pushState();
}

function setMemoDone(m, done) {
  m.done = done;
  m.doneAt = done ? Date.now() : null;
}

// 日期都按本地时间的字符串存（YYYY-MM-DD / HH:MM），避免时区换算出错
function cleanDue(d) {
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return null;
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(d.time) ? d.time : null;
  return { date: d.date, time };
}

const dueKey = (m) => `${m.due.date} ${m.due.time || ''}`;

function remindAt(m) {
  const [y, mo, d] = m.due.date.split('-').map(Number);
  const [h, mi] = (m.due.time || DAY_REMIND).split(':').map(Number);
  return new Date(y, mo - 1, d, h, mi).getTime();
}

function setMemoDue(m, due) {
  m.due = cleanDue(due);
  delete m.reminded;
  // 设成已经过去的时间就不再提醒，只在列表里标成过期
  if (m.due && remindAt(m) <= Date.now()) m.reminded = dueKey(m);
}

const APP_ID = 'io.github.luylin5.edgelet'; // 与 package.json 的 build.appId 一致

// Windows 通知顶部的名称和图标取自开始菜单里带同一 AppUserModelID 的快捷方式。
// 安装版由安装程序创建；开发运行和便携版没有，这里补一个，否则通知会显示成「Electron」。
function ensureNotificationShortcut() {
  if (process.platform !== 'win32') return;
  const portable = process.env.PORTABLE_EXECUTABLE_FILE; // electron-builder 便携版提供
  if (app.isPackaged && !portable) return;
  const folder = portable ? 'Edgelet Portable' : 'Edgelet Dev';
  const lnk = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', folder, 'Edgelet.lnk');
  const target = portable || process.execPath;
  const args = portable ? '' : `"${path.resolve(app.getAppPath())}"`;
  // 便携版每次运行解压到不同的临时目录，图标直接取 exe 本身
  const opts = { target, args, appUserModelId: APP_ID, icon: portable || APP_ICON, iconIndex: 0, description: 'Edgelet' };
  try {
    const cur = shell.readShortcutLink(lnk);
    if (cur.target === target && cur.args === args && cur.appUserModelId === APP_ID) return;
  } catch { /* 还没有快捷方式 */ }
  try {
    fs.mkdirSync(path.dirname(lnk), { recursive: true });
    shell.writeShortcutLink(lnk, fs.existsSync(lnk) ? 'replace' : 'create', opts);
  } catch { /* 写不了也不影响通知弹出，只是名称不对 */ }
}

const notices = new Set(); // 保留引用，否则通知被回收后点击无效

function notify(title, body) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: APP_ICON });
  n.on('click', () => {
    setView('memo');
    hotkeyHold = cfg.autoHide;
    setExpanded(true, { focus: true });
  });
  n.on('close', () => notices.delete(n));
  notices.add(n);
  n.show();
}

function checkReminders() {
  if (!cfg.remind || !win) return;
  const now = Date.now();
  const timed = [];
  const daily = [];
  let changed = false;
  for (const m of cfg.memos) {
    if (m.done || !m.due || m.reminded === dueKey(m)) continue;
    const at = remindAt(m);
    if (at > now) continue;
    m.reminded = dueKey(m);
    changed = true;
    if (now - at <= MISSED_MS) (m.due.time ? timed : daily).push(m);
  }
  if (!changed) return;
  saveConfig();
  for (const m of timed) notify(t('notify.timed', m.due.time), m.text);
  if (daily.length) notify(t('notify.daily', daily.length), daily.map((m) => `· ${m.text}`).join('\n'));
  const ids = [...timed, ...daily].map((m) => m.id);
  if (ids.length) win.webContents.send('reminder', ids);
}

function removeMemos(pred) {
  cfg.memos = cfg.memos.filter((m) => !pred(m));
  saveConfig();
  pushState();
}

function setView(view) {
  if (view !== 'apps' && view !== 'memo') return;
  if (cfg.view === view) return;
  cfg.view = view;
  saveConfig();
  pushState(); // 尺寸不变；渲染层自己切页时这次推送不会引起变化，主要给通知点击用
}

function toast(msg) {
  win?.webContents.send('toast', msg);
}

async function launch(item) {
  const err = await shell.openPath(item.path);
  if (err) { toast(t('toast.openFailed', err)); return; }
  if (cfg.autoHide) setTimeout(() => setExpanded(false), 150);
}

function runAsAdmin(p) {
  const quoted = p.replace(/'/g, "''");
  spawn('powershell.exe', [
    '-NoProfile', '-WindowStyle', 'Hidden', '-Command',
    `Start-Process -FilePath '${quoted}' -Verb RunAs`,
  ], { detached: true, windowsHide: true, stdio: 'ignore' }).unref();
  if (cfg.autoHide) setTimeout(() => setExpanded(false), 150);
}

async function pickAndAdd(folder) {
  busy = true;
  try {
    const r = await dialog.showOpenDialog(win, {
      title: folder ? t('dlg.addFolder') : t('dlg.addFile'),
      properties: folder ? ['openDirectory', 'multiSelections'] : ['openFile', 'multiSelections'],
    });
    if (!r.canceled) addPaths(r.filePaths);
  } finally {
    busy = false;
  }
}

// ---- 开机启动 ----
function loginArgs() {
  return app.isPackaged ? [] : [path.resolve(app.getAppPath())];
}
function isOpenAtLogin() {
  return app.getLoginItemSettings({ path: process.execPath, args: loginArgs() }).openAtLogin;
}
function setOpenAtLogin(on) {
  app.setLoginItemSettings({ openAtLogin: on, path: process.execPath, args: loginArgs() });
}

let hotkeyOk = true;
function updateTrayTip() {
  tray?.setToolTip(hotkeyOk ? t('tray.tip', cfg.hotkey) : t('tray.tipBusy', cfg.hotkey));
}

function setLang(lang) {
  cfg.lang = lang;
  saveConfig();
  rebuildTray();
  updateTrayTip();
  pushState();
}

function setAutoHide(on) {
  cfg.autoHide = on;
  saveConfig();
  setExpanded(!on);
  rebuildTray();
  pushState();
}

function setLayoutOption(key, value) {
  cfg[key] = value;
  saveConfig();
  applyPlacement();
  rebuildTray();
}

function commonMenuItems() {
  return [
    {
      label: t('menu.layout'),
      submenu: LAYOUTS.map((l) => ({
        label: t(`layout.${l.id}`), type: 'radio', checked: cfg.layout === l.id, click: () => setLayoutOption('layout', l.id),
      })),
    },
    {
      label: t('menu.iconSize'),
      submenu: ICON_SIZES.map((z) => ({
        label: t(`size.${z.id}`), type: 'radio', checked: cfg.iconSize === z.id, click: () => setLayoutOption('iconSize', z.id),
      })),
    },
    { label: t('menu.showLabels'), type: 'checkbox', checked: cfg.showLabels, click: (mi) => setLayoutOption('showLabels', mi.checked) },
    { type: 'separator' },
    { label: t('menu.autoHide'), type: 'checkbox', checked: cfg.autoHide, click: (mi) => setAutoHide(mi.checked) },
    { label: t('menu.openAtLogin'), type: 'checkbox', checked: isOpenAtLogin(), click: (mi) => setOpenAtLogin(mi.checked) },
    {
      label: t('menu.language'),
      submenu: [['auto', t('lang.auto')], ['zh', '中文'], ['en', 'English']].map(([id, label]) => ({
        label, type: 'radio', checked: (cfg.lang || 'auto') === id, click: () => setLang(id),
      })),
    },
    { label: t('menu.openConfig'), click: () => shell.openPath(path.dirname(CONFIG_PATH)) },
    { type: 'separator' },
    { label: t('menu.quit'), click: () => app.quit() },
  ];
}

function popup(template) {
  busy = true;
  Menu.buildFromTemplate(template).popup({
    window: win,
    callback: () => { busy = false; leaveSince = 0; },
  });
}

// ---- 托盘 ----
function rebuildTray() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: t('tray.show', cfg.hotkey), click: () => { hotkeyHold = cfg.autoHide; setExpanded(true, { focus: true }); } },
    { label: t('menu.addFile'), click: () => pickAndAdd(false) },
    { type: 'separator' },
    ...commonMenuItems(),
  ]));
}

function registerHotkey() {
  globalShortcut.unregisterAll();
  let ok = false;
  try { ok = globalShortcut.register(cfg.hotkey, toggleByHotkey); } catch { ok = false; }
  hotkeyOk = ok;
  updateTrayTip();
}

// ---- IPC ----
ipcMain.handle('get-state', buildState);
ipcMain.on('launch', (_e, id) => {
  const item = cfg.items.find((i) => i.id === id);
  if (item) launch(item);
});
ipcMain.on('add-paths', (_e, paths) => addPaths(Array.isArray(paths) ? paths : []));
ipcMain.on('reorder', (_e, ids) => {
  const byId = new Map(cfg.items.map((i) => [i.id, i]));
  const next = ids.map((id) => byId.get(id)).filter(Boolean);
  if (next.length === cfg.items.length) { cfg.items = next; saveConfig(); }
  pushState();
});
ipcMain.on('rename', (_e, id, name) => updateItem(id, (it) => {
  const n = String(name || '').trim().slice(0, 60);
  if (n && n !== displayName(it.path)) it.name = n; else delete it.name;
}));
ipcMain.on('set-icon', (_e, id, presetId) => updateItem(id, (it) => {
  removeCustomIconFile(it);
  if (presetId) it.iconPreset = String(presetId); else delete it.iconPreset;
}));
ipcMain.on('pick-icon-file', (_e, id) => pickIconFile(id));
ipcMain.on('hold', (_e, on) => {
  uiHold = !!on;
  leaveSince = 0;
  if (uiHold) win.focus();
});
ipcMain.on('hide', () => { if (cfg.autoHide) setExpanded(false); });
ipcMain.on('set-view', (_e, view) => setView(view));
ipcMain.on('memo-add', (_e, memo) => {
  const text = memoText(memo?.text);
  const id = String(memo?.id || '').slice(0, 16) || Math.random().toString(36).slice(2, 10);
  if (!text || cfg.memos.some((m) => m.id === id)) return;
  const m = { id, text, done: false, createdAt: Date.now(), doneAt: null };
  setMemoDue(m, memo.due);
  cfg.memos.push(m);
  saveConfig();
  pushState();
});
ipcMain.on('memo-update', (_e, id, patch) => updateMemo(id, (m) => {
  if (typeof patch?.done === 'boolean' && patch.done !== m.done) setMemoDone(m, patch.done);
  const text = patch?.text !== undefined && memoText(patch.text);
  if (text) m.text = text;
  if (patch && 'due' in patch) setMemoDue(m, patch.due);
}));
ipcMain.on('memo-remove', (_e, id) => removeMemos((m) => m.id === id));
ipcMain.on('menu', (_e, ctx) => {
  if (ctx?.type === 'input') {
    popup([
      { label: t('edit.cut'), role: 'cut' },
      { label: t('edit.copy'), role: 'copy' },
      { label: t('edit.paste'), role: 'paste' },
      { type: 'separator' },
      { label: t('edit.selectAll'), role: 'selectAll' },
    ]);
  } else if (ctx?.type === 'memo') {
    const m = cfg.memos.find((x) => x.id === ctx.id);
    if (!m) return;
    // 日期由渲染层计算（和输入识别共用一套规则）
    const date = (key) => () => win.webContents.send('memo-date', m.id, key);
    popup([
      { label: m.done ? t('memo.uncomplete') : t('memo.complete'), click: () => updateMemo(m.id, (x) => setMemoDone(x, !x.done)) },
      { label: t('memo.edit'), click: () => win.webContents.send('begin-memo-edit', m.id) },
      {
        label: t('memo.date'),
        submenu: [
          { label: t('date.today'), click: date('today') },
          { label: t('date.tomorrow'), click: date('tomorrow') },
          { label: t('date.weekend'), click: date('weekend') },
          { label: t('date.nextweek'), click: date('nextweek') },
          { label: t('date.pick'), click: date('pick') },
          ...(m.due ? [{ type: 'separator' }, { label: t('date.clear'), click: date('clear') }] : []),
        ],
      },
      { label: t('memo.copy'), click: () => clipboard.writeText(m.text) },
      { type: 'separator' },
      { label: t('memo.delete'), click: () => removeMemos((x) => x.id === m.id) },
    ]);
  } else if (ctx?.type === 'item') {
    const item = cfg.items.find((i) => i.id === ctx.id);
    if (!item) return;
    const runnable = /\.(exe|lnk|bat|cmd|msc)$/i.test(item.path);
    popup([
      { label: t('item.open'), click: () => launch(item) },
      ...(runnable ? [{ label: t('item.runAdmin'), click: () => runAsAdmin(item.path) }] : []),
      { label: t('item.showInFolder'), click: () => shell.showItemInFolder(item.path) },
      { type: 'separator' },
      { label: t('item.rename'), click: () => win.webContents.send('begin-rename', item.id) },
      { label: t('item.changeIcon'), click: () => win.webContents.send('open-icon-picker', item.id) },
      ...(item.name || item.iconPreset || item.iconFile ? [{
        label: t('item.reset'),
        click: () => updateItem(item.id, (it) => { delete it.name; delete it.iconPreset; removeCustomIconFile(it); }),
      }] : []),
      { type: 'separator' },
      {
        label: t('item.remove'),
        click: () => {
          removeCustomIconFile(item);
          cfg.items = cfg.items.filter((i) => i.id !== item.id);
          saveConfig();
          pushState();
        },
      },
    ]);
  } else if (cfg.view === 'memo') {
    const doneCount = cfg.memos.filter((m) => m.done).length;
    popup([
      { label: t('memo.clearDone', doneCount), enabled: doneCount > 0, click: () => removeMemos((m) => m.done) },
      {
        label: t('memo.remind'),
        type: 'checkbox',
        checked: cfg.remind,
        click: (mi) => {
          cfg.remind = mi.checked;
          // 重新打开时不补发关闭期间错过的提醒
          if (cfg.remind) for (const x of cfg.memos) if (x.due && remindAt(x) <= Date.now()) x.reminded = dueKey(x);
          saveConfig();
        },
      },
      { type: 'separator' },
      ...commonMenuItems(),
    ]);
  } else {
    popup([
      { label: t('menu.addFile'), click: () => pickAndAdd(false) },
      { label: t('menu.addFolder'), click: () => pickAndAdd(true) },
      { type: 'separator' },
      ...commonMenuItems(),
    ]);
  }
});

// ---- 启动 ----
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    hotkeyHold = cfg.autoHide;
    setExpanded(true, { focus: true });
  });

  if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

  app.whenReady().then(() => {
    ensureNotificationShortcut();
    createWindow();
    win.webContents.once('did-finish-load', checkReminders);
    setInterval(checkReminders, REMIND_POLL_MS);
    tray = new Tray(APP_ICON);
    tray.on('click', toggleByHotkey);
    rebuildTray();
    registerHotkey();
    setInterval(tick, POLL_MS);
    for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) {
      screen.on(ev, () => applyPlacement());
    }
  });

  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => globalShortcut.unregisterAll());
}
