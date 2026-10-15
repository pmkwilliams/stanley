/**
 * Hearing the user start to talk from the echo-cancelled mic's level alone, within a chunk (~100 ms)
 * and before the VAD in main has decided. On speakers, under loud music, the canceller suppresses
 * the user's voice along with the music, leaving the VAD late or deaf to it; what gets through is
 * bursts at speech level. On the first, apps' sound ducks and the transcriber switches to the mic
 * without the canceller (see `startMic`).
 *
 * Measured on MacBook speakers and mic, music at full volume: what the canceller leaves of it sits
 * near −60 dBFS, and a single chunk over −45 caught every sentence spoken over it, on its first
 * syllable. Drum hits the canceller misses also cross it, about twice in 45 s: a one-second dip.
 */
export const ONSET_DBFS = -45
/** How long an onset lasts: long enough for the VAD to confirm speech and hold the duck from there. */
export const ONSET_HOLD_MS = 1000

/** Whether a mic chunk at this level (dBFS) may be the user starting to talk. */
export const voiceMayStart = (db: number): boolean => db > ONSET_DBFS
