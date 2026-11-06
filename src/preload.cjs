'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('windowUse', Object.freeze({
  snapshot: () => ipcRenderer.invoke('window-use:snapshot'),
  command: (action, payload = {}) => ipcRenderer.invoke('window-use:command', { action, payload }),
  subscribe: callback => {
    const listener = (_event, snapshot) => callback(snapshot);
    ipcRenderer.on('window-use:changed', listener);
    return () => ipcRenderer.removeListener('window-use:changed', listener);
  }
}));
