import { appendFileSync, existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { FULLSCREEN, themed, type LivePage } from '@stanley/app-sdk'
import { readSettings } from '@stanley/app-settings/core'
import { shownTab, type WebState } from '@stanley/app-web/core'
import { parallelWeb } from '@stanley/app-web/parallel'
import { livePage } from '@stanley/browser'
import { localFiles } from '@stanley/files'
import { Agent, BargeIn, createThinker, deciderProfile, defaultConfig, findElement, named, PAGE_SIZE, screenVocabulary, scriptedTurn, SYSTEM_PROMPT, type AgentStatus, type FileTools, type Overheard, type PageSize, type Thinker } from '@stanley/agent'
import { createDecisionClient, createMockJevClient, type DecisionClient } from '@stanley/jev'
import { SAMPLE_RATE, Transcriber, writeWav, type HeardWord } from '@stanley/stt'
import { KOKORO, loadKokoro, Speaker } from '@stanley/tts'
import { app, BrowserWindow, clipboard, globalShortcut, ipcMain, Menu, nativeTheme, protocol, screen, session } from 'electron'
import type { AppDebugEvent, CaptionWord, ReplayRequest, Snapshot } from '../shared/ipc'
import { apps } from './apps'
import { DebugRecorder } from './debug'
import { Drafts } from './drafts'
import { filePath, SCHEME, serveFile, serveLib } from './folder-pages'
import { WebviewTabs } from './page'
import { Shell } from './shell'
import { fileStore } from './store'

app.setName('Stanley')
// The user's folder and the page libraries, as the web view loads them (see folder-pages.ts).
protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } }])

const root = join(import.meta.dirname, '../../../..')
const envFile = join(root, '.env')
if (existsSync(envFile)) process.loadEnvFile(envFile)

const mock = !process.env.AI_GATEWAY_API_KEY
const PTT_SHORTCUTS = [process.env.STANLEY_PTT, 'Alt+Space', 'CommandOrControl+Shift+Space'].filter(Boolean) as string[]
let ptt: string | null = null

let win: BrowserWindow | null = null
let debugWin: BrowserWindow | null = null
/** Starts locked, like a computer coming on. While locked the mic stays off. */
let locked = true
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
const transcript = { finalized: [] as string[], partial: '', words: { finalized: [] as (CaptionWord[] | undefined)[], partial: undefined as CaptionWord[] | undefined } }

/** A segment of the utterance ended: `words` carry speech recognition's confidence, none for typed text. */
function addSegment(text: string, words?: HeardWord[]) {
  transcript.finalized.push(text)
  transcript.words.finalized.push(captioned(words))
}

function setPartial(text: string, words?: HeardWord[]) {
  transcript.partial = text
  transcript.words.partial = captioned(words)
}

function clearTranscript() {
  transcript.finalized = []
  transcript.words.finalized = []
  setPartial('')
}

const captioned = (words?: HeardWord[]): CaptionWord[] | undefined =>
  words?.map(({ word, confidence }) => ({ word, unsure: confidence < defaultConfig.unsureWord }))

/** Debug › Save Utterances as Eval Clips: each spoken utterance is written to evals/speech/clips. */
const clipsDir = join(root, 'evals', 'speech', 'clips')
let saveClips = process.env.STANLEY_SAVE_CLIPS === '1'
/** The last ~1.5 s of audio before an utterance, since the first words arrive after speech began. */
const LEAD_CHUNKS = 15
let lead: Float32Array[] = []
/** Audio of the utterance being recorded, or null when not recording one. */
let clip: Float32Array[] | null = null
let clipCount = 0

/** The apps' state and what's on screen. Replaced whole when the user locks, which starts a new session. */
let shell!: Shell

/** Speech recognition favours the assistant's name, and the names and labels on the screen it is working on, as last read. */
function refreshHotwords() {
  if (!transcriber) return
  transcriber.setHotwords([...new Set([agentName(), ...screenVocabulary(shell.screenNow(), shell.appList())])])
}

