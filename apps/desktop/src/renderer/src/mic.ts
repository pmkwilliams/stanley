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

/** 16 kHz mono float chunks (~100 ms) from the default mic. Returns a stop function. */
export async function startMic(onChunk: (chunk: Float32Array) => void): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  })
  const ctx = new AudioContext({ sampleRate: 16000 })
  const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }))
  await ctx.audioWorklet.addModule(url)
  URL.revokeObjectURL(url)
  const node = new AudioWorkletNode(ctx, 'capture')
  node.port.onmessage = (e: MessageEvent<Float32Array>) => onChunk(e.data)
  ctx.createMediaStreamSource(stream).connect(node)
  return () => {
    stream.getTracks().forEach((t) => t.stop())
    void ctx.close()
  }
}
