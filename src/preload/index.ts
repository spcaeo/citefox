import { createCiteFoxApi, isIpcEventChannel, isIpcInvokeChannel } from '@shared/ipc'
import { contextBridge, ipcRenderer } from 'electron'

if (!process.contextIsolated) {
  throw new Error('CiteFox requires a context-isolated renderer')
}

const api = createCiteFoxApi(
  (channel, ...args) => {
    if (!isIpcInvokeChannel(channel)) {
      return Promise.reject(new Error(`Blocked IPC channel: ${channel}`))
    }
    return ipcRenderer.invoke(channel, ...args)
  },
  (channel, listener) => {
    if (!isIpcEventChannel(channel)) {
      throw new Error(`Blocked IPC channel: ${channel}`)
    }
    const wrapped = (_event: unknown, payload: unknown): void => {
      listener(payload)
    }
    ipcRenderer.on(channel, wrapped)
    return () => {
      ipcRenderer.removeListener(channel, wrapped)
    }
  }
)

contextBridge.exposeInMainWorld('citefox', api)
