import { mount } from 'svelte'
import '@fontsource-variable/inter'
import '../src/renderer/src/app.css'
import Gallery from './Gallery.svelte'
import Screen from './Screen.svelte'

// `__screen`, given before the page loads, shows several apps laid out as the shell would (Screen.svelte).
mount((window as any).__screen ? Screen : Gallery, { target: document.getElementById('app')! })
