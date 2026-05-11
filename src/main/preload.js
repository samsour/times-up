import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  store: {
    get: (key) => ipcRenderer.invoke('store:get', key),
    set: (key, value) => ipcRenderer.invoke('store:set', key, value),
    delete: (key) => ipcRenderer.invoke('store:delete', key)
  },
  clickup: {
    request: (opts) => ipcRenderer.invoke('clickup:request', opts)
  },
  window: {
    hide: () => ipcRenderer.invoke('window:hide')
  },
  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url)
  },
  app: {
    getLoginItemSettings: () => ipcRenderer.invoke('app:getLoginItemSettings'),
    setLoginItemSettings: (openAtLogin) => ipcRenderer.invoke('app:setLoginItemSettings', openAtLogin)
  },
  idle: {
    onDetected: (cb) => {
      const handler = (_, seconds) => cb(seconds)
      ipcRenderer.on('idle:detected', handler)
      return () => ipcRenderer.removeListener('idle:detected', handler)
    },
    dismiss: () => ipcRenderer.invoke('idle:dismiss')
  }
})
