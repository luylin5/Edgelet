const api = window.edgelet;
const body = document.body;
const panel = document.getElementById('panel');
const handle = document.getElementById('handle');
const grid = document.getElementById('grid');
const toastEl = document.getElementById('toast');

let state = null;
let dragId = null;
let editing = null;       // 正在重命名的条目 id
let pendingState = null;  // 编辑期间收到的新状态，结束后再渲染
const lastLaunch = new Map();

// 显示优先级：预制图标 > 自定义图片 > 系统图标
const iconSrc = (item) => (item.iconPreset && window.EdgeletPresets.url(item.iconPreset)) || item.customIcon || item.icon;

function render(s) {
  if (editing) { pendingState = s; return; }
  state = s;
  const L = s.layout;
  body.dataset.edge = s.edge;
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
  grid.style.height = `${L.rows * L.cell}px`;

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
}

function tileFor(item) {
  const btn = document.createElement('button');
  btn.className = 'tile' + (item.missing ? ' missing' : '');
  btn.dataset.id = item.id;
  btn.draggable = true;
  btn.title = `${item.name}\n${item.path}${item.missing ? '\n（文件已不存在）' : ''}`;

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

const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');

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
  api.hold(true);
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
    api.hold(false);
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
  api.hold(true);
  document.getElementById('picker-title').textContent = `更换图标 · ${item.name}`;
  pickerBody.replaceChildren();

  const choose = (presetId) => () => { api.setIcon(id, presetId); closePicker(); };
  section('当前文件', [
    choiceButton({
      title: '系统图标（默认）',
      src: item.icon,
      selected: !item.iconPreset && !item.customIcon,
      onPick: choose(null),
    }),
    ...(item.customIcon ? [choiceButton({
      title: '自定义图片', src: item.customIcon, selected: !item.iconPreset, onPick: closePicker,
    })] : []),
    choiceButton({
      title: '从图片文件选择…',
      upload: true,
      onPick: () => { closePicker(); api.pickIconFile(id); },
    }),
  ]);
  for (const group of window.EdgeletPresets.groups) {
    section(group.title, group.items.map((p) => choiceButton({
      title: p.name, src: p.url, selected: item.iconPreset === p.id, onPick: choose(p.id),
    })));
  }
  picker.hidden = false;
  pickerBody.scrollTop = 0;
  setTimeout(() => picker.querySelector('.choice.selected, .choice')?.focus(), 30);
}

function closePicker() {
  if (picker.hidden) return;
  picker.hidden = true;
  api.hold(false);
}

document.getElementById('picker-close').addEventListener('click', closePicker);
picker.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); });

api.onBeginRename(beginRename);
api.onOpenIconPicker(openPicker);

// ---- 键盘：Esc 收起，方向键移动，Enter 打开，F2 重命名 ----
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!picker.hidden) closePicker(); else api.hide();
    return;
  }
  if (!picker.hidden) return;
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
    document.activeElement?.blur();
    body.classList.remove('dropping');
  } else if (focus) {
    grid.querySelector('.tile')?.focus();
  }
});

api.getState().then((s) => {
  render(s);
  body.classList.toggle('collapsed', !s.expanded);
});
