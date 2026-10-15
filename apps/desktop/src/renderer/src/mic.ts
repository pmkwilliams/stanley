const WORKLET = `
class Capture extends AudioWorkletProcessor {
  buf = []
  raw = []
  size = 0
  process([input, uncancelled]) {
    const ch = input[0]
    if (ch) {
      this.buf.push(ch.slice())
      this.raw.push(uncancelled[0]?.slice())
      this.size += ch.length
      if (this.size >= 1600) {
        const join = (parts) => {
          const out = new Float32Array(this.size)
          let o = 0
          for (const b of parts) { out.set(b, o); o += b.length }
          return out
        }
        const out = join(this.buf)
        const raw = this.raw.every(Boolean) ? join(this.raw) : undefined
        this.port.postMessage({ chunk: out, uncancelled: raw }, raw ? [out.buffer, raw.buffer] : [out.buffer])
        this.buf = []
        this.raw = []
        this.size = 0
      }
    }
    return true
  }
}
registerProcessor('capture', Capture)
`

/**
 * Whether the default output is headphones, from its label (Chromium on macOS names them like
 * "Bose NC 700 HP (Bluetooth)" or "External Headphones (Built-in)").
 */
export function isHeadphones(label: string): boolean {
  return /bluetooth|headphone|headset|airpods|buds/i.test(label) && !/speaker/i.test(label)
}

async function outputIsHeadphones(): Promise<boolean> {
  const devices = await navigator.mediaDevices.enumerateDevices()
  const out = devices.find((d) => d.kind === 'audiooutput' && d.deviceId === 'default')
  return !!out && isHeadphones(out.label)
}

/**
 * 16 kHz mono float chunks (~100 ms) from the default mic. Returns a stop function.
 *
 * Echo cancellation takes what the app plays (Stanley's voice, music) out of the mic. On speakers
 * that is what keeps Stanley from hearing itself. On headphones nothing played reaches the mic,
 * and the canceller only does harm: under music it suppresses the user's voice as if it were echo.
 * So it is on for speakers only, and the mic reopens when the output changes.
 *
 * On speakers the canceller does that harm too, under loud music: it lets the user's voice through
 * in bursts the transcriber can't follow. Music alone doesn't trouble the transcriber, though sung
 * words would reach it as speech. So on speakers the mic also opens without the canceller, and each
 * chunk comes with that `uncancelled` copy, for while the cancelled one shows the user talking.
 */
export async function startMic(onChunk: (chunk: Float32Array, uncancelled?: Float32Array) => void): Promise<() => void> {
  const ctx = new AudioContext({ sampleRate: 16000 })
  const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }))
  await ctx.audioWorklet.addModule(url)
  URL.revokeObjectURL(url)
  const node = new AudioWorkletNode(ctx, 'capture', { numberOfInputs: 2 })
  node.port.onmessage = (e: MessageEvent<{ chunk: Float32Array; uncancelled?: Float32Array }>) => onChunk(e.data.chunk, e.data.uncancelled)

  let stopped = false
  let current: { streams: MediaStream[]; sources: MediaStreamAudioSourceNode[] } | null = null
  const close = () => {
    current?.sources.forEach((s) => s.disconnect())
    current?.streams.forEach((s) => s.getTracks().forEach((t) => t.stop()))
    current = null
  }
  const open = async () => {
    const headphones = await outputIsHeadphones()
    const mic = (echoCancellation: boolean) => navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation, noiseSuppression: true } })
    const streams = await Promise.all(headphones ? [mic(false)] : [mic(true), mic(false)])
    if (stopped) return streams.forEach((s) => s.getTracks().forEach((t) => t.stop()))
    close()
    const sources = streams.map((stream, i) => {
      const source = ctx.createMediaStreamSource(stream)
      source.connect(node, 0, i)
      return source
    })
    current = { streams, sources }
    console.info(`Mic open, echo cancellation ${headphones ? 'off (headphones)' : 'on, and an uncancelled copy'}`)
  }
  await open()

  // Plugging in or unplugging headphones changes the default devices: follow them.
  let reopening = Promise.resolve()
  const onDeviceChange = () => {
    reopening = reopening.then(open).catch((err) => console.error('Mic failed to reopen', err))
  }
  navigator.mediaDevices.addEventListener('devicechange', onDeviceChange)

  return () => {
    stopped = true
    navigator.mediaDevices.removeEventListener('devicechange', onDeviceChange)
    close()
    void ctx.close()
  }
}
