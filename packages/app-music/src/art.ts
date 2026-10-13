/**
 * Generated cover art: tracks without an image (the bundled ones) get a gradient picked
 * deterministically from their id and title. Same track, same cover, everywhere it's shown.
 */

/** Deep edge, bright highlight, mid tone, shadow: the same four-stop shape as the status bar's stub art. */
const palettes: [string, string, string, string][] = [
  ['#2b2f6e', '#8a90e0', '#4b4fb0', '#171936'], // indigo
  ['#6b2a3c', '#f2a27c', '#c0566c', '#29101c'], // dusk
  ['#123f52', '#86d6c9', '#2b7d92', '#0a2230'], // sea
  ['#43206b', '#de82cc', '#7a42b6', '#1c0f33'], // violet
  ['#284f2c', '#b8d88e', '#4e8a52', '#11240f'], // moss
  ['#5c3a12', '#f3c46e', '#b27a2c', '#2a1906'], // amber
]

function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  return h >>> 0
}

/** A CSS `background` for a track's cover. */
export function artwork(track: { id: string; title: string }): string {
  const h = hash(`${track.id}:${track.title}`)
  const [deep, light, mid, shadow] = palettes[h % palettes.length]!
  const angle = 115 + ((h >>> 8) % 50)
  const glow = 15 + ((h >>> 16) % 50)
  return [
    `radial-gradient(90% 70% at ${glow}% 12%, rgba(255, 255, 255, 0.22), transparent 60%)`,
    `linear-gradient(${angle}deg, ${deep}, ${light} 45%, ${mid} 70%, ${shadow})`,
  ].join(', ')
}

/** The cover's highlight colour, for things drawn beside it (e.g. the status bar's waveform). */
export function tint(track: { id: string; title: string }): string {
  return palettes[hash(`${track.id}:${track.title}`) % palettes.length]![1]
}

/**
 * A CSS `background` for a track's cover: its real image when it has one (Jamendo), over the
 * generated cover, which shows while the image loads or if it fails.
 */
export function cover(track: { id: string; title: string; image?: string }): string {
  if (!track.image) return artwork(track)
  const url = track.image.replace(/["\\\n]/g, encodeURIComponent)
  return `url("${url}") center / cover no-repeat, ${artwork(track)}`
}
