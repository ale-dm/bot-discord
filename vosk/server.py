"""
Servidor local de transcripción (Vosk) para /escuchar.

    POST /transcribe  (campo de formulario 'file' con un WAV)  ->  {"text": "..."}
    GET  /health                                                 ->  {"ok": true}

Uso:
    python vosk/server.py --model models/vosk-model-small-es-0.42 --port 5001

En Docker lo arranca deploy/docker-entrypoint.sh. En local: npm start (o scripts/setup-local-stt.ps1).
"""
import argparse
import json
import logging
import os
import shutil
import subprocess
import sys
import tempfile
import time
import wave

from flask import Flask, jsonify, request
from vosk import KaldiRecognizer, Model, SetLogLevel

app = Flask(__name__)
VERBOSE = False
# El modelo se carga una sola vez al arrancar (antes se cargaba en cada petición: varios
# segundos por frase).
MODEL = None


def log(msg):
    print(f"[vosk] {msg}", flush=True)


def needs_conversion(path):
    with wave.open(path, "rb") as wf:
        return wf.getnchannels() != 1 or wf.getframerate() != 16000 or wf.getsampwidth() != 2


def convert_to_mono_16k(src, dst):
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("el WAV no es mono 16 kHz 16-bit y ffmpeg no está instalado para convertirlo")
    subprocess.check_call(
        [ffmpeg, "-y", "-loglevel", "error", "-i", src, "-ar", "16000", "-ac", "1", "-acodec", "pcm_s16le", dst]
    )


def recognize(path):
    with wave.open(path, "rb") as wf:
        rec = KaldiRecognizer(MODEL, wf.getframerate())
        while True:
            data = wf.readframes(4000)
            if not data:
                break
            rec.AcceptWaveform(data)
        return json.loads(rec.FinalResult()).get("text", "")


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"ok": MODEL is not None})


@app.route("/transcribe", methods=["POST"])
def transcribe():
    if "file" not in request.files:
        return jsonify({"error": "no file provided"}), 400

    t0 = time.time()
    # Temporales propios (nunca el nombre que manda el cliente) y siempre borrados al final.
    with tempfile.TemporaryDirectory(prefix="duende_vosk_") as tmp:
        src = os.path.join(tmp, "input.wav")
        request.files["file"].save(src)
        try:
            path = src
            if needs_conversion(src):
                path = os.path.join(tmp, "converted.wav")
                convert_to_mono_16k(src, path)
            text = recognize(path)
        except wave.Error as e:
            return jsonify({"error": "invalid wav", "detail": str(e)}), 400
        except Exception as e:  # noqa: BLE001 - se devuelve al bot, que lo registra
            log(f"error transcribiendo: {e}")
            return jsonify({"error": "transcription failed", "detail": str(e)}), 500

    if VERBOSE:
        log(f"transcrito en {time.time() - t0:.2f}s: {text!r}")
    return jsonify({"text": text})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True, help="carpeta del modelo Vosk")
    parser.add_argument("--port", type=int, default=5001)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--verbose", action="store_true", help="registrar cada petición y transcripción")
    args = parser.parse_args()

    global VERBOSE
    VERBOSE = args.verbose
    # Sin el aviso de "development server" ni una línea por petición: el servidor solo escucha
    # en local y lo usa el bot. Con --verbose vuelven los logs de peticiones.
    logging.getLogger("werkzeug").setLevel(logging.INFO if args.verbose else logging.ERROR)
    import flask.cli
    flask.cli.show_server_banner = lambda *a, **k: None

    if not os.path.isdir(args.model):
        log(f"no existe el modelo en {args.model}")
        sys.exit(1)

    global MODEL
    SetLogLevel(-1)
    t0 = time.time()
    MODEL = Model(args.model)
    print(f"Vosk listo · {os.path.basename(os.path.normpath(args.model))} · {time.time() - t0:.1f} s · {args.host}:{args.port}", flush=True)
    app.run(host=args.host, port=args.port)


if __name__ == "__main__":
    main()
