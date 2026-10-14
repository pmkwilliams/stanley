import type { Component } from 'svelte'
import Email from '@stanley/app-email/ui'
import Lights from '@stanley/app-lights/ui'
import Music from '@stanley/app-music/ui'
import MusicPlayer from '@stanley/app-music/player'
import Settings from '@stanley/app-settings/ui'
import Todo from '@stanley/app-todo/ui'
import Weather from '@stanley/app-weather/ui'
import Web from '@stanley/app-web/ui'

export const surfaces: Record<string, Component<any>> = {
  email: Email,
  lights: Lights,
  music: Music,
  settings: Settings,
  todo: Todo,
  weather: Weather,
  web: Web,
}

/** Headless parts of an app (e.g. audio), mounted whenever its surface exists, visible or not. */
export const backgrounds: Record<string, Component<any>> = {
  music: MusicPlayer,
}

/**
 * Apps whose window stays in place while hidden, so what is in it keeps running: a web page goes on
 * being a page Stanley can read and work in the background, and comes back as it was left.
 */
export const kept = new Set(['web'])
