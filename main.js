const {
  app, BrowserWindow, ipcMain, screen, shell,
  Menu, Tray, globalShortcut, dialog,
} = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

const APP_ICON = path.join(__dirname, 'assets', 'icon.ico');

// ---- 尺寸与交互参数（单位：DIP） ----
const PAD = 12;         // 面板内边距
const HEADER = 34;      // 标题栏高度（含顶部留白）
const MARGIN = 16;      // 非贴边一侧留给阴影的空间
const HOT = 5;          // 收起时，屏幕边缘的感应厚度
const KEEP = 10;        // 展开后，鼠标离开面板多少像素内仍保持展开
const POLL_MS = 60;
const SHOW_DELAY = 120; // 鼠标在边缘停留多久才弹出，避免误触
const HIDE_DELAY = 380;

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
};

// 预制布局：列 × 行（贴左右边时；贴上下边时自动转置）
const LAYOUTS = [
  { id: 'strip', label: '竖条 1 × 6', cols: 1, rows: 6 },
  { id: 'compact', label: '紧凑 2 × 4', cols: 2, rows: 4 },
  { id: 'standard', label: '标准 3 × 4', cols: 3, rows: 4 },
  { id: 'square', label: '方阵 4 × 4', cols: 4, rows: 4 },
  { id: 'large', label: '大面板 4 × 6', cols: 4, rows: 6 },
];
const ICON_SIZES = [
  { id: 'small', label: '小', icon: 30, cell: 64, bare: 48 },
  { id: 'medium', label: '中', icon: 38, cell: 78, bare: 58 },
  { id: 'large', label: '大', icon: 48, cell: 92, bare: 70 },
];

let cfg = loadConfig();
let saveTimer = null;

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
  const pw = Math.max(cols * cell + PAD * 2, 104); // 至少放得下标题栏
  const ph = rows * cell + HEADER + PAD;
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
const ICON_HELPER = path.join(__dirname, 'helpers', 'file-icons.ps1');
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
      title: '选择图标图片',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'ico', 'svg', 'webp', 'gif', 'bmp'] }],
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
  win.webContents.send('state', await buildState());
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

function toast(msg) {
  win?.webContents.send('toast', msg);
}

async function launch(item) {
  const err = await shell.openPath(item.path);
  if (err) { toast(`无法打开：${err}`); return; }
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
      title: folder ? '添加文件夹' : '添加文件或软件',
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
      label: '布局',
      submenu: LAYOUTS.map((l) => ({
        label: l.label, type: 'radio', checked: cfg.layout === l.id, click: () => setLayoutOption('layout', l.id),
      })),
    },
    {
      label: '图标大小',
      submenu: ICON_SIZES.map((z) => ({
        label: z.label, type: 'radio', checked: cfg.iconSize === z.id, click: () => setLayoutOption('iconSize', z.id),
      })),
    },
    { label: '显示名称', type: 'checkbox', checked: cfg.showLabels, click: (mi) => setLayoutOption('showLabels', mi.checked) },
    { type: 'separator' },
    { label: '自动隐藏', type: 'checkbox', checked: cfg.autoHide, click: (mi) => setAutoHide(mi.checked) },
    { label: '开机启动', type: 'checkbox', checked: isOpenAtLogin(), click: (mi) => setOpenAtLogin(mi.checked) },
    { label: '打开配置文件夹', click: () => shell.openPath(path.dirname(CONFIG_PATH)) },
    { type: 'separator' },
    { label: '退出 Edgelet', click: () => app.quit() },
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
    { label: `显示面板\t${cfg.hotkey}`, click: () => { hotkeyHold = cfg.autoHide; setExpanded(true, { focus: true }); } },
    { label: '添加文件或软件…', click: () => pickAndAdd(false) },
    { type: 'separator' },
    ...commonMenuItems(),
  ]));
}

function registerHotkey() {
  globalShortcut.unregisterAll();
  let ok = false;
  try { ok = globalShortcut.register(cfg.hotkey, toggleByHotkey); } catch { ok = false; }
  tray?.setToolTip(ok ? `Edgelet（${cfg.hotkey} 呼出）` : `Edgelet（快捷键 ${cfg.hotkey} 被占用）`);
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
ipcMain.on('menu', (_e, ctx) => {
  if (ctx?.type === 'item') {
    const item = cfg.items.find((i) => i.id === ctx.id);
    if (!item) return;
    const runnable = /\.(exe|lnk|bat|cmd|msc)$/i.test(item.path);
    popup([
      { label: '打开', click: () => launch(item) },
      ...(runnable ? [{ label: '以管理员身份运行', click: () => runAsAdmin(item.path) }] : []),
      { label: '打开文件所在位置', click: () => shell.showItemInFolder(item.path) },
      { type: 'separator' },
      { label: '重命名', click: () => win.webContents.send('begin-rename', item.id) },
      { label: '更换图标…', click: () => win.webContents.send('open-icon-picker', item.id) },
      ...(item.name || item.iconPreset || item.iconFile ? [{
        label: '恢复默认名称和图标',
        click: () => updateItem(item.id, (it) => { delete it.name; delete it.iconPreset; removeCustomIconFile(it); }),
      }] : []),
      { type: 'separator' },
      {
        label: '从面板移除',
        click: () => {
          removeCustomIconFile(item);
          cfg.items = cfg.items.filter((i) => i.id !== item.id);
          saveConfig();
          pushState();
        },
      },
    ]);
  } else {
    popup([
      { label: '添加文件或软件…', click: () => pickAndAdd(false) },
      { label: '添加文件夹…', click: () => pickAndAdd(true) },
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

  app.whenReady().then(() => {
    createWindow();
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
