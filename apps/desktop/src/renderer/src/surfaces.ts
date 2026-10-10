import type { Component } from 'svelte'
import Email from '@stanley/app-email/ui'
import Music from '@stanley/app-music/ui'
import Todo from '@stanley/app-todo/ui'
import Weather from '@stanley/app-weather/ui'
import Web from '@stanley/app-web/ui'

export const surfaces: Record<string, Component<any>> = {
  email: Email,
  music: Music,
  todo: Todo,
  weather: Weather,
  web: Web,
}
