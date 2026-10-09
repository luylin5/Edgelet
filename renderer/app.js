const api = window.edgelet;
const body = document.body;
const panel = document.getElementById('panel');
const handle = document.getElementById('handle');
const grid = document.getElementById('grid');
const toastEl = document.getElementById('toast');
const memoList = document.getElementById('memo-list');
const memoInput = document.getElementById('memo-input');

let state = null;
let dragId = null;
let editing = null;       // 正在重命名的条目 id
let pendingState = null;  // 编辑期间收到的新状态，结束后再渲染
const lastLaunch = new Map();

// ---- 界面语言：由主进程在状态里给出（zh / en），切换后重新填写所有文字 ----
const I18N = window.EdgeletI18n;
let lang = null;
let tr = I18N.make('zh');
const pick2 = (pair) => (Array.isArray(pair) ? pair[lang === 'en' ? 1 : 0] : pair); // 预制图标的 [中文, English] 名称

function applyLang(l) {
  lang = l;
  tr = I18N.make(l);
  window.EdgeletDates.setLang(l);
  document.documentElement.lang = l === 'en' ? 'en' : 'zh-CN';
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const v = tr(el.dataset.i18n);
    if (v.includes('<')) el.innerHTML = v; else el.textContent = v;
  }
  for (const el of document.querySelectorAll('[data-i18n-title]')) {
    const v = tr(el.dataset.i18nTitle);
    el.title = v;
    el.setAttribute('aria-label', v);
  }
  for (const el of document.querySelectorAll('[data-i18n-ph]')) el.placeholder = tr(el.dataset.i18nPh);
  for (const el of document.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', tr(el.dataset.i18nAria));
  document.getElementById('cal-week').replaceChildren(...window.EdgeletDates.weekHeads().map((w) => {
    const span = document.createElement('span');
    span.textContent = w;
    return span;
  }));
  renderDueRow();
}

// 面板内可能同时有多处要求保持展开（重命名、选图标、输入备忘、选日期），全部结束才放开
const holds = new Set();
let held = false;
function setHold(key, on) {
  if (on) holds.add(key); else holds.delete(key);
  if (held !== holds.size > 0) api.hold(held = holds.size > 0);
}

// 显示优先级：预制图标 > 自定义图片 > 系统图标
const iconSrc = (item) => (item.iconPreset && window.EdgeletPresets.url(item.iconPreset)) || item.customIcon || item.icon;

function render(s) {
  if (editing) { pendingState = s; return; }
  state = s;
  if (s.lang !== lang) applyLang(s.lang);
  const L = s.layout;
  body.dataset.edge = s.edge;
  body.dataset.view = s.view;
  body.classList.toggle('is-empty', s.items.length === 0);
  body.classList.toggle('no-labels', !L.showLabels);
  body.style.setProperty('--icon', L.icon + 'px');

  Object.assign(panel.style, {
    left: `${L.ox}px`, top: `${L.oy}px`, width: `${L.pw}px`, height: `${L.ph}px`,
  });

  // 把手：贴边一侧的细条，占面板长度的 40%
  handle.style.cssText = '';
  const T = 4, inset = 2;
  if (s.edge === 'left' || s.edge === 'right') {
    Object.assign(handle.style, {
      [s.edge]: `${inset}px`, top: `${L.oy + L.ph * 0.3}px`, width: `${T}px`, height: `${L.ph * 0.4}px`,
    });
  } else {
    Object.assign(handle.style, {
      [s.edge]: `${inset}px`, left: `${L.ox + L.pw * 0.3}px`, height: `${T}px`, width: `${L.pw * 0.4}px`,
    });
  }

  grid.style.gridTemplateColumns = `repeat(${L.cols}, ${L.cell}px)`;
  grid.style.gridAutoRows = `${L.cell}px`;
  grid.style.height = `${L.ph - L.header - L.pad}px`; // 面板可能比网格高（和备忘页同尺寸），网格在其中垂直居中

  const focusedId = document.activeElement?.dataset?.id;
  grid.replaceChildren();
  for (const item of s.items) grid.append(tileFor(item));
  const slots = Math.max(0, L.cols * L.rows - s.items.length);
  for (let i = 0; i < slots; i++) {
    const slot = document.createElement('div');
    slot.className = 'slot';
    grid.append(slot);
  }
  if (focusedId) grid.querySelector(`.tile[data-id="${focusedId}"]`)?.focus();
  renderMemos();
  revealAlerts();
}

