import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { Agent, createEscalator, createTextGen, defaultConfig, SYSTEM_PROMPT, type AgentStatus, type Escalator, type TextGen } from '@stanley/agent'
import { createJevClient, createMockJevClient } from '@stanley/jev'
import { Transcriber } from '@stanley/stt'
import { app, BrowserWindow, clipboard, globalShortcut, ipcMain, Menu, session } from 'electron'
import type { AppDebugEvent, ReplayRequest, Snapshot } from '../shared/ipc'
import { apps } from './apps'
import { DebugRecorder } from './debug'
import { Shell } from './shell'

app.setName('Stanley')

const root = join(import.meta.dirname, '../../../..')
const envFile = join(root, '.env')
if (existsSync(envFile)) process.loadEnvFile(envFile)

const mock = !process.env.AI_GATEWAY_API_KEY
const PTT_SHORTCUTS = [process.env.STANLEY_PTT, 'Alt+Space', 'CommandOrControl+Shift+Space'].filter(Boolean) as string[]
let ptt: string | null = null

let win: BrowserWindow | null = null
let debugWin: BrowserWindow | null = null
let listening = false
/** The transcriber is fed between a start and a stop transition; audio arriving before the start runs is held. */
let accepting = false
const held: Float32Array[] = []
/** The mic stays on across pauses: silence ends the utterance, and the next words start a new one. */
let utteranceOpen = false
/** The VAD hears speech right now. */
let speaking = false
/** Start/stop transitions run in order, so a quick re-press waits for the previous flush instead of interleaving with it. */
let transitions = Promise.resolve()
let status: AgentStatus = 'idle'
/** What Stanley last said, until the user has answered it. */
let said: Snapshot['said'] = null
let utteranceStartedAt = 0
let stt: Snapshot['stt'] = 'loading'
let transcriber: Transcriber | null = null
const transcript = { finalized: [] as string[], partial: '' }

const shell = new Shell(apps, { env: process.env, fetch }, () => sendSnapshot())

const textGen: TextGen = mock
  ? { fill: async ({ context }) => context.split('\n').filter((l) => l.startsWith('User:')).at(-1)?.slice(6) ?? '' }
  : createTextGen()

const escalator: Escalator = mock ? { run: async () => ({ text: "I'm offline, so I can't help with that one." }) } : createEscalator()

const sessionsDir = join(app.getPath('userData'), 'sessions')
mkdirSync(sessionsDir, { recursive: true })
const sessionName = new Date().toISOString().replace(/[:.]/g, '-')
const sessionFile = join(sessionsDir, `${sessionName}.jsonl`)

const debug = new DebugRecorder(sessionsDir, sessionName, (e) => debugWin?.webContents.send('debug:event', e))
const appEvent = (event: AppDebugEvent) => debug.record({ source: 'app', event })
appEvent({ type: 'session-start', session: sessionName, config: defaultConfig, systemPrompt: SYSTEM_PROMPT, mock })

const jev = mock ? createMockJevClient() : createJevClient()
const agent = new Agent({
  world: shell,
  jev,
  textGen,
  escalator,
  events: {
    status: (s) => {
      status = s
      appEvent({ type: 'status', status: s })
      sendSnapshot()
    },
    said: (text) => {
      said = { text, at: Date.now() }
      sendSnapshot()
    },
    debug: (event) => debug.record({ source: 'agent', event }),
  },
  config: defaultConfig,
  sink: (entry) => {
    appendFileSync(sessionFile, JSON.stringify(entry) + '\n')
    debug.record({ source: 'log', event: entry })
  },
})

function sendSnapshot() {
  const snapshot: Snapshot = {
    layout: shell.layout,
    surfaces: Object.fromEntries(shell.surfaces),
    focus: shell.focus,
    apps: apps.map(({ id, title, description }) => ({ id, title, description })),
    listening,
    speaking,
    utteranceOpen,
    transcript,
    status,
    said,
    stt,
    mock,
    ptt,
  }
  broadcast('snapshot', snapshot)
}

function broadcast(channel: string, payload: unknown) {
  for (const w of [win, debugWin]) w?.webContents.send(channel, payload)
}

type Via = Extract<AppDebugEvent, { type: 'listening' }>['via']

function transition(step: () => void | Promise<void>) {
  transitions = transitions.then(step).catch((err) => console.error('Listening transition failed', err))
}

function startListening(via: Via) {
  if (listening) return
  listening = true
  appEvent({ type: 'listening', on: true, via })
  win?.webContents.send('listening', true)
  sendSnapshot()
  transition(() => {
    transcriber?.reset()
    beginUtterance()
    accepting = true
    for (const chunk of held.splice(0)) transcriber?.accept(chunk)
    sendSnapshot()
  })
}

function stopListening(via: Via) {
  if (!listening) return
  listening = false
  appEvent({ type: 'listening', on: false, via })
  win?.webContents.send('listening', false)
  sendSnapshot()
  transition(async () => {
    accepting = false
    await transcriber?.flush()
    endUtterance()
    sendSnapshot()
  })
}

function beginUtterance() {
  transcript.finalized = []
  transcript.partial = ''
  utteranceStartedAt = Date.now()
  agent.utteranceStart()
  utteranceOpen = true
}

function endUtterance() {
  transcript.partial = ''
  if (!utteranceOpen) return
  utteranceOpen = false
  // Keep what Stanley said on screen while the user answers it; clear it once they have.
  if (said && said.at < utteranceStartedAt) said = null
  agent.utteranceEnd()
  sendSnapshot()
}

