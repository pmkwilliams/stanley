// Downloads the local speech models and the quick model into ./models (gitignored).
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

// The quick model, which tidies dictated words into fields: Gemma 4 E4B (Apache-2.0) on llama.cpp's server (MIT).
if (process.platform === 'darwin' && process.arch === 'arm64') {
  const build = 'b11642'
  if (!existsSync(join(dir, 'llama.cpp', 'llama-server'))) {
    console.log(`Downloading llama.cpp ${build} (~12 MB)…`)
    const archive = join(dir, 'llama.cpp.tar.gz')
    execFileSync('curl', ['-fL', '-o', archive, `https://github.com/ggml-org/llama.cpp/releases/download/${build}/llama-${build}-bin-macos-arm64.tar.gz`], { stdio: 'inherit' })
    execFileSync('tar', ['xzf', archive, '-C', dir], { stdio: 'inherit' })
    execFileSync('mv', [join(dir, `llama-${build}`), join(dir, 'llama.cpp')])
    execFileSync('rm', [archive])
  }
  const gemma = 'gemma-4-E4B-it-Q4_K_M.gguf'
  if (!existsSync(join(dir, gemma))) {
    console.log('Downloading Gemma 4 E4B (Q4_K_M, ~5 GB)…')
    execFileSync('curl', ['-fL', '-o', join(dir, `${gemma}.part`), `https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF/resolve/main/${gemma}`], { stdio: 'inherit' })
    execFileSync('mv', [join(dir, `${gemma}.part`), join(dir, gemma)])
  }
  // Ranks the steps on offer by what the user asks: bge-small-en-v1.5 (MIT) on the same server.
  const bge = 'bge-small-en-v1.5-q8_0.gguf'
  if (!existsSync(join(dir, bge))) {
    console.log('Downloading bge-small-en-v1.5 (Q8_0, ~37 MB)…')
    execFileSync('curl', ['-fL', '-o', join(dir, `${bge}.part`), `https://huggingface.co/CompendiumLabs/bge-small-en-v1.5-gguf/resolve/main/${bge}`], { stdio: 'inherit' })
    execFileSync('mv', [join(dir, `${bge}.part`), join(dir, bge)])
  }
}

console.log(`Models ready in ${dir}`)
