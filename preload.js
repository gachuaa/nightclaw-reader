const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  loadLibrary:     ()      => ipcRenderer.invoke('lib:load'),
  saveLibrary:     lib     => ipcRenderer.invoke('lib:save', lib),
  saveLibrarySync: lib     => ipcRenderer.send('lib:save-sync', lib),
  addBooks:        ()      => ipcRenderer.invoke('books:add'),
  removeBook:      id      => ipcRenderer.invoke('books:remove', id),
  readBook:        id      => ipcRenderer.invoke('books:read', id),
  writeThumb:      (id, d) => ipcRenderer.invoke('thumb:write', id, d)
});