function tileFor(item) {
  const btn = document.createElement('button');
  btn.className = 'tile' + (item.missing ? ' missing' : '');
  btn.dataset.id = item.id;
  btn.draggable = true;
  btn.title = `${item.name}\n${item.path}${item.missing ? `\n${tr('tile.missing')}` : ''}`;

  let icon;
  const src = iconSrc(item);
  if (src) {
    icon = document.createElement('img');
    icon.src = src;
    icon.alt = '';
  } else {
    icon = document.createElement('div');
    icon.className = 'fallback';
    icon.textContent = (item.name[0] || '?').toUpperCase();
  }
  icon.classList.add('icon');

  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = item.name;

  btn.append(icon, label);
  btn.addEventListener('click', () => {
    if (editing) return;
    const now = Date.now();
    if (now - (lastLaunch.get(item.id) || 0) < 800) return; // 防止双击打开两次
    lastLaunch.set(item.id, now);
    api.launch(item.id);
  });
  btn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    api.menu({ type: 'item', id: item.id });
  });
  btn.addEventListener('dragstart', (e) => {
    if (editing) { e.preventDefault(); return; }
    dragId = item.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/x-edgelet', item.id);
    btn.classList.add('dragging');
  });
  btn.addEventListener('dragend', () => {
    dragId = null;
    clearDropMarks();
  });
  return btn;
}

function clearDropMarks() {
  for (const el of grid.querySelectorAll('.dragging, .drop-before, .drop-after')) {
    el.classList.remove('dragging', 'drop-before', 'drop-after');
  }
}

// 根据鼠标位置决定插到目标前还是后
function dropTarget(e) {
  const tile = e.target.closest?.('.tile');
  if (!tile || tile.dataset.id === dragId) return null;
  const r = tile.getBoundingClientRect();
  return { tile, after: e.clientX > r.left + r.width / 2 };
}

// 备忘页不接收文件拖入
const hasFiles = (e) => body.dataset.view === 'apps' && [...(e.dataTransfer?.types || [])].includes('Files');

document.addEventListener('dragover', (e) => {
  e.preventDefault();
  if (dragId) {
    e.dataTransfer.dropEffect = 'move';
    for (const el of grid.querySelectorAll('.drop-before, .drop-after')) el.classList.remove('drop-before', 'drop-after');
    const t = dropTarget(e);
    if (t) t.tile.classList.add(t.after ? 'drop-after' : 'drop-before');
  } else if (hasFiles(e)) {
    e.dataTransfer.dropEffect = 'copy';
    body.classList.add('dropping');
  }
});

document.addEventListener('dragleave', (e) => {
  if (!e.relatedTarget) body.classList.remove('dropping');
});

document.addEventListener('drop', (e) => {
  e.preventDefault();
  body.classList.remove('dropping');

  if (dragId) {
    const t = dropTarget(e);
    if (t) {
      const ids = state.items.map((i) => i.id).filter((id) => id !== dragId);
      let idx = ids.indexOf(t.tile.dataset.id);
      if (t.after) idx++;
      ids.splice(idx, 0, dragId);
      const byId = new Map(state.items.map((i) => [i.id, i]));
      render({ ...state, items: ids.map((id) => byId.get(id)) }); // 先本地更新，避免闪烁
      api.reorder(ids);
    }
    dragId = null;
    clearDropMarks();
    return;
  }

  if (!hasFiles(e)) return;
  const paths = [...e.dataTransfer.files].map((f) => api.pathForFile(f)).filter(Boolean);
  if (paths.length) api.addPaths(paths);
});

document.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  api.menu({ type: 'panel' });
});
document.getElementById('more').addEventListener('click', () => api.menu({ type: 'panel' }));

// ---- 重命名（只改面板里显示的名称，不动真实文件） ----
function beginRename(id) {
  const tile = grid.querySelector(`.tile[data-id="${id}"]`);
  const item = state?.items.find((i) => i.id === id);
  if (!tile || !item || editing) return;
  closePicker();
  editing = id;
  setHold('rename', true);
  tile.draggable = false;

  const input = document.createElement('input');
  input.className = 'rename';
  input.value = item.name;
  input.placeholder = item.defaultName;
  input.spellcheck = false;
  tile.querySelector('.label').replaceWith(input);

  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    const value = input.value.trim();
    editing = null;
    setHold('rename', false);
    if (save && value !== item.name) {
      // 先在本地显示新名字，再交给主进程保存
      item.name = value || item.defaultName;
      api.rename(id, value);
    }
    const next = pendingState || state;
    pendingState = null;
    render(next);
    grid.querySelector(`.tile[data-id="${id}"]`)?.focus();
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('contextmenu', (e) => e.stopPropagation());
  // 等窗口拿到焦点后再选中文字
  setTimeout(() => { input.focus(); input.select(); }, 30);
}

// ---- 图标选择器 ----
const picker = document.getElementById('picker');
const pickerBody = document.getElementById('picker-body');

