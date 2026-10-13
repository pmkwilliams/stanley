import { mount } from 'svelte'
import '@fontsource-variable/inter'
import '../src/renderer/src/app.css'
import Gallery from './Gallery.svelte'

mount(Gallery, { target: document.getElementById('app')! })
