// Downloads the local speech models into ./models (gitignored).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const dir = join(import.meta.dirname, '..', 'models')
const base = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models'
const parakeet = 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8'

mkdirSync(dir, { recursive: true })

if (!existsSync(join(dir, 'silero_vad.onnx'))) {
  console.log('Downloading Silero VAD…')
  execFileSync('curl', ['-fL', '-o', join(dir, 'silero_vad.onnx'), `${base}/silero_vad.onnx`], { stdio: 'inherit' })
}

if (!existsSync(join(dir, parakeet))) {
  console.log('Downloading Parakeet TDT 0.6B v2 (int8, ~640 MB)…')
  const archive = join(dir, `${parakeet}.tar.bz2`)
  execFileSync('curl', ['-fL', '-o', archive, `${base}/${parakeet}.tar.bz2`], { stdio: 'inherit' })
  execFileSync('tar', ['xjf', archive, '-C', dir], { stdio: 'inherit' })
  execFileSync('rm', [archive])
}

// Smart Turn: whether the speaker has finished their turn, from the audio (pipecat-ai, BSD-2).
const smartTurn = 'smart-turn-v3.2-cpu.onnx'
if (!existsSync(join(dir, smartTurn))) {
  console.log('Downloading Smart Turn v3.2 (~8 MB)…')
  execFileSync('curl', ['-fL', '-o', join(dir, smartTurn), `https://huggingface.co/pipecat-ai/smart-turn-v3/resolve/main/${smartTurn}`], { stdio: 'inherit' })
}

// Kokoro 82M v1.0: Stanley's voice (Apache-2.0). The multi-language build, for the v1.0 voices.
const kokoro = 'kokoro-multi-lang-v1_0'
if (!existsSync(join(dir, kokoro))) {
  console.log('Downloading Kokoro v1.0 (~350 MB)…')
  const archive = join(dir, `${kokoro}.tar.bz2`)
  execFileSync('curl', ['-fL', '-o', archive, `https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/${kokoro}.tar.bz2`], { stdio: 'inherit' })
  execFileSync('tar', ['xjf', archive, '-C', dir], { stdio: 'inherit' })
  execFileSync('rm', [archive])
}

console.log(`Models ready in ${dir}`)
