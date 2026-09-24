import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  store: {
    get: (key) => ipcRenderer.invoke('store:get', key),
    set: (key, value) => ipcRenderer.invoke('store:set', key, value),
    delete: (key) => ipcRenderer.invoke('store:delete', key),
    onChange: (cb) => {
      const handler = (_, change) => cb(change)
      ipcRenderer.on('store:changed', handler)
      return () => ipcRenderer.removeListener('store:changed', handler)
    }
  },
  clickup: {
    request: (opts) => ipcRenderer.invoke('clickup:request', opts),
    currentTimer: (force) => ipcRenderer.invoke('clickup:currentTimer', { force })
  },
  archive: {
    load: (force) => ipcRenderer.invoke('archive:load', { force }),
    discover: () => ipcRenderer.invoke('archive:discover'),
    createTask: (listId) => ipcRenderer.invoke('archive:createTask', { listId })
  },
  window: {
    hide: () => ipcRenderer.invoke('window:hide'),
    getInfo: () => ipcRenderer.invoke('window:getInfo'),
    openStandalone: (view) => ipcRenderer.invoke('window:openStandalone', view),
    onSetView: (cb) => {
      const handler = (_, view) => cb(view)
      ipcRenderer.on('view:set', handler)
      return () => ipcRenderer.removeListener('view:set', handler)
    }
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
  },
  updater: {
    getState: () => ipcRenderer.invoke('update:getState'),
    check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.invoke('update:install'),
    onStateChange: (cb) => {
      const handler = (_, state) => cb(state)
      ipcRenderer.on('update:stateChange', handler)
      return () => ipcRenderer.removeListener('update:stateChange', handler)
    }
  }
})
