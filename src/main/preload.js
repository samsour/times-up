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
  }
})
