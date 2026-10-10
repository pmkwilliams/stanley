import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { StanleyApi } from '../shared/ipc'

function on<T>(channel: string, cb: (value: T) => void) {
  const listener = (_: IpcRendererEvent, value: T) => cb(value)
  ipcRenderer.on(channel, listener)
  return () => void ipcRenderer.off(channel, listener)
}

const api: StanleyApi = {
  onSnapshot: (cb) => on('snapshot', cb),
  onTick: (cb) => on('tick', cb),
  onListening: (cb) => on('listening', cb),
  audio: (chunk) => ipcRenderer.send('audio', chunk),
  toggleListening: () => ipcRenderer.send('toggle-listening'),
  perform: (appId, nodeId, args) => ipcRenderer.send('perform', appId, nodeId, args),
  open: (appId) => ipcRenderer.send('open', appId),
  say: (text) => ipcRenderer.send('say', text),
}

contextBridge.exposeInMainWorld('stanley', api)
