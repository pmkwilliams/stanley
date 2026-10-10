import { mount } from 'svelte'
import App from './App.svelte'
import Debug from './Debug.svelte'
import './app.css'

mount(location.hash === '#debug' ? Debug : App, { target: document.getElementById('app')! })
