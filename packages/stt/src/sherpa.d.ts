declare module 'sherpa-onnx-node' {
  export interface OfflineStream {
    acceptWaveform(wave: { samples: Float32Array; sampleRate: number }): void
  }
  export class OfflineRecognizer {
    static createAsync(config: unknown): Promise<OfflineRecognizer>
    /** `hotwords`: newline-separated words for beam search to favour. */
    createStream(hotwords?: string): OfflineStream
    decodeAsync(stream: OfflineStream): Promise<{ text: string; tokens: string[]; timestamps: number[]; ys_log_probs?: number[] }>
  }
  export class Vad {
    constructor(config: unknown, bufferSizeInSeconds: number)
    acceptWaveform(samples: Float32Array): void
    isEmpty(): boolean
    isDetected(): boolean
    front(enableExternalBuffer?: boolean): { start: number; samples: Float32Array }
    pop(): void
    flush(): void
    reset(): void
  }
}

declare module 'sherpa-onnx-node' {
  const sherpa: { OfflineRecognizer: typeof OfflineRecognizer; Vad: typeof Vad }
  export default sherpa
}
