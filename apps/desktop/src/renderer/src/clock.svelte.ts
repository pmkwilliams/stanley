/** Wall-clock time shared by the status bar and the lock screen, ticking on the minute so it turns over with the system's. */
export const clock = $state({ now: new Date() })

const tick = () => {
  clock.now = new Date()
  setTimeout(tick, 60_000 - (Date.now() % 60_000))
}
tick()

/** "3:25" or "15:25", per the locale, without AM/PM. */
export function time(d: Date): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
    .formatToParts(d)
    .filter((p) => p.type !== 'dayPeriod')
    .map((p) => p.value)
    .join('')
    .trim()
}

/** "Mon" */
export function weekday(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: 'short' })
}

/** "Mon, 12 Oct" */
export function date(d: Date): string {
  return `${weekday(d)}, ${d.getDate()} ${d.toLocaleDateString(undefined, { month: 'short' })}`
}
