import { loudness } from './presence'

/**
 * Plays Stanley's voice. It plays here, through Web Audio, rather than in the main process, so the
 * mic's echo cancellation hears it and takes it out of what the user says.
 *
 * Pieces play back to back in the order they arrive. Each one's start and end goes back to main,
 * which paces synthesis by how much audio is queued and works out what the user has heard.
 */
export function startVoice(): { level(): number; stop(): void } {
  const ctx = new AudioContext()
  const gain = ctx.createGain()
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 1024
  gain.connect(analyser).connect(ctx.destination)
  const samples = new Float32Array(analyser.fftSize)

  interface Playing {
    reply: number
    source: AudioBufferSourceNode
    end: number
    started: ReturnType<typeof setTimeout>
  }
  let playing: Playing[] = []
  /** When the last queued piece ends, in context time. */
  const queuedUntil = () => Math.max(ctx.currentTime, ...playing.map((p) => p.end))

  const offs = [
    window.stanley.onSpeech((piece) => {
      if (ctx.state === 'suspended') void ctx.resume()
      const buffer = ctx.createBuffer(1, piece.samples.length, piece.sampleRate)
      buffer.copyToChannel(new Float32Array(piece.samples), 0)
      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.connect(gain)
      const at = Math.max(ctx.currentTime + 0.03, queuedUntil())
      source.start(at)
      const item: Playing = {
        reply: piece.reply,
        source,
        end: at + buffer.duration,
        started: setTimeout(() => window.stanley.speechStarted(piece.reply, piece.seq), (at - ctx.currentTime) * 1000),
      }
      playing.push(item)
      source.onended = () => {
        playing = playing.filter((p) => p !== item)
        window.stanley.speechEnded(piece.reply, piece.seq)
      }
    }),
    window.stanley.onSpeechStop((reply) => {
      for (const p of playing.filter((p) => p.reply === reply)) {
        clearTimeout(p.started)
        p.source.onended = null
        p.source.stop()
      }
      playing = playing.filter((p) => p.reply !== reply)
    }),
    window.stanley.onSpeechVolume((level) => gain.gain.setTargetAtTime(level, ctx.currentTime, 0.04)),
  ]

  return {
    /** How loud Stanley is right now, 0–1, ducking included. */
    level() {
      if (!playing.length) return 0
      analyser.getFloatTimeDomainData(samples)
      return loudness(samples)
    },
    stop() {
      offs.forEach((off) => off())
      void ctx.close()
    },
  }
}
