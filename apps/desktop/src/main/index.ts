import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parallelWeb } from '@stanley/app-web/parallel'
import { Agent, BargeIn, createThinker, defaultConfig, findElement, screenVocabulary, scriptedTurn, SYSTEM_PROMPT, type AgentStatus, type Overheard, type Thinker } from '@stanley/agent'
import { createJevClient, createMockJevClient, type DecisionClient } from '@stanley/jev'
import { SAMPLE_RATE, Transcriber, writeWav } from '@stanley/stt'
import { KOKORO, loadKokoro, Speaker } from '@stanley/tts'
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
let tts: Snapshot['tts'] = 'loading'
/** Stanley's voice, once Kokoro has loaded. */
let speaker: Speaker | null = null
const transcript = { finalized: [] as string[], partial: '' }

/** Debug › Save Utterances as Eval Clips: each spoken utterance is written to evals/speech/clips. */
const clipsDir = join(root, 'evals', 'speech', 'clips')
let saveClips = process.env.STANLEY_SAVE_CLIPS === '1'
/** The last ~1.5 s of audio before an utterance, since the first words arrive after speech began. */
const LEAD_CHUNKS = 15
let lead: Float32Array[] = []
/** Audio of the utterance being recorded, or null when not recording one. */
let clip: Float32Array[] | null = null
let clipCount = 0

const shell = new Shell(apps, { env: process.env, fetch }, () => {
  sendSnapshot()
  void refreshHotwords()
})

/** Speech recognition favours the names and labels on the screen Stanley is working on. */
async function refreshHotwords() {
  if (!transcriber) return
  transcriber.setHotwords(screenVocabulary(await shell.screen(), shell.appList()))
}

/** Offline, thinking types the user's last words and otherwise apologises. */
const thinker: Thinker = mock
  ? {
      run: async ({ single, messages }) => {
        // The user's words are the plain user messages: observations and notes are in tags.
        const words = messages.findLast((m) => m.role === 'user' && typeof m.content === 'string' && !m.content.startsWith('<'))?.content
        if (single?.kind === 'write') return scriptedTurn('', { option: single.option, text: typeof words === 'string' ? words : '', wrote: 'user' })
        return scriptedTurn(single?.kind === 'confirm' ? "I'm offline, so I won't send or delete anything." : "I'm offline, so I can't help with that one.")
      },
    }
  : createThinker()

const sessionsDir = join(app.getPath('userData'), 'sessions')
mkdirSync(sessionsDir, { recursive: true })
const sessionName = new Date().toISOString().replace(/[:.]/g, '-')
const sessionFile = join(sessionsDir, `${sessionName}.jsonl`)

const debug = new DebugRecorder(sessionsDir, sessionName, (e) => debugWin?.webContents.send('debug:event', e))
const appEvent = (event: AppDebugEvent) => debug.record({ source: 'app', event })

const jev = mock ? offlineJev() : createJevClient()

/**
 * Offline stand-in for Jev: picks the step whose words overlap most with the conversation, takes
 * it once the user has said something, and is done after one step per utterance.
 */
function offlineJev(): DecisionClient {
  const base = createMockJevClient()
  return {
    choose: base.choose,
    async decide(req) {
      const result = await base.decide(req)
      if (!req.questions.next) return result
      const conversation = req.state.slice(req.state.indexOf('## Conversation'), req.state.indexOf('## Screen'))
      const last = conversation.trim().split('\n').at(-1) ?? ''
      const choice = last.startsWith('User:') ? 'act' : last.startsWith('User (still speaking)') ? 'listen' : 'done'
      result.answers.next = { choice, probabilities: { [choice]: 1 }, confidence: 1 }
      return result
    },
  }
}
const agent = new Agent({
  world: shell,
  jev,
  thinker,
  web: process.env.PARALLEL_API_KEY ? parallelWeb(process.env.PARALLEL_API_KEY) : undefined,
  events: {
    status: (s) => {
      status = s
      appEvent({ type: 'status', status: s })
      sendSnapshot()
    },
    // Shown as it is written, and spoken as it comes.
    speak: (id, text, done) => {
      said = { text, at: Date.now() }
      speaker?.update(id, text, done)
      sendSnapshot()
    },
    hush: (id) => {
      const spoken = speaker?.stop(id)
      if (spoken !== null && spoken !== undefined) agent.cutOff(id, spoken)
    },
    debug: (event) => debug.record({ source: 'agent', event }),
    // Words and voice both say the user finished: end the utterance now, not at the silence backstop.
    turnEnd: () =>
      transition(() => {
        transcriber?.endUtterance()
        endUtterance()
        sendSnapshot()
      }),
  },
  config: defaultConfig,
  sink: (record) => {
    appendFileSync(sessionFile, JSON.stringify(record) + '\n')
    debug.record({ source: 'history', event: record })
  },
})
appEvent({ type: 'session-start', session: sessionName, config: defaultConfig, systemPrompt: SYSTEM_PROMPT, instructions: agent.instructions, mock })

