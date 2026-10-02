const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  libList: () => ipcRenderer.invoke('lib-list'),
  libOpen: (id) => ipcRenderer.invoke('lib-open', id),
  libRemove: (id) => ipcRenderer.invoke('lib-remove', id),
  libProgress: (id, page, pages) => ipcRenderer.invoke('lib-progress', id, page, pages),
  addPath: (p) => ipcRenderer.invoke('add-path', p),
  addBuffer: (name, buf) => ipcRenderer.invoke('add-buffer', name, buf),
  openDialog: () => ipcRenderer.invoke('open-dialog'),
  pathForFile: (file) => webUtils.getPathForFile(file),
  hookGet: () => ipcRenderer.invoke('hook-get'),
  hookSet: (v) => ipcRenderer.invoke('hook-set', v),
  onMenuOpen: (cb) => ipcRenderer.on('menu-open', cb),
  onMenuLibrary: (cb) => ipcRenderer.on('menu-library', cb),
  onOpenPath: (cb) => ipcRenderer.on('open-path', (_e, p) => cb(p)),
});
