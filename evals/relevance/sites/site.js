// Shared by the large fixture pages: a seeded generator, saved state, and actions recorded as they
// happen. A page defines `render()`, gives its controls `data-act` and `data-id`, and its links
// `#/open/<id>` routes; what was done is in `localStorage.state.acts`, for the evals to check.
let seed = 1
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
const pick = (list) => list[Math.floor(rand() * list.length)]
const state = JSON.parse(localStorage.getItem('state') || 'null') || { acts: [], on: {} }
const save = () => localStorage.setItem('state', JSON.stringify(state))
save()
/** Whether `act` was done to `id` and not undone. */
const isOn = (act, id) => !!state.on[`${act}:${id}`]
const route = () => location.hash.replace(/^#/, '') || '/'
/** The item a route opens, if it opens one. */
const opened = () => /^\/open\/(.+)$/.exec(route())?.[1]
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]')
  if (!el) return
  const { act, id } = el.dataset
  state.acts.push({ act, id })
  state.on[`${act}:${id}`] = !state.on[`${act}:${id}`]
  save()
  render()
})
window.addEventListener('hashchange', () => {
  const id = opened()
  if (id) {
    state.acts.push({ act: 'open', id })
    save()
  }
  render()
})
