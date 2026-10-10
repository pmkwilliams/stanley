import type { StanleyApi } from '../shared/ipc'

declare global {
  interface Window {
    stanley: StanleyApi
  }
}