/** Pages Stanley is writing, drawn in the web view as they come. */
const drafts = new Drafts()
/** The Web app's pages, live in the main window, a tab each: Stanley reads them and works them like a person in a browser. */
const tabs = new WebviewTabs({
  navigated: (tab) => pageNavigated(tab),
  fileOf: (url) => {
    const path = folder && filePath(url)
    return folder && path !== null && path !== undefined ? join(folder.root, path) : null
  },
  drafting: (url) => {
    const path = filePath(url)
    return path !== null && drafts.has(path)
  },
  backdrop: (url) => {
    const path = filePath(url)
    return path !== null && themed(path) ? GLASS[readSettings(store).theme] : '#ffffff'
  },
  // Escape leaves full screen, as in a browser, also when the page has the keyboard.
  escape: () => {
    if (shell.layout.fullscreen && shell.layout.visible === 'web' && !locked) void shell.performIn('web', FULLSCREEN, {})
  },
})
/** Each tab's page as the Web app works it, made once per session (a page remembers which of its elements are fields). */
let livePages = new Map<number, LivePage>()
const pages = { tab: (id: number) => livePages.get(id) ?? livePages.set(id, livePage(tabs.page(id))).get(id)! }
let navigatedTimer: ReturnType<typeof setTimeout> | undefined

/** The tab the Web app shows, if it shows one. */
const webTab = () => {
  const state = shell.surfaces.get('web') as WebState | undefined
  return state ? shownTab(state) : null
}

/**
 * The page shown changed by itself or by the user's hand (a link, a form, a new title): read it
 * again. A page the user went to themselves is in the conversation, as their own step. A tab out of
 * sight is read when it is shown.
 */