/**
 * While Stanley talks, what the mic hears goes here first: Stanley's own voice is taken out, it
 * lowers its voice when the user starts, and stops for them if they want to be heard.
 */
const bargeIn = new BargeIn({
  jev,
  conversation: (except) => agent.conversation(except),
  speech: () => speaker?.position() ?? null,
  events: {
    duck: (on) => {
      speaker?.duck(on)
      sendSnapshot()
    },
    cut: (heard) => cutIn(heard),
    // Not for Stanley, so not context for what the user says next either.
    dismiss: () => transcriber?.endUtterance(),
    debug: (event) => debug.record({ source: 'agent', event }),
  },
})

/** Speech is heard over Stanley: until it is settled, it is the barge-in's, not the agent's. */
const overheard = () => !!speaker?.speaking || bargeIn.busy

/** Stops Stanley talking. The conversation keeps only what the user heard of each reply. */
function stopTalking() {
  for (const { id, spoken } of speaker?.stopAll() ?? []) agent.cutOff(id, spoken ?? '')
}

/** The user cut in on Stanley: it stops, and their words so far start a new utterance. */
function cutIn(heard: Overheard) {
  stopTalking()
  beginUtterance()
  agent.voice(speaking)
  for (const s of heard.segments) {
    transcript.finalized.push(s.text)
    agent.segment(s.text, s.words)
  }
  if (heard.partial) {
    transcript.partial = heard.partial.text
    agent.partial(heard.partial.text, heard.partial.words)
  }
  sendSnapshot()
}

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
    talking: !!speaker?.speaking,
    ducked: !!speaker?.ducked,
    stt,
    tts,
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
  clip = saveClips ? lead : null
  lead = []
  utteranceStartedAt = Date.now()
  agent.utteranceStart()
  utteranceOpen = true
}

function endUtterance() {
  transcript.partial = ''
  if (!utteranceOpen) return
  utteranceOpen = false
  writeClip()
  // Keep what Stanley said on screen while the user answers it; clear it once they have.
  if (said && said.at < utteranceStartedAt) said = null
  agent.utteranceEnd()
  sendSnapshot()
}

function writeClip() {
  const audio = clip
  clip = null
  const heard = transcript.finalized.join(' ')
  if (!audio?.length || !heard) return
  mkdirSync(clipsDir, { recursive: true })
  const id = `${sessionName}-${++clipCount}`
  const samples = new Float32Array(audio.reduce((n, c) => n + c.length, 0))
  audio.reduce((offset, c) => (samples.set(c, offset), offset + c.length), 0)
  writeWav(join(clipsDir, `${id}.wav`), samples, SAMPLE_RATE)
  writeFileSync(join(clipsDir, `${id}.json`), JSON.stringify({ recordedAt: new Date().toISOString(), heard }, null, 2) + '\n')
  console.log(`Saved clip ${id}: "${heard}"`)
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
        partial: (text, words) => {
          if (overheard()) return bargeIn.partial(text, words)
          if (!utteranceOpen) beginUtterance()
          transcript.partial = text
          agent.partial(text, words)
          sendSnapshot()
        },
        segment: (text, words) => {
          if (overheard()) return bargeIn.segment(text, words)
          if (!utteranceOpen) beginUtterance()
          transcript.finalized.push(text)
          transcript.partial = ''
          agent.segment(text, words)
          sendSnapshot()
        },
        speaking: (on) => {
          speaking = on
          agent.voice(on)
          if (on ? overheard() : bargeIn.busy) bargeIn.voice(on)
          sendSnapshot()
        },
        pause: (turn) => {
          if (!overheard()) agent.pause(turn)
        },
        silence: () =>
          transition(() => {
            endUtterance()
            sendSnapshot()
          }),
        debug: (event) => debug.record({ source: 'stt', event }),
      },
    )
    await refreshHotwords()
    setStt('ready')
  } catch (err) {
    console.error('STT failed to load', err)
    setStt('error', String(err))
  }
}

