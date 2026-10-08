const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('edgelet', {
  getState: () => ipcRenderer.invoke('get-state'),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  onExpanded: (cb) => ipcRenderer.on('expanded', (_e, v) => cb(v)),
  onToast: (cb) => ipcRenderer.on('toast', (_e, msg) => cb(msg)),
  launch: (id) => ipcRenderer.send('launch', id),
  addPaths: (paths) => ipcRenderer.send('add-paths', paths),
  reorder: (ids) => ipcRenderer.send('reorder', ids),
  menu: (ctx) => ipcRenderer.send('menu', ctx),
  hide: () => ipcRenderer.send('hide'),
  rename: (id, name) => ipcRenderer.send('rename', id, name),
  setIcon: (id, presetId) => ipcRenderer.send('set-icon', id, presetId),
  pickIconFile: (id) => ipcRenderer.send('pick-icon-file', id),
  hold: (on) => ipcRenderer.send('hold', on),
  onBeginRename: (cb) => ipcRenderer.on('begin-rename', (_e, id) => cb(id)),
  onOpenIconPicker: (cb) => ipcRenderer.on('open-icon-picker', (_e, id) => cb(id)),
  pathForFile: (file) => webUtils.getPathForFile(file),
});
