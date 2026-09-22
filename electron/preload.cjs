const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('deployxDesktop', {
  isDesktop: true,
  pickDirectory: () => ipcRenderer.invoke('deployx:pick-directory'),
  pickFile: filters => ipcRenderer.invoke('deployx:pick-file', filters),
})
