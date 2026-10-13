import { mount } from 'svelte'
import App from './App.svelte'
import Debug from './Debug.svelte'
import '@fontsource-variable/inter'
import './app.css'
import { setTheme } from './theme.svelte'

const debug = location.hash === '#debug'
// The debug window is a dev tool and stays dark; set before mounting, so the first frame is already themed.
setTheme(debug ? 'dark' : window.stanley.initialTheme)

mount(debug ? Debug : App, { target: document.getElementById('app')! })