function choiceButton({ title, src, selected, onPick, upload }) {
  const b = document.createElement('button');
  b.className = 'choice' + (selected ? ' selected' : '') + (upload ? ' upload' : '');
  b.title = title;
  if (upload) {
    b.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>';
  } else if (src) {
    const img = document.createElement('img');
    img.src = src;
    img.alt = '';
    b.append(img);
  }
  b.addEventListener('click', onPick);
  return b;
}

function section(title, buttons) {
  const h = document.createElement('div');
  h.className = 'picker-section';
  h.textContent = title;
  const g = document.createElement('div');
  g.className = 'picker-grid';
  g.append(...buttons);
  pickerBody.append(h, g);
}

function openPicker(id) {
  const item = state?.items.find((i) => i.id === id);
  if (!item || editing) return;
  setHold('picker', true);
  document.getElementById('picker-title').textContent = tr('picker.titleFor', item.name);
  pickerBody.replaceChildren();

  const choose = (presetId) => () => { api.setIcon(id, presetId); closePicker(); };
  section(tr('picker.current'), [
    choiceButton({
      title: tr('picker.system'),
      src: item.icon,
      selected: !item.iconPreset && !item.customIcon,
      onPick: choose(null),
    }),
    ...(item.customIcon ? [choiceButton({
      title: tr('picker.custom'), src: item.customIcon, selected: !item.iconPreset, onPick: closePicker,
    })] : []),
    choiceButton({
      title: tr('picker.upload'),
      upload: true,
      onPick: () => { closePicker(); api.pickIconFile(id); },
    }),
  ]);
  for (const group of window.EdgeletPresets.groups) {
    section(pick2(group.title), group.items.map((p) => choiceButton({
      title: pick2(p.name), src: p.url, selected: item.iconPreset === p.id, onPick: choose(p.id),
    })));
  }
  picker.hidden = false;
  pickerBody.scrollTop = 0;
  setTimeout(() => picker.querySelector('.choice.selected, .choice')?.focus(), 30);
}

function closePicker() {
  if (picker.hidden) return;
  picker.hidden = true;
  setHold('picker', false);
}

document.getElementById('picker-close').addEventListener('click', closePicker);
picker.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); });

api.onBeginRename(beginRename);
api.onOpenIconPicker(openPicker);

// ---- 顶部滑块：启动 / 备忘 ----
for (const b of document.querySelectorAll('#views button')) {
  b.addEventListener('click', () => switchView(b.dataset.view));
}

function switchView(view) {
  if (!state || state.view === view || editing) return;
  closePicker();
  closeDuePicker();
  body.dataset.view = view; // 先切过去，面板尺寸随后由主进程调整
  state.view = view;
  api.setView(view);
  if (view === 'memo') {
    memoTop = true;
    renderMemos();
    revealAlerts();
  }
}

// ---- 备忘：底部输入，回车添加；单击完成，再次单击恢复 ----
const D = window.EdgeletDates;
let showDone = false;
try { showDone = localStorage.getItem('memo.showDone') === '1'; } catch { /* 默认收起 */ }
let memoTop = true;      // 下次渲染时滚回顶部（最新一条）
let memoReveal = null;   // 下次渲染时滚到这一条（新加的带日期备忘、刚提醒的备忘）
const flashUntil = new Map();

const CHECK_SVG = '<svg viewBox="0 0 10 10"><path d="M2 5.2l2 2 4-4.4"/></svg>';
const CHEVRON_SVG = '<svg viewBox="0 0 10 10"><path d="M3.5 2l3 3-3 3"/></svg>';
const CAL_SVG = '<svg viewBox="0 0 16 16"><rect x="2.5" y="3.5" width="11" height="10" rx="2"/><path d="M2.5 7h11M5.5 2v3M10.5 2v3"/></svg>';
const X_SVG = '<svg viewBox="0 0 16 16"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>';
const cleanText = (t) => t.replace(/\s+/g, ' ').trim();


// 短暂高亮几条备忘（新加的、刚改了日期的、刚提醒的）
function flash(ids, ms = 1400) {
  const until = Date.now() + ms;
  for (const id of ids) flashUntil.set(id, until);
  setTimeout(() => {
    for (const el of memoList.querySelectorAll('.memo-item.flash')) {
      if (!(flashUntil.get(el.dataset.memo) > Date.now())) el.classList.remove('flash');
    }
  }, ms + 50);
}

// 待办从顶部开始排，按日期分组：已过期 → 今天 → 明天 → 以后 → 无日期；组内从新到旧
const GROUPS = ['overdue', 'today', 'tomorrow', 'later', 'none'];
const newestFirst = (a, b) => b.createdAt - a.createdAt;

