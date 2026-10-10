// Downloads the local STT models into ./models (gitignored).
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

console.log(`Models ready in ${dir}`)
