import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electron', {
  windowControl: (action: 'close' | 'ignore-mouse' | 'capture-mouse' | 'toggle-top', value?: boolean) => ipcRenderer.send('window-control', action, value),
  requestState: () => ipcRenderer.send('request-state'),
  onAppState: (callback: (state: any) => void) => {
    ipcRenderer.removeAllListeners('app-state');
    ipcRenderer.on('app-state', (event: any, state: any) => callback(state));
  }
});