function renderMemos() {
  if (!state || editing) return;
  const scrollTop = memoList.scrollTop;
  const focusedId = document.activeElement?.dataset?.memo;
  const active = state.memos.filter((m) => !m.done).sort(newestFirst);
  const done = state.memos.filter((m) => m.done).sort((a, b) => b.doneAt - a.doneAt);

  memoList.replaceChildren();
  if (!state.memos.length) {
    const empty = document.createElement('div');
    empty.className = 'memo-empty';
    empty.innerHTML = tr('memo.empty');
    memoList.append(empty);
  }

  const groups = Object.fromEntries(GROUPS.map((k) => [k, []]));
  for (const m of active) groups[m.due ? D.status(m.due) : 'none'].push(m);
  const dated = active.some((m) => m.due); // 都没有日期时不显示分组标题
  for (const key of GROUPS) {
    const list = groups[key];
    if (!list.length) continue;
    if (dated) {
      const h = document.createElement('div');
      h.className = `memo-group ${key}`;
      h.textContent = `${tr(`group.${key}`)} ${list.length}`;
      memoList.append(h);
    }
    for (const m of list) memoList.append(memoItem(m, key));
  }

  // 已完成的放在最下面，默认折叠，最近完成的在前
  if (done.length) {
    const head = document.createElement('button');
    head.className = 'done-head' + (showDone ? ' open' : '');
    head.innerHTML = CHEVRON_SVG;
    head.append(tr('memo.doneHead', done.length));
    head.addEventListener('click', () => {
      showDone = !showDone;
      try { localStorage.setItem('memo.showDone', showDone ? '1' : '0'); } catch { /* 忽略 */ }
      renderMemos();
    });
    memoList.append(head);
    if (showDone) for (const m of done) memoList.append(memoItem(m));
  }

  const reveal = memoReveal && memoList.querySelector(`.memo-item[data-memo="${memoReveal}"]`);
  if (reveal) reveal.scrollIntoView({ block: 'nearest' });
  else memoList.scrollTop = memoTop ? 0 : scrollTop;
  memoReveal = null;
  memoTop = false;
  if (focusedId) memoList.querySelector(`.memo-item[data-memo="${focusedId}"]`)?.focus();
}

function memoItem(m, group) {
  const el = document.createElement('div');
  el.className = 'memo-item' + (m.done ? ' done' : '') + (flashUntil.get(m.id) > Date.now() ? ' flash' : '');
  el.dataset.memo = m.id;
  el.tabIndex = 0;
  el.setAttribute('role', 'checkbox');
  el.setAttribute('aria-checked', String(m.done));
  el.title = [
    m.due && tr('tip.due', D.full(m.due)),
    tr('tip.created', D.timestamp(m.createdAt)),
    m.done && tr('tip.completed', D.timestamp(m.doneAt)),
  ].filter(Boolean).join('\n');

  const check = document.createElement('span');
  check.className = 'check';
  check.innerHTML = CHECK_SVG;
  const text = document.createElement('span');
  text.className = 'memo-text';
  text.textContent = m.text;
  el.append(check, text);
  if (m.done) {
    const meta = document.createElement('span');
    meta.className = 'memo-meta';
    meta.textContent = D.stampLabel(m.doneAt);
    el.append(meta);
  } else if (m.due) {
    // 分组标题已经写了今天/明天，这两组只显示时间
    const label = group === 'today' || group === 'tomorrow' ? m.due.time : D.label(m.due);
    if (label) {
      const tag = document.createElement('span');
      tag.className = `memo-due ${group}`;
      tag.textContent = label;
      el.append(tag);
    }
  }

  el.addEventListener('click', () => toggleMemo(m, el));
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    api.menu({ type: 'memo', id: m.id });
  });
  return el;
}

function toggleMemo(m, el) {
  if (editing || el.classList.contains('checking')) return;
  const done = !m.done;
  const commit = () => {
    const cur = state.memos.find((x) => x.id === m.id); // 等待期间状态可能已刷新
    if (!cur) return;
    cur.done = done;
    cur.doneAt = done ? Date.now() : null;
    renderMemos();
    api.memoUpdate(m.id, { done });
  };
  if (!done) { commit(); return; }
  // 先打勾划线，停一下再收进「已完成」
  el.classList.add('checking');
  setTimeout(commit, 320);
}

function removeMemo(id) {
  state.memos = state.memos.filter((m) => m.id !== id);
  renderMemos();
  api.memoRemove(id);
}

function setMemoDue(id, due) {
  const m = state?.memos.find((x) => x.id === id);
  if (!m) return;
  m.due = due;
  flash([id]);
  memoReveal = id;
  renderMemos();
  api.memoUpdate(id, { due });
}

// ---- 输入框上方的日期行：快捷日期，或识别 / 选好的日期 ----
const dueRow = document.getElementById('due-row');
let draftDue = null;      // 用快捷按钮或日历手动选的日期，优先于文字识别
let ignoreParse = false;  // 点了 × 关掉这次的自动识别
const draftParse = () => (draftDue || ignoreParse ? null : D.parse(memoInput.value));
const QUICK = ['today', 'tomorrow', 'weekend', 'nextweek'];

