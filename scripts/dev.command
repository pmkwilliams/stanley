#!/bin/zsh -l
# Stanley with live reload: renderer changes hot-swap, main-process changes (agent, shell, apps)
# restart the app. Run from your own terminal, never from an agent's shell: macOS gives the mic to
# whatever app launched Electron, and agent shells can't grant it (getUserMedia returns silence).
# Agent shells also export ELECTRON_RUN_AS_NODE, which stops Electron from starting.
unset ELECTRON_RUN_AS_NODE
cd "${0:A:h}/.."
exec pnpm dev
