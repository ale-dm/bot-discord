# Node 22: @discordjs/voice 0.19 (DAVE, el cifrado de voz que Discord exige desde marzo de 2026) pide Node >= 22.12.
FROM node:22-bookworm-slim

WORKDIR /app

# Dependencias del sistema:
# - build tools para módulos nativos: better-sqlite3 (las gráficas de /cripto ya no usan canvas). Opus va con
#   opusscript (JavaScript puro), sin compilar nada.
# - python3-venv + ffmpeg para el servidor Vosk (STT); ffmpeg convierte el audio a WAV mono 16 kHz
# - tini como PID 1 para reenviar señales (parada ordenada) al bot y a Vosk
# - curl/unzip para descargar el modelo de Vosk
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 \
        python3-venv \
        make \
        g++ \
        pkg-config \
        libcairo2-dev \
        libpango1.0-dev \
        libjpeg-dev \
        libgif-dev \
        librsvg2-dev \
        ffmpeg \
        tini \
        curl \
        ca-certificates \
        unzip \
    && rm -rf /var/lib/apt/lists/*

# Servidor Vosk en su propio venv (no se mezcla con el python del sistema)
COPY vosk/requirements.txt /tmp/vosk-requirements.txt
RUN python3 -m venv /opt/vosk \
    && /opt/vosk/bin/pip install --no-cache-dir -r /tmp/vosk-requirements.txt

# Modelo de Vosk en español (~40 MB). Va en su propia capa para que la caché de Docker
# no lo vuelva a descargar en cada build.
ARG VOSK_MODEL=vosk-model-small-es-0.42
RUN mkdir -p /app/models \
    && curl -fsSL "https://alphacephei.com/vosk/models/${VOSK_MODEL}.zip" -o /tmp/model.zip \
    && unzip -q /tmp/model.zip -d /app/models \
    && rm /tmp/model.zip

# Copiar manifiestos primero para aprovechar la caché de capas de Docker
COPY package*.json ./
RUN npm install --omit=dev

# Copiar el resto del código (lo que excluye .dockerignore: datos, logs, docs, tests...)
COPY . .
RUN chmod +x deploy/docker-entrypoint.sh

ENV LOCAL_STT_URL=http://127.0.0.1:5001/transcribe

# Registra los slash commands, arranca Vosk y después el bot
ENTRYPOINT ["/usr/bin/tini", "-g", "--"]
CMD ["deploy/docker-entrypoint.sh"]
