import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { Agent, createTextGen, type AgentStatus, type TextGen } from '@stanley/agent'
import { createJevClient, createMockJevClient } from '@stanley/jev'
import { Transcriber } from '@stanley/stt'
import { app, BrowserWindow, globalShortcut, ipcMain, session } from 'electron'
import type { Snapshot } from '../shared/ipc'
import { apps } from './apps'
import { Shell } from './shell'

app.setName('Stanley')

const root = join(import.meta.dirname, '../../../..')
const envFile = join(root, '.env')
if (existsSync(envFile)) process.loadEnvFile(envFile)

const mock = !process.env.AI_GATEWAY_API_KEY
const PTT_SHORTCUTS = [process.env.STANLEY_PTT, 'Alt+Space', 'CommandOrControl+Shift+Space'].filter(Boolean) as string[]
let ptt: string | null = null

let win: BrowserWindow | null = null
let listening = false
let status: AgentStatus = 'idle'
let stt: Snapshot['stt'] = 'loading'
let transcriber: Transcriber | null = null
const transcript = { finalized: [] as string[], partial: '' }

const shell = new Shell(apps, { env: process.env, fetch }, () => sendSnapshot())

const textGen: TextGen = mock
  ? { fill: async ({ context }) => context.split('\n').filter((l) => l.startsWith('User:')).at(-1)?.slice(6) ?? '' }
  : createTextGen()

const sessionsDir = join(app.getPath('userData'), 'sessions')
mkdirSync(sessionsDir, { recursive: true })
const sessionFile = join(sessionsDir, `${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`)

const agent = new Agent(
  shell,
  mock ? createMockJevClient() : createJevClient(),
  textGen,
  {
    tick: (report) => win?.webContents.send('tick', report),
    status: (s) => {
      status = s
      sendSnapshot()
    },
  },
  undefined,
  (entry) => appendFileSync(sessionFile, JSON.stringify(entry) + '\n'),
)

function sendSnapshot() {
  const snapshot: Snapshot = {
    layout: shell.layout,
    surfaces: Object.fromEntries(shell.surfaces),
    focus: shell.focus,
    apps: apps.map(({ id, title, description }) => ({ id, title, description })),
    listening,
    transcript,
    status,
    stt,
    mock,
    ptt,
  }
  win?.webContents.send('snapshot', snapshot)
}

function startListening() {
  if (listening) return
  listening = true
  transcript.finalized = []
  transcript.partial = ''
  transcriber?.reset()
  agent.utteranceStart()
  win?.webContents.send('listening', true)
  sendSnapshot()
}

async function stopListening() {
  if (!listening) return
  listening = false
  win?.webContents.send('listening', false)
  await transcriber?.flush()
  transcript.partial = ''
  agent.utteranceEnd()
  sendSnapshot()
}

function toggleListening() {
  if (listening) void stopListening()
  else startListening()
}

async function loadStt() {
  const modelsDir = join(root, 'models')
  if (!existsSync(join(modelsDir, 'silero_vad.onnx'))) {
    stt = 'missing-models'
    return sendSnapshot()
  }
  try {
    transcriber = await Transcriber.create(
      { modelsDir },
      {
        partial: (text) => {
          transcript.partial = text
          agent.partial(text)
          sendSnapshot()
        },
        segment: (text) => {
          transcript.finalized.push(text)
          transcript.partial = ''
          agent.segment(text)
          sendSnapshot()
        },
        silence: () => void stopListening(),
      },
    )
    stt = 'ready'
  } catch (err) {
    console.error('STT failed to load', err)
    stt = 'error'
  }
  sendSnapshot()
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    title: 'Stanley',
    backgroundColor: '#0f1115',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      sandbox: false,
      webviewTag: true,
    },
  })
  win.webContents.on('did-finish-load', sendSnapshot)
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
}

ipcMain.on('audio', (_, chunk: Float32Array) => {
  if (listening) transcriber?.accept(chunk)
})
ipcMain.on('toggle-listening', toggleListening)
ipcMain.on('open', async (_, appId: string | null) => {
  const result = await shell.open(appId)
  await shell.global('show')
  agent.recordManual(appId ? `open ${appId}` : 'home', appId ?? 'home', result)
})
ipcMain.on('perform', async (_, appId: string, nodeId: string, args) => {
  const result = await shell.performIn(appId, nodeId, args ?? {})
  agent.recordManual(`${appId} › ${nodeId}`, `${appId}:${nodeId}`, result, args)
})
ipcMain.on('say', (_, text: string) => {
  startListening()
  transcript.finalized.push(text)
  agent.segment(text)
  void stopListening()
})

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_, permission, cb) => cb(permission === 'media'))
  createWindow()
  // ⌥Space is often taken (Raycast, ChatGPT); fall back rather than silently failing.
  ptt = PTT_SHORTCUTS.find((key) => globalShortcut.register(key, toggleListening)) ?? null
  if (!ptt) console.warn('No push-to-talk shortcut could be registered:', PTT_SHORTCUTS.join(', '))
  void loadStt()
})

app.on('will-quit', () => globalShortcut.unregisterAll())
app.on('window-all-closed', () => app.quit())