function toggleListening(via: Via) {
  if (listening) stopListening(via)
  else startListening(via)
}

function setStt(state: Snapshot['stt'], error?: string) {
  stt = state
  appEvent({ type: 'stt-state', stt: state, error })
  sendSnapshot()
}

async function loadStt() {
  const modelsDir = join(root, 'models')
  if (!existsSync(join(modelsDir, 'silero_vad.onnx'))) return setStt('missing-models')
  try {
    transcriber = await Transcriber.create(
      { modelsDir },
      {
        partial: (text) => {
          if (!utteranceOpen) beginUtterance()
          transcript.partial = text
          agent.partial(text)
          sendSnapshot()
        },
        segment: (text) => {
          if (!utteranceOpen) beginUtterance()
          transcript.finalized.push(text)
          transcript.partial = ''
          agent.segment(text)
          sendSnapshot()
        },
        speaking: (on) => {
          speaking = on
          sendSnapshot()
        },
        silence: () =>
          transition(() => {
            endUtterance()
            sendSnapshot()
          }),
        debug: (event) => debug.record({ source: 'stt', event }),
      },
    )
    setStt('ready')
  } catch (err) {
    console.error('STT failed to load', err)
    setStt('error', String(err))
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    title: 'Stanley',
    backgroundColor: '#0a0a0b',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      sandbox: false,
      webviewTag: true,
    },
  })
  win.webContents.on('did-finish-load', sendSnapshot)
  win.on('closed', () => {
    win = null
    debugWin?.close()
  })
  loadRenderer(win)
}

function openDebugWindow() {
  if (debugWin) return debugWin.focus()
  debugWin = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'Stanley Debug',
    backgroundColor: '#0f1115',
    webPreferences: { preload: join(import.meta.dirname, '../preload/index.mjs'), sandbox: false },
  })
  debugWin.webContents.on('did-finish-load', sendSnapshot)
  debugWin.on('closed', () => (debugWin = null))
  loadRenderer(debugWin, 'debug')
}

function loadRenderer(w: BrowserWindow, hash?: string) {
  if (process.env.ELECTRON_RENDERER_URL) void w.loadURL(process.env.ELECTRON_RENDERER_URL + (hash ? `#${hash}` : ''))
  else void w.loadFile(join(import.meta.dirname, '../renderer/index.html'), { hash })
}

function setMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'fileMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      {
        label: 'Debug',
        submenu: [{ label: 'Open Debug Window', accelerator: 'CommandOrControl+Shift+D', click: openDebugWindow }],
      },
      { role: 'windowMenu' },
    ]),
  )
}

ipcMain.on('audio', (_, chunk: Float32Array) => {
  if (!listening) return
  if (accepting) transcriber?.accept(chunk)
  else held.push(chunk)
})
ipcMain.on('toggle-listening', () => toggleListening('button'))
ipcMain.on('open', async (_, appId: string | null) => {
  const result = await shell.open(appId)
  await shell.global('show')
  const option = appId ? `open ${appId}` : 'home'
  appEvent({ type: 'manual', option, summary: result.summary })
  agent.recordManual(option, appId ?? 'home', result)
})
ipcMain.on('perform', async (_, appId: string, nodeId: string, args) => {
  const result = await shell.performIn(appId, nodeId, args ?? {})
  appEvent({ type: 'manual', option: `${appId} › ${nodeId}`, summary: result.summary })
  agent.recordManual(`${appId} › ${nodeId}`, `${appId}:${nodeId}`, result, args)
})
ipcMain.on('say', (_, text: string) => {
  appEvent({ type: 'typed', text })
  // With the mic on, typed text is its own utterance and the mic stays on.
  if (listening) {
    return transition(() => {
      endUtterance()
      beginUtterance()
      transcript.finalized.push(text)
      agent.segment(text)
      endUtterance()
      sendSnapshot()
    })
  }
  startListening('typed')
  transition(() => {
    transcript.finalized.push(text)
    agent.segment(text)
  })
  stopListening('typed')
})

ipcMain.handle('debug:history', () => debug.events)
ipcMain.handle('debug:sessions', () => debug.sessions())
ipcMain.handle('debug:load', (_, file: string) => debug.load(file))
ipcMain.handle('debug:replay', (_, req: ReplayRequest) => jev.choose(req))
ipcMain.on('debug:copy', (_, text: string) => clipboard.writeText(text))

app.whenReady().then(() => {
  // Only our own renderer gets the mic. Pages in the Web app's <webview> share this session and get nothing.
  session.defaultSession.setPermissionRequestHandler((contents, permission, cb, details) => {
    const audioOnly = 'mediaTypes' in details && !!details.mediaTypes?.length && details.mediaTypes.every((t) => t === 'audio')
    cb(contents === win?.webContents && permission === 'media' && audioOnly)
  })
  setMenu()
  createWindow()
  // ⌥Space is often taken (Raycast, ChatGPT); fall back rather than silently failing.
  ptt = PTT_SHORTCUTS.find((key) => globalShortcut.register(key, () => toggleListening('ptt'))) ?? null
  if (!ptt) console.warn('No push-to-talk shortcut could be registered:', PTT_SHORTCUTS.join(', '))
  void loadStt()
})

app.on('will-quit', () => globalShortcut.unregisterAll())
app.on('window-all-closed', () => app.quit())