function chip(className, content, title, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.title = title;
  if (content.startsWith('<svg')) b.innerHTML = content; else b.textContent = content;
  b.addEventListener('mousedown', (e) => e.preventDefault()); // 不抢输入框的焦点
  b.addEventListener('click', onClick);
  return b;
}

function pickDraft(due) {
  openDuePicker(due, tr('due.newMemo'), (d) => {
    draftDue = d;
    ignoreParse = !d;
    renderDueRow();
    memoInput.focus();
  });
}

function renderDueRow() {
  const parsed = draftParse();
  const due = draftDue || parsed?.due;
  dueRow.replaceChildren();
  if (due) {
    const tip = [D.full(due), due.time && tr('pill.willRemind'), parsed && tr('pill.parsed'), tr('pill.clickToEdit')]
      .filter(Boolean).join('\n');
    const pill = chip(`due-pill ${D.status(due)}${parsed ? ' parsed' : ''}`, CAL_SVG, tip, () => pickDraft(due));
    pill.append(D.label(due));
    const x = chip('due-x', X_SVG, parsed ? tr('pill.ignore') : tr('pill.clear'), () => {
      if (draftDue) draftDue = null; else ignoreParse = true;
      renderDueRow();
    });
    dueRow.append(pill, x);
  } else {
    for (const key of QUICK) {
      dueRow.append(chip('due-chip', tr(`quick.${key}`), D.full(D.quick(key)), () => { draftDue = D.quick(key); renderDueRow(); }));
    }
    dueRow.append(chip('due-chip icon', CAL_SVG, tr('pill.pick'), () => pickDraft(null)));
  }
}

document.getElementById('memo-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const raw = cleanText(memoInput.value);
  if (!raw || !state) return;
  const parsed = draftParse();
  const due = draftDue || parsed?.due || null;
  const memo = {
    id: Math.random().toString(36).slice(2, 10),
    text: parsed ? parsed.text : raw,
    done: false,
    createdAt: Date.now(),
    doneAt: null,
    due,
  };
  state.memos.push(memo); // 先本地显示，再交给主进程保存
  memoInput.value = '';
  draftDue = null;
  ignoreParse = false;
  renderDueRow();
  syncInputHold();
  memoReveal = memo.id;
  flash([memo.id]);
  renderMemos();
  api.memoAdd(memo);
});

// 输入框里有字时保持面板展开，避免打字途中鼠标移开就收起；清空或失焦后恢复自动隐藏
function syncInputHold() {
  setHold('input', document.hasFocus() && document.activeElement === memoInput && memoInput.value !== '');
}
for (const ev of ['focus', 'blur', 'input']) memoInput.addEventListener(ev, syncInputHold);
memoInput.addEventListener('input', () => {
  if (!memoInput.value) ignoreParse = false;
  renderDueRow();
});
memoInput.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Escape') {
    if (memoInput.value) {
      memoInput.value = '';
      ignoreParse = false;
      renderDueRow();
      syncInputHold();
    } else {
      memoInput.blur();
      api.hide();
    }
  } else if (e.key === 'ArrowUp' && !memoInput.value) {
    e.preventDefault();
    [...memoList.querySelectorAll('.memo-item')].pop()?.focus();
  }
});

function inputMenu(e) {
  e.preventDefault();
  e.stopPropagation();
  api.menu({ type: 'input' });
}
memoInput.addEventListener('contextmenu', inputMenu);

// ---- 日历：选日期，可选提醒时间（滚轮选时分，下方是常用时间） ----
const duePicker = document.getElementById('due-picker');
const calGrid = document.getElementById('cal-grid');
const dueWheel = document.getElementById('due-wheel');
const TIMES = ['08:00', '09:00', '12:00', '15:00', '18:00', '20:00', '22:00'];
const DEFAULT_TIME = '09:00'; // 还没设时间时滚轮停在这里（变淡显示）
const ROW = 30;               // 滚轮每行高度，和样式里的 .wheel-item 一致
let pick = null; // { date, time, month, onDone }

const pad2 = (n) => String(n).padStart(2, '0');

