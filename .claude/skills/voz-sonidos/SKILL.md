---
name: voz-sonidos
description: Voz y sonidos de El Duende (@discordjs/voice): /conectar y su presencia, /sonidos (cola, cooldown, silencio, eventos), /tts y Gemini TTS, /escuchar y notas de voz con Vosk (STT), la respuesta hablada del Duende y /conversación con Gemini Live. Cárgala siempre que la tarea toque src/commands/voz/, src/systems/sonidos*, src/systems/presencia.js u ocupacion.js, src/services/geminiTts.js, stt.js, notaDeVoz.js, src/services/duende/voz.js, liveVoz* o mezclador.js, o 🔊 Sonidos del panel admin, o revise un cambio ahí. No la cargues para el chat de texto del Duende.
---

Todo lo que entra en un canal de voz comparte una sola conexión por servidor. Quién manda en ella y quién está usando el audio son las dos piezas que no se pueden romper. Mapa completo en `references/mapa.md`.

## Reglas no negociables

1. **La conexión de `/conectar` es de su presencia** (`src/systems/presencia.js`). `/tts`, el Duende por voz, `/conversación` y `/sonidos` la reutilizan en su canal o se niegan, y **nunca la destruyen** (`presencia.esDePresencia`). Solo una conversación en directo la sustituye.
2. **Quien usa el audio se apunta en `src/systems/ocupacion.js`** al cargarse (`ocupacion.registrar(nombre, ocupa, reintento)`): hoy `sonidos`, `tts` y `conversacion`. Un consumidor nuevo se apunta igual; así la presencia no sale a mitad y no hay ciclos de dependencias.
3. **No pises otra voz**: sin presencia, si ya hay una conexión en el servidor (`getVoiceConnection`), se contesta «Estoy en otra conversación de voz» y no se entra. Antes de entrar, comprobar permisos `Connect` y `Speak`.
4. **Quien abre una conexión propia la cierra** en un `finally`, salvo que sea la de la presencia. Todo lo que suena tiene tope de tiempo (`TIEMPO_MAX_MS` en sonidos, `VOICE_PLAYBACK_MAX_MS` en la voz del Duende).
5. **Gemini Live cuesta mientras esté abierta**: el corte por inactividad (`IDLE_DISCONNECT_MS`) y el tope de duración (`MAX_DURATION_MS`) son obligatorios. Una conversación en directo a la vez por servidor.
6. **Sonidos**: un sonido a la vez por servidor; lo que llega con otro sonando espera en la cola (`MAX_COLA`), cooldown por persona (`COOLDOWN_MS`, salvo admins), horario de silencio y permisos por rol. Límites de subida: `MAX_SONIDOS` por servidor, `MAX_BYTES` (1 MB), `.mp3`/`.ogg`/`.wav`, nombre de hasta `NOMBRE_MAX`. Ficheros en `SONIDOS_DIR` o `DATA_DIR/sonidos/<guildId>`, nunca en la raíz.
7. **Audio temporal** (STT, notas de voz) en `os.tmpdir()` y borrado al acabar; no se guarda nada. La transcripción de `/conversación` vive solo en memoria hasta el resumen.
8. **Dependencias inyectables**: las funciones de voz aceptan `deps` (`unirse`, `esperarListo`, `getConnection`, `presencia`…) para los tests; respeta ese patrón en lo nuevo.
9. **DAVE y Node**: `@discordjs/voice` ≥ 0.19 (con DAVE) y Node ≥ 22.12; `tests/dependenciasVoz.test.js` lo vigila junto con el `FROM` del `Dockerfile`. No bajes ninguno.
10. Variables de voz (`GEMINI_TTS_*`, `DUENDE_TTS_VOICE`, `STT_*`, `LOCAL_STT_URL`, `DUENDE_LIVE_*`): si añades una, va en `.env.example` y en `docs/DEPLOY.md`.

## Tests

Carga `estandar-tests`. Nunca Discord, Gemini ni Vosk reales: `deps` falsos para unirse y reproducir (`tests/sonidos.test.js`, `tests/presencia.test.js`) o `jest.mock` de `@discordjs/voice`, `prism-media` y `geminiClient` (`tests/liveVoz.test.js`, `tests/sttCobertura.test.js`). Comprueba que la conexión de la presencia sigue viva al terminar y que la propia se destruye.

## Prueba manual

Cualquier cambio de voz necesita prueba en Discord (`docs/planificacion/TAREAS.md`). Sin entrar a un canal: `/paneladmin` → 🩺 Sistema → 🔊 Probar voz; en local, `npm run voz:test` y `npm run stt:test`.
