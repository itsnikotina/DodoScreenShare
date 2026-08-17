const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),
  setActiveCaptureSource: (sourceId) => ipcRenderer.invoke('set-active-capture-source', sourceId),
  ensureAudioIsolation: () => ipcRenderer.invoke('ensure-audio-isolation'),
  checkAppUpdate: () => ipcRenderer.invoke('check-app-update'),
  reloadApp: () => ipcRenderer.invoke('reload-app'),
  onAppUpdated: (callback) => ipcRenderer.on('app-updated', (_event, value) => callback(value)),
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),

  // Captura e streaming nativo de áudio estéreo (parec / pw-record 48kHz L/R)
  startNativeStereoAudio: () => ipcRenderer.invoke('start-native-stereo-audio'),
  stopNativeStereoAudio: () => ipcRenderer.invoke('stop-native-stereo-audio'),
  onNativeAudioChunk: (callback) => ipcRenderer.on('native-audio-chunk', (_event, value) => callback(value))
});