// 一列滚轮：鼠标滚轮一格走一项，可拖动、点击、方向键；中间一行是选中值
function makeWheel(el, count, onChange) {
  let idx = 0;
  for (let i = 0; i < count; i++) {
    const item = document.createElement('div');
    item.className = 'wheel-item';
    item.textContent = pad2(i);
    el.append(item);
  }
  const mark = () => {
    for (const [i, item] of [...el.children].entries()) item.classList.toggle('on', i === idx);
  };
  const set = (i, { smooth = true, fire = true } = {}) => {
    idx = Math.min(count - 1, Math.max(0, i));
    el.scrollTo({ top: idx * ROW, behavior: smooth ? 'smooth' : 'auto' });
    mark();
    if (fire) onChange();
  };

  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.deltaY) set(idx + Math.sign(e.deltaY));
  }, { passive: false });
  el.addEventListener('keydown', (e) => {
    const step = { ArrowUp: -1, ArrowDown: 1, PageUp: -5, PageDown: 5 }[e.key];
    if (step) { e.preventDefault(); set(idx + step); }
    if (e.key === 'Enter') confirmPick();
  });

  let drag = null;
  el.addEventListener('pointerdown', (e) => {
    drag = { y: e.clientY, top: el.scrollTop, moved: false };
    el.setPointerCapture(e.pointerId);
    el.focus();
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dy = e.clientY - drag.y;
    if (Math.abs(dy) > 3) drag.moved = true;
    if (drag.moved) el.scrollTop = drag.top - dy;
  });
  el.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const { moved } = drag;
    drag = null;
    if (moved) { set(Math.round(el.scrollTop / ROW)); return; }
    // 没拖动就是点击：选中点到的那一项
    const hit = document.elementsFromPoint(e.clientX, e.clientY).find((n) => n.parentElement === el);
    if (hit) set([...el.children].indexOf(hit));
  });
  el.addEventListener('pointercancel', () => { drag = null; set(idx, { fire: false }); });

  return {
    get value() { return idx; },
    show: (i, smooth) => set(i, { smooth, fire: false }),
  };
}

const wheelH = makeWheel(document.getElementById('wheel-h'), 24, onWheel);
const wheelM = makeWheel(document.getElementById('wheel-m'), 60, onWheel);

function onWheel() {
  pick.time = `${pad2(wheelH.value)}:${pad2(wheelM.value)}`;
  renderTime();
}

// 双击滚轮直接输入时间：支持 9:30、930、0930、21、9点半、9点15
const wheelInput = document.getElementById('wheel-input');

function parseTyped(s) {
  let v = s.replace(/\s+/g, '').toLowerCase();
  const ap = v.match(/(am|pm|a\.m\.|p\.m\.)$/);
  if (ap) v = v.slice(0, -ap[0].length);
  let m = v.match(/^(\d{1,2})(?:[:：.点](\d{1,2}|半)?分?)?$/);
  let h, min;
  if (m) {
    h = +m[1];
    min = m[2] === '半' ? 30 : +(m[2] || 0);
  } else if ((m = v.match(/^(\d{3,4})$/))) {
    h = +m[1].slice(0, -2);
    min = +m[1].slice(-2);
  } else {
    return null;
  }
  if (ap) {
    if (h < 1 || h > 12) return null;
    if (ap[0].startsWith('p') && h < 12) h += 12;
    if (ap[0].startsWith('a') && h === 12) h = 0;
  }
  return h <= 23 && min <= 59 ? `${pad2(h)}:${pad2(min)}` : null;
}

function finishTyping(save) {
  if (wheelInput.hidden) return;
  if (save && wheelInput.value.trim()) {
    const t = parseTyped(wheelInput.value);
    if (!t) {
      wheelInput.classList.add('invalid');
      wheelInput.select();
      return;
    }
    pick.time = t;
    showTimeOnWheel(true);
    renderTime();
  }
  wheelInput.hidden = true;
  document.getElementById('wheel-h').focus();
}

dueWheel.addEventListener('dblclick', () => {
  if (!pick || !wheelInput.hidden) return;
  wheelInput.value = pick.time || '';
  wheelInput.classList.remove('invalid');
  wheelInput.hidden = false;
  wheelInput.focus();
  wheelInput.select();
});
wheelInput.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') finishTyping(true);
  if (e.key === 'Escape') finishTyping(false);
});
wheelInput.addEventListener('input', () => wheelInput.classList.remove('invalid'));
// 点到别处：能识别就保存，识别不了就放弃
wheelInput.addEventListener('blur', () => {
  if (wheelInput.hidden) return;
  const t = parseTyped(wheelInput.value);
  if (t) finishTyping(true); else wheelInput.hidden = true;
});
wheelInput.addEventListener('pointerdown', (e) => e.stopPropagation());
wheelInput.addEventListener('contextmenu', inputMenu);

function showTimeOnWheel(smooth) {
  const [h, m] = (pick.time || DEFAULT_TIME).split(':').map(Number);
  wheelH.show(h, smooth);
  wheelM.show(m, smooth);
}

function openDuePicker(due, title, onDone) {
  const base = due ? D.toDate(due.date) : D.startOfToday();
  pick = { date: due?.date || null, time: due?.time || null, month: new Date(base.getFullYear(), base.getMonth(), 1), onDone };
  document.getElementById('due-head').title = tr('due.headTitle', title);
  setHold('due', true);
  duePicker.hidden = false;
  renderCal();
  renderTime();
  showTimeOnWheel(false); // 必须在显示之后，隐藏状态下滚动无效
  setTimeout(() => calGrid.querySelector('.selected, .today')?.focus(), 30);
}

