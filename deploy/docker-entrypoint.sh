#!/bin/sh
# Arranque del contenedor: registra los slash commands, levanta el servidor Vosk (STT)
# en segundo plano y deja el bot como proceso principal.
# tini (PID 1, con -g) reenvía SIGTERM a todo el grupo, así que al parar el contenedor
# se cierran ordenadamente tanto el bot como Vosk.
set -e

node src/core/registerCommands.js

if [ "${STT_ENABLED:-1}" = "1" ]; then
    VOSK_MODEL_PATH="${VOSK_MODEL_PATH:-/app/models/vosk-model-small-es-0.42}"
    echo "[entrypoint] Iniciando servidor Vosk con el modelo ${VOSK_MODEL_PATH}"
    /opt/vosk/bin/python vosk/server.py --model "$VOSK_MODEL_PATH" --port "${VOSK_PORT:-5001}" &
else
    echo "[entrypoint] STT_ENABLED=0: no se inicia el servidor Vosk"
fi

exec node src/index.js