function setTts(state: Snapshot['tts'], error?: string) {
  tts = state
  appEvent({ type: 'tts-state', tts: state, error })
  sendSnapshot()
}

async function loadTts() {
  const modelsDir = join(root, 'models')
  if (!existsSync(join(modelsDir, KOKORO))) return setTts('missing-models')
  try {
    const synth = await loadKokoro(modelsDir, { voice: process.env.STANLEY_VOICE })
    speaker = new Speaker(synth, {
      audio: (piece) => win?.webContents.send('speech:audio', piece),
      stop: (reply) => win?.webContents.send('speech:stop', reply),
      volume: (level) => win?.webContents.send('speech:volume', level),
      speaking: (on) => {
        // The user may already be talking as Stanley starts: it starts quietly, and judges them.
        if (on && speaking) bargeIn.voice(true)
        if (!on) bargeIn.speechEnded()
        sendSnapshot()
      },
      debug: (event) => debug.record({ source: 'tts', event }),
    })
    setTts('ready')
  } catch (err) {
    console.error('TTS failed to load', err)
    setTts('error', String(err))
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
        submenu: [
          { label: 'Open Debug Window', accelerator: 'CommandOrControl+Shift+D', click: openDebugWindow },
          {
            label: 'Save Utterances as Eval Clips',
            type: 'checkbox',
            checked: saveClips,
            click: (item) => (saveClips = item.checked),
          },
        ],
      },
      { role: 'windowMenu' },
    ]),
  )
}

ipcMain.on('audio', (_, chunk: Float32Array) => {
  if (!listening) return
  if (clip && utteranceOpen) clip.push(chunk)
  else lead = [...lead.slice(1 - LEAD_CHUNKS), chunk]
  if (accepting) transcriber?.accept(chunk)
  else held.push(chunk)
})
ipcMain.on('speech:started', (_, reply: number, seq: number) => speaker?.started(reply, seq))
ipcMain.on('speech:ended', (_, reply: number, seq: number) => speaker?.ended(reply, seq))
ipcMain.on('toggle-listening', () => toggleListening('button'))
ipcMain.on('open', async (_, appId: string | null) => {
  const result = await shell.open(appId)
  await shell.global('show')
  const option = appId ? `open ${appId}` : 'home'
  appEvent({ type: 'manual', option, summary: result.summary })
  const app = appId ? apps.find((a) => a.id === appId) : undefined
  agent.recordUserStep(app ? { kind: 'app', appId: app.id, title: app.title } : { kind: 'home' }, result)
})
ipcMain.on('perform', async (_, appId: string, nodeId: string, args) => {
  // Named as the agent would see it, so the conversation reads the same whoever acted.
  const element = findElement(shell.screenOf(appId), `${appId}:${nodeId}`)
  const result = await shell.performIn(appId, nodeId, args ?? {})
  appEvent({ type: 'manual', option: element?.name ?? `${appId} › ${nodeId}`, summary: result.summary })
  const kind = element?.node.kind ?? (args?.text === undefined ? 'action' : 'input')
  agent.recordUserStep(
    { kind: 'element', name: element?.name ?? nodeId, role: element?.node.role ?? kind, nodeKind: kind, nodeId: `${appId}:${nodeId}` },
    result,
    args?.text,
  )
})
ipcMain.on('say', (_, text: string) => {
  appEvent({ type: 'typed', text })
  // Typing over Stanley cuts in, like speaking over it.
  bargeIn.cancel()
  stopTalking()
  // With the mic on, typed text is its own utterance and the mic stays on.
  if (listening) {
    return transition(() => {
      endUtterance()
      beginUtterance()
      clip = null
      transcript.finalized.push(text)
      agent.segment(text)
      endUtterance()
      sendSnapshot()
    })
  }
  startListening('typed')
  transition(() => {
    clip = null
    transcript.finalized.push(text)
    agent.segment(text)
  })
  stopListening('typed')
})

ipcMain.handle('debug:history', () => debug.events)
ipcMain.handle('debug:sessions', () => debug.sessions())
ipcMain.handle('debug:load', (_, file: string) => debug.load(file))
ipcMain.handle('debug:replay', (_, req: ReplayRequest) => jev.decide(req))
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
  void loadTts()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  // What thinking hasn't seen yet goes into the session file too.
  agent.history.commit()
})
app.on('window-all-closed', () => app.quit())
