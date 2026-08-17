const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),
  setActiveCaptureSource: (sourceId) => ipcRenderer.invoke('set-active-capture-source', sourceId),
  ensureAudioIsolation: () => ipcRenderer.invoke('ensure-audio-isolation'),
  checkAppUpdate: () => ipcRenderer.invoke('check-app-update'),
  reloadApp: () => ipcRenderer.invoke('reload-app'),
  onAppUpdated: (callback) => ipcRenderer.on('app-updated', (_event, value) => callback(value)),
  getAppInfo: () => ipcRenderer.invoke('get-app-info')
});
