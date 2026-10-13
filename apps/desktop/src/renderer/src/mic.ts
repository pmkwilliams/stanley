const WORKLET = `
class Capture extends AudioWorkletProcessor {
  buf = []
  size = 0
  process([input]) {
    const ch = input[0]
    if (ch) {
      this.buf.push(ch.slice())
      this.size += ch.length
      if (this.size >= 1600) {
        const out = new Float32Array(this.size)
        let o = 0
        for (const b of this.buf) { out.set(b, o); o += b.length }
        this.port.postMessage(out, [out.buffer])
        this.buf = []
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
 */
export async function startMic(onChunk: (chunk: Float32Array) => void): Promise<() => void> {
  const ctx = new AudioContext({ sampleRate: 16000 })
  const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }))
  await ctx.audioWorklet.addModule(url)
  URL.revokeObjectURL(url)
  const node = new AudioWorkletNode(ctx, 'capture')
  node.port.onmessage = (e: MessageEvent<Float32Array>) => onChunk(e.data)

  let stopped = false
  let current: { stream: MediaStream; source: MediaStreamAudioSourceNode } | null = null
  const close = () => {
    current?.source.disconnect()
    current?.stream.getTracks().forEach((t) => t.stop())
    current = null
  }
  const open = async () => {
    const headphones = await outputIsHeadphones()
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: !headphones, noiseSuppression: true },
    })
    if (stopped) return stream.getTracks().forEach((t) => t.stop())
    close()
    const source = ctx.createMediaStreamSource(stream)
    source.connect(node)
    current = { stream, source }
    console.info(`Mic open, echo cancellation ${headphones ? 'off (headphones)' : 'on'}`)
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