function closeDuePicker() {
  if (duePicker.hidden) return;
  wheelInput.hidden = true;
  duePicker.hidden = true;
  pick = null;
  setHold('due', false);
}

function renderCal() {
  const { month } = pick;
  const today = D.ymd(D.startOfToday());
  document.getElementById('cal-month').textContent = D.monthTitle(month);
  const lead = D.mondayIdx(month);
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const start = D.addDays(month, -lead);
  calGrid.replaceChildren();
  for (let i = 0; i < Math.ceil((lead + days) / 7) * 7; i++) {
    const d = D.addDays(start, i);
    const key = D.ymd(d);
    const b = document.createElement('button');
    b.className = 'cal-day'
      + (d.getMonth() !== month.getMonth() ? ' other' : '')
      + (key < today ? ' past' : '')
      + (key === today ? ' today' : '')
      + (key === pick.date ? ' selected' : '');
    b.textContent = d.getDate();
    b.title = D.full({ date: key, time: null });
    b.addEventListener('click', () => {
      pick.date = key;
      if (d.getMonth() !== month.getMonth()) pick.month = new Date(d.getFullYear(), d.getMonth(), 1);
      renderCal();
      renderTime();
      calGrid.querySelector('.selected')?.focus();
    });
    b.addEventListener('dblclick', confirmPick);
    calGrid.append(b);
  }
}

function renderTime() {
  // 滚轮上方显示当前选中的完整日期
  const dateEl = document.getElementById('due-date');
  dateEl.textContent = pick.date ? D.long(pick.date) : tr('due.noDate');
  dateEl.classList.toggle('empty', !pick.date);
  dueWheel.classList.toggle('unset', !pick.time);
  const chip = (label, selected, onPick, title = '') => {
    const b = document.createElement('button');
    b.className = 'time-chip' + (selected ? ' selected' : '');
    b.textContent = label;
    b.title = title;
    b.addEventListener('click', () => {
      onPick();
      showTimeOnWheel(true);
      renderTime();
    });
    return b;
  };
  const setTime = (t) => () => { pick.time = t; };
  // 「现在」：滚轮跳到当前时刻，方便在此基础上微调；没选日期时顺便选上今天
  const setNow = () => {
    const d = new Date();
    pick.time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    if (!pick.date) {
      pick.date = D.ymd(D.startOfToday());
      pick.month = new Date(d.getFullYear(), d.getMonth(), 1);
      renderCal();
    }
  };
  document.getElementById('due-times').replaceChildren(
    chip(tr('time.none'), !pick.time, setTime(null)),
    chip(tr('time.now'), false, setNow, tr('time.nowTip')),
    ...TIMES.map((t) => chip(t, pick.time === t, setTime(t))),
  );
  const { time } = pick;
  document.getElementById('due-hint').textContent = pick.date
    ? tr('due.hint', D.label({ date: pick.date, time }), !!time)
    : (time ? tr('due.hintTimeOnly', time) : '');
}

function confirmPick() {
  if (!pick) return;
  const { time } = pick;
  let date = pick.date;
  if (!date && time) {
    // 只选了时间：还没到就是今天，过了就是明天
    const [h, m] = time.split(':').map(Number);
    const t = D.startOfToday();
    t.setHours(h, m);
    date = D.ymd(t > new Date() ? D.startOfToday() : D.addDays(D.startOfToday(), 1));
  }
  const done = pick.onDone;
  closeDuePicker();
  done(date ? { date, time } : null);
}

document.getElementById('cal-prev').addEventListener('click', () => {
  pick.month = new Date(pick.month.getFullYear(), pick.month.getMonth() - 1, 1);
  renderCal();
});
document.getElementById('cal-next').addEventListener('click', () => {
  pick.month = new Date(pick.month.getFullYear(), pick.month.getMonth() + 1, 1);
  renderCal();
});
document.getElementById('due-ok').addEventListener('click', confirmPick);
document.getElementById('due-clear').addEventListener('click', () => {
  const done = pick.onDone;
  closeDuePicker();
  done(null);
});
document.getElementById('due-close').addEventListener('click', closeDuePicker);
duePicker.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); });

// 右键菜单里的「日期」子菜单
api.onMemoDate((id, key) => {
  const m = state?.memos.find((x) => x.id === id);
  if (!m) return;
  if (key === 'pick') openDuePicker(m.due, m.text, (due) => setMemoDue(id, due));
  else setMemoDue(id, key === 'clear' ? null : D.quick(key));
});

