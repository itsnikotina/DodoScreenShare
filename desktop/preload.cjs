const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),
  setActiveCaptureSource: (sourceId) => ipcRenderer.invoke('set-active-capture-source', sourceId),
  ensureAudioIsolation: () => ipcRenderer.invoke('ensure-audio-isolation'),
  getAppInfo: () => ipcRenderer.invoke('get-app-info')
});
