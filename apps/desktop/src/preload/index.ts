import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { StanleyApi } from '../shared/ipc'

function on<T>(channel: string, cb: (value: T) => void) {
  const listener = (_: IpcRendererEvent, value: T) => cb(value)
  ipcRenderer.on(channel, listener)
  return () => void ipcRenderer.off(channel, listener)
}

const api: StanleyApi = {
  onSnapshot: (cb) => on('snapshot', cb),
  onListening: (cb) => on('listening', cb),
  audio: (chunk) => ipcRenderer.send('audio', chunk),
  onSpeech: (cb) => on('speech:audio', cb),
  onSpeechStop: (cb) => on('speech:stop', cb),
  onSpeechVolume: (cb) => on('speech:volume', cb),
  speechStarted: (reply, seq) => ipcRenderer.send('speech:started', reply, seq),
  speechEnded: (reply, seq) => ipcRenderer.send('speech:ended', reply, seq),
  toggleListening: () => ipcRenderer.send('toggle-listening'),
  lock: () => ipcRenderer.send('lock'),
  unlock: () => ipcRenderer.send('unlock'),
  perform: (appId, nodeId, args) => ipcRenderer.send('perform', appId, nodeId, args),
  open: (appId) => ipcRenderer.send('open', appId),
  say: (text) => ipcRenderer.send('say', text),
  debug: {
    onEvent: (cb) => on('debug:event', cb),
    history: () => ipcRenderer.invoke('debug:history'),
    sessions: () => ipcRenderer.invoke('debug:sessions'),
    load: (file) => ipcRenderer.invoke('debug:load', file),
    replay: (req) => ipcRenderer.invoke('debug:replay', req),
    copy: (text) => ipcRenderer.send('debug:copy', text),
  },
}

contextBridge.exposeInMainWorld('stanley', api)