// ---- 到点提醒：系统通知由主进程发；这里让边缘把手亮起，打开备忘页时高亮对应条目 ----
let alertIds = [];
api.onReminder((ids) => {
  alertIds = ids;
  body.classList.add('alerting');
  revealAlerts();
});

function revealAlerts() {
  if (!alertIds.length || body.classList.contains('collapsed') || body.dataset.view !== 'memo') return;
  const ids = alertIds;
  alertIds = [];
  body.classList.remove('alerting');
  flash(ids, 2600);
  memoReveal = ids[0];
  renderMemos();
}

// 跨过整点、跨天后「今天 / 已过期」要跟着变
setInterval(() => {
  if (!state || editing || body.dataset.view !== 'memo') return;
  renderMemos();
  renderDueRow();
}, 30000);

function beginMemoEdit(id) {
  const el = memoList.querySelector(`.memo-item[data-memo="${id}"]`);
  const m = state?.memos.find((x) => x.id === id);
  if (!el || !m || editing) return;
  editing = `memo:${id}`;
  setHold('memo-edit', true);

  const input = document.createElement('input');
  input.className = 'memo-edit';
  input.value = m.text;
  input.maxLength = 500;
  input.spellcheck = false;
  el.querySelector('.memo-text').replaceWith(input);

  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    const value = cleanText(input.value);
    editing = null;
    setHold('memo-edit', false);
    if (save && value && value !== m.text) {
      // 编辑时写了新的日期，同样识别出来
      const parsed = D.parse(value);
      m.text = parsed ? parsed.text : value;
      if (parsed) m.due = parsed.due;
      api.memoUpdate(id, parsed ? { text: m.text, due: m.due } : { text: m.text });
    }
    const next = pendingState || state;
    pendingState = null;
    render(next);
    memoList.querySelector(`.memo-item[data-memo="${id}"]`)?.focus();
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('contextmenu', inputMenu);
  setTimeout(() => { input.focus(); input.select(); }, 30);
}

api.onBeginMemoEdit(beginMemoEdit);

// 备忘页键盘：↑↓ 移动，Enter / 空格 完成，F2 编辑，Delete 删除
function memoKeydown(e) {
  const cur = document.activeElement?.closest?.('.memo-item');
  const items = [...memoList.querySelectorAll('.memo-item')];
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault();
    if (!cur) { items.pop()?.focus(); return; }
    const i = items.indexOf(cur) + (e.key === 'ArrowUp' ? -1 : 1);
    if (i >= items.length) memoInput.focus(); else items[Math.max(0, i)].focus();
    return;
  }
  if (!cur) return;
  const m = state.memos.find((x) => x.id === cur.dataset.memo);
  if (!m) return;
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    toggleMemo(m, cur);
  } else if (e.key === 'F2') {
    beginMemoEdit(m.id);
  } else if (e.key === 'Delete') {
    const i = items.indexOf(cur);
    const nextId = (items[i + 1] || items[i - 1])?.dataset.memo;
    removeMemo(m.id);
    (nextId && memoList.querySelector(`.memo-item[data-memo="${nextId}"]`) || memoInput).focus();
  }
}

// ---- 键盘：Esc 收起，方向键移动，Enter 打开，F2 重命名 ----
document.addEventListener('keydown', (e) => {
  if (!duePicker.hidden) {
    if (e.key === 'Escape') closeDuePicker();
    return;
  }
  if (e.key === 'Escape') {
    if (!picker.hidden) closePicker(); else api.hide();
    return;
  }
  if (!picker.hidden) return;
  if (body.dataset.view === 'memo') { memoKeydown(e); return; }
  if (e.key === 'F2' && document.activeElement?.dataset?.id) {
    beginRename(document.activeElement.dataset.id);
    return;
  }
  const tiles = [...grid.querySelectorAll('.tile')];
  if (!tiles.length || !state) return;
  const cols = state.layout.cols;
  const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[e.key];
  if (step === undefined) return;
  e.preventDefault();
  const cur = tiles.indexOf(document.activeElement);
  const next = cur < 0 ? 0 : Math.min(tiles.length - 1, Math.max(0, cur + step));
  tiles[next].focus();
});

let toastTimer = null;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
}

api.onState(render);
api.onToast(showToast);
api.onExpanded(({ expanded, focus }) => {
  body.classList.toggle('collapsed', !expanded);
  if (!expanded) {
    closePicker();
    closeDuePicker();
    document.activeElement?.blur();
    body.classList.remove('dropping');
    return;
  }
  if (focus) {
    if (body.dataset.view === 'memo') memoInput.focus(); // 快捷键呼出时直接开始记
    else grid.querySelector('.tile')?.focus();
  }
  revealAlerts();
});

api.getState().then((s) => {
  render(s);
  renderDueRow();
  body.classList.toggle('collapsed', !s.expanded);
});
