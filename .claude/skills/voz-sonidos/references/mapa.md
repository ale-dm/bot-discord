# Mapa de la voz

## Comandos (`src/commands/voz/`)

| Comando | Qué hace | Piezas |
|---|---|---|
| `/conectar` (`conectar.js`) | El bot se queda en un canal 15, 30, 60 o 120 min (30 por defecto). Sin canal: sale o renueva. | `systems/presencia.js` |
| `/sonidos` (`sonidos.js`) | Panel público de sonidos del servidor. | `systems/sonidos.js` y `systems/sonidos/` |
| `/tts` (`tts.js`) | El bot dice un texto. Se apunta como ocupante `tts`. | `services/geminiTts.js` |
| `/escuchar` (`escuchar.js`) | Escucha una frase, la transcribe con Vosk y el Duende contesta hablando; se re-arma durante `DUENDE_VOICE_ACTIVE_WINDOW_MS`. | `services/stt.js`, `commands/duende/duende.js` |
| `/conversación` (`conversacion.js`) | Audio bidireccional con Gemini Live; tertulia con varias personas. | `services/duende/liveVoz*`, `mezclador.js` |

## Servicios

- `services/geminiTts.js`: `GEMINI_TTS_MODEL` (por defecto `gemini-3.8-flash-tts`) y `GEMINI_TTS_FALLBACK_MODELS`; recuerda el último que funcionó. Los 3.x por la Interactions API (WAV), los 2.x por `generateContent` (PCM envuelto en WAV).
- `services/stt.js`: graba la siguiente intervención a un `.pcm` temporal y lo manda a `LOCAL_STT_URL` (Vosk, `http://127.0.0.1:5001/transcribe`). `STT_ONLY_USER_ID`, `STT_FIXED_USER_ID`, `STT_LISTEN_TIMEOUT_MS`.
- `services/notaDeVoz.js`: notas de voz del chat (hasta 60 s) → ffmpeg a WAV temporal → Vosk → el Duende contesta al texto.
- `services/duende/voz.js`: respuesta hablada del Duende; limpia el texto (emojis, enlaces, formato) y lo corta a `MAX_CARACTERES_VOZ = 200`. Si hay presencia en otro canal, no se mueve.
- `services/duende/liveVoz.js` (+ `liveVoz/`): `constantes.js` (modelo, voz, `IDLE_DISCONNECT_MS` 5 min, `MAX_DURATION_MS` 30 min, `FIN_TURNO_TERTULIA_MS`, palabra «duende»), `sesion.js` (una por servidor, ocupante `conversacion`), `conexion.js`, `captura.js`, `mensajes.js` (herramientas y «colgar»), `declaraciones.js`, `resumen.js` (resumen al colgar, solo en memoria).
- `services/duende/mezclador.js`: mezcla a 16 kHz mono 16 bits cada 20 ms; descarta lo más viejo si Gemini va lento.

## Sistemas

- `systems/presencia.js`: `actual(guildId)`, `esDePresencia(guildId, conexion)`, salida automática que espera a `ocupacion.esperaPendiente`.
- `systems/ocupacion.js`: `registrar`, `ocupado`, `esperaPendiente` (`REINTENTO_CORTO_MS` 10 s, `REINTENTO_LARGO_MS` 5 min).
- `systems/sonidos.js`: `listar`, alta y borrado (tabla `sonidos`), `tocarSegunPresencia`, `motivoNoSePuede`, cola. `systems/sonidos/`: `ajustes.js` (categoría, volumen, roles, reproducciones), `cola.js` (`MAX_COLA = 5`), `cooldown.js` (`COOLDOWN_MS` 10 s, en memoria), `eventos.js` (sonido ligado a un logro o una apuesta grande, `sonidos.eventos_minutos`), `silencio.js` (tramo en hora de Madrid, puede cruzar la medianoche).

## Panel admin

`src/adminPanel/sonidos.js` y `sonidosAjustes.js` (prefijo `paneladmin_sonidos_`): subir, borrar, categorías, volumen, roles, eventos y silencio.

## Imagen de Docker

El `Dockerfile` instala ffmpeg y un venv de Vosk con el modelo `vosk-model-small-es-0.42`; `deploy/docker-entrypoint.sh` arranca Vosk salvo `STT_ENABLED=0` (ver `despliegue-docker`).