function pageNavigated(tab: number) {
  if (tab !== webTab()) return
  clearTimeout(navigatedTimer)
  navigatedTimer = setTimeout(async () => {
    const world = shell
    const moved = await world.refresh('web').catch(() => false)
    if (!moved || world !== shell) return
    const state = world.surfaces.get('web') as WebState
    const opened = state.pages[Number(state.route.slice(5))]
    if (opened) agent.recordUserStep({ kind: 'page', url: opened.url, title: opened.title }, { summary: `Opened "${opened.title}"` })
  }, 100)
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
/**
 * The user's files: one real folder (`STANLEY_FILES`, else ~/Wren), outlasting sessions. Every
 * version of it is kept next to the settings, where commands can read it but not change it.
 */
const filesRoot = process.env.STANLEY_FILES || join(homedir(), 'Wren')
const files: FileTools | undefined = process.platform === 'darwin' ? localFiles({ root: filesRoot, history: join(app.getPath('userData'), 'files-history.git') }) : undefined
/** The folder as the web view shows it: its real path, and its name for people. */
const folder = files && { root: realpathSync(filesRoot), shown: files.root }
/** Settings, which outlast sessions: locking starts every app over, but not these. */
const store = fileStore(join(app.getPath('userData'), 'settings.json'), applySettings)
/** What the user calls the assistant (Settings). */
const agentName = () => readSettings(store).name
mkdirSync(sessionsDir, { recursive: true })
let sessionName = ''
let sessionFile = ''
let debug!: DebugRecorder
const appEvent = (event: AppDebugEvent) => debug.record({ source: 'app', event })

const jev = mock ? offlineJev() : createDecisionClient()
const profile = deciderProfile(mock ? 'jev' : process.env.STANLEY_DECIDER)

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
let agent!: Agent

/**
 * A fresh session: its own log and debug files, apps at their starting state, and an agent that
 * remembers nothing. Whatever the previous agent was still doing is cancelled, and anything it
 * reports afterwards is ignored.
 */
function startSession() {
  // What thinking hasn't seen yet goes into the ending session's file, before its sink goes quiet.
  agent?.history.commit()
  agent?.cancel()
  sessionName = new Date().toISOString().replace(/[:.]/g, '-')
  sessionFile = join(sessionsDir, `${sessionName}.jsonl`)
  debug = new DebugRecorder(sessionsDir, sessionName, (e) => debugWin?.webContents.send('debug:event', e))
  tabs.reset()
  livePages = new Map()
  const ctx = { env: process.env, fetch, store, pages, get agentName() { return agentName() } }
  const world: Shell = new Shell(
    apps,
    ctx,
    () => {
      if (world !== shell) return
      sendSnapshot()
      refreshHotwords()
      tabs.show(webTab())
    },
    // The agent locks the way the lock button does.
    () => world === shell && lock(),
    { folder, pages: { draft: (path) => drafts.begin(path), look: () => tabs.look() } },
  )
  shell = world
  const self: Agent = new Agent({
    world: shell,
    jev,
    thinker,
    web: process.env.PARALLEL_API_KEY ? parallelWeb(process.env.PARALLEL_API_KEY) : undefined,
    files,
    events: {
      status: (s) => {
        if (self !== agent) return
        status = s
        appEvent({ type: 'status', status: s })
        sendSnapshot()
      },
      // Shown as it is written, and spoken as it comes.
      speak: (id, text, done) => {
        if (self !== agent) return
        said = { text, at: Date.now() }
        speaker?.update(id, text, done)
        sendSnapshot()
      },
      hush: (id) => {
        if (self !== agent) return
        const spoken = speaker?.stop(id)
        if (spoken !== null && spoken !== undefined) agent.cutOff(id, spoken)
      },
      debug: (event) => self === agent && debug.record({ source: 'agent', event }),
      // Words and voice both say the user finished: end the utterance now, not at the silence backstop.
      turnEnd: () =>
        self === agent &&
        transition(() => {
          transcriber?.endUtterance()
          endUtterance()
          sendSnapshot()
        }),
    },
    config: profile.config,
    jevNotes: profile.notes,
    name: agentName,
    pageSize,
    sink: (record) => {
      if (self !== agent) return
      appendFileSync(sessionFile, JSON.stringify(record) + '\n')
      debug.record({ source: 'history', event: record })
    },
  })
  agent = self
  appEvent({ type: 'session-start', session: sessionName, config: profile.config, systemPrompt: named(SYSTEM_PROMPT, agentName()), instructions: agent.instructions, mock })
  status = 'idle'
  said = null
  refreshHotwords()
}
startSession()

/**
 * While Stanley talks, what the mic hears goes here first: Stanley's own voice is taken out, it
 * lowers its voice when the user starts, and stops for them if they want to be heard.
 */
const bargeIn = new BargeIn({
  jev,
  conversation: (except) => agent.conversation(except),
  speech: () => speaker?.position() ?? null,
  name: agentName,
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
    addSegment(s.text, s.words)
    agent.segment(s.text, s.words)
  }
  if (heard.partial) {
    setPartial(heard.partial.text, heard.partial.words)
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
    locked,
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
    theme: readSettings(store).theme,
    name: agentName(),
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
  clearTranscript()
  clip = saveClips ? lead : null
  lead = []
  utteranceStartedAt = Date.now()
  agent.utteranceStart()
  utteranceOpen = true
}

function endUtterance() {
  setPartial('')
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

/**
 * Locking ends the session: the mic goes off with what it heard dropped (and stays off until
 * unlocked), Stanley stops talking and whatever it was doing, and a new session starts with every
 * app back at its start.
 */
function lock() {
  locked = true
  transition(() => {
    if (listening) {
      listening = false
      appEvent({ type: 'listening', on: false, via: 'lock' })
      win?.webContents.send('listening', false)
    }
    accepting = false
    held.length = 0
    transcriber?.reset()
    speaking = false
    utteranceOpen = false
    clearTranscript()
    clip = null
    lead = []
    bargeIn.cancel()
    speaker?.stopAll()
    startSession()
    sendSnapshot()
    // Its timeline is the session's, so it starts over with the new one.
    debugWin?.webContents.reload()
  })
}

/** Back to the home screen, listening. The greeting on the button is the user's first words, with no reply. */
function unlock() {
  if (!locked) return
  locked = false
  // After the lock's new session starts, before the first utterance.
  transition(() => agent.history.greet(`Hello, ${agentName()}`))
  void shell.open(null).then(() => shell.global('show'))
  startListening('unlock')
}

function toggleListening(via: Via) {
  if (locked) return
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
          setPartial(text, words)
          agent.partial(text, words)
          sendSnapshot()
        },
        segment: (text, words) => {
          if (overheard()) return bargeIn.segment(text, words)
          if (!utteranceOpen) beginUtterance()
          addSegment(text, words)
          setPartial('')
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
    refreshHotwords()
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

/** The renderer's `--background` per theme, shown before it paints. */
const WINDOW_BG = { light: '#ffffff', dark: '#0c0a09' }
/**
 * The size a page Stanley writes is shown at now: the window's (the screen's, before there is one),
 * less what the shell takes around the Web app's window (`--window-max-*` in the renderer's
 * App.svelte: the status bar, the caption and margins) and that window's border. Pages of the
 * user's have no address bar. Before the app is ready there is no screen to ask: the agent's guess.
 */
function pageSize(): PageSize {
  if (!app.isReady()) return PAGE_SIZE
  const [width, height] = win?.getContentSize() ?? [screen.getPrimaryDisplay().size.width, screen.getPrimaryDisplay().size.height]
  return { width: width! - 64 - 2, height: height! - 80 - 48 - 64 - 2 }
}

/** About what the Web app's glass looks like under a page Stanley wrote, per theme: the background, half over itself. */
const GLASS = { light: '#ffffff', dark: '#0c0a09' }

/**
 * Matches the window and web pages (through prefers-color-scheme) to the theme, and the window
 * titles to the assistant's name. The renderer follows the snapshot.
 */
function applySettings() {
  const { theme, name } = readSettings(store)
  nativeTheme.themeSource = theme
  win?.setBackgroundColor(WINDOW_BG[theme])
  win?.setTitle(name)
  debugWin?.setTitle(`${name} Debug`)
}

function createWindow() {
  win = new BrowserWindow({
    // Opens full screen; this is its size when the user leaves full screen.
    width: 1280,
    height: 820,
    fullscreen: true,
    title: agentName(),
    backgroundColor: WINDOW_BG[readSettings(store).theme],
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      sandbox: false,
      webviewTag: true,
    },
  })
  // The renderer's status bar spans the full width, like an OS menu bar; ⌘W / ⌘Q still close.
  win.setWindowButtonVisibility(false)
  // The title is the assistant's name (see `applySettings`), not the page's.
  win.on('page-title-updated', (e) => e.preventDefault())
  win.webContents.on('did-finish-load', sendSnapshot)
  // The Web app's view: a page with no access to Stanley or the computer, driven from here.
  win.webContents.on('will-attach-webview', (_, prefs) => {
    delete prefs.preload
    prefs.nodeIntegration = false
    prefs.contextIsolation = true
    prefs.sandbox = true
    // Clear where a page has no background of its own: pages Stanley writes sit on the Web app's
    // glass, and the Web app puts white behind any other page, as a browser would.
    prefs.transparent = true
    // For PDFs.
    prefs.plugins = true
  })
  win.webContents.on('did-attach-webview', (_, wc) => tabs.attach(wc))
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
    title: `${agentName()} Debug`,
    backgroundColor: '#0f1115',
    webPreferences: { preload: join(import.meta.dirname, '../preload/index.mjs'), sandbox: false },
  })
  debugWin.on('page-title-updated', (e) => e.preventDefault())
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
      {
        label: 'View',
        submenu: [
          { role: 'reload' },
          { role: 'forceReload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
          // Full screen with the Dock, menu bar and app switching off. The menu bar is hidden but
          // its shortcuts still work, so the same keys leave; ⌃⌘K sits beside full screen's ⌃⌘F.
          {
            label: 'Kiosk Mode',
            type: 'checkbox',
            accelerator: 'Control+Command+K',
            click: (item) => win?.setKiosk(item.checked),
          },
        ],
      },
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
ipcMain.on('lock', () => lock())
ipcMain.on('unlock', () => unlock())
ipcMain.on('open', async (_, appId: string | null) => {
  const result = await shell.open(appId)
  await shell.global('show')
  const option = appId ? `open ${appId}` : 'home screen'
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
ipcMain.on('theme', (e) => (e.returnValue = readSettings(store).theme))
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
      addSegment(text)
      agent.segment(text)
      endUtterance()
      sendSnapshot()
    })
  }
  startListening('typed')
  transition(() => {
    clip = null
    addSegment(text)
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
  protocol.handle(SCHEME, async (request) => {
    try {
      const { host } = new URL(request.url)
      const path = host === 'files' ? filePath(request.url) : null
      const draft = path !== null && drafts.serve(path)
      if (draft) return draft
      if (host === 'files' && folder) return await serveFile(folder.root, request.url, request.headers)
      if (host === 'lib') return await serveLib(request.url)
    } catch (err) {
      console.error('Serving', request.url, err)
    }
    return new Response('Not found', { status: 404 })
  })
  // Only our own renderer gets the mic. Pages in the Web app's <webview> share this session and get nothing.
  session.defaultSession.setPermissionRequestHandler((contents, permission, cb, details) => {
    const audioOnly = 'mediaTypes' in details && !!details.mediaTypes?.length && details.mediaTypes.every((t) => t === 'audio')
    cb(contents === win?.webContents && permission === 'media' && audioOnly)
  })
  setMenu()
  applySettings()
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
