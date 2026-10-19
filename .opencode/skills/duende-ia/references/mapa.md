# Mapa del Duende

## Servicios (`src/services/duende/`)

| Fichero | Qué hace |
|---|---|
| `gemini.js` | `generarConGemini(parts, options)`: `configuracionBase` (systemInstruction, `safetySettings` en `BLOCK_NONE`, herramientas por canal), bucle de hasta `DUENDE_MAX_TOOL_ROUNDS = 4` vueltas, `ejecutarHerramientas` (solo nombres propios del mapa con `Object.hasOwn`), `avisarSiAlucina`, `comprobarModelo`, `modeloDe(guildId)`. `thinkingBudget: 0` para frases cortas. |
| `chat/hablar.js` | El turno: `puedeResponder` (canal permitido, cuotas), `montarPartes`, `contextoDeHerramientas`, `entregarRespuesta`. |
| `chat/contexto.js` | Configuración del servidor, instrucciones, perfiles e historial del prompt. |
| `chat/generar.js` | `checkAndIncrementDailyLimit`, recortes (`limitToSentences`) y `pedirRespuestaGemini` con el reintento seguro. |
| `chat/enviar.js` | `safeEditReply`, recorte a 2000 caracteres, GIF, voz. |
| `herramientas.js` + `herramientas/` | `base.js` (resolución de personas, `proponer`), `core.js` (nivel, saldo, logros, precio TTCL, dado, jugadas…, solo de quien habla), `economia.js` (proponer reto, apuesta o préstamo), `imagen.js`, `plex.js`, `plexTrofeos.js`, `seerr.js`. |
| `imagenGemini.js` | `/imagen` por REST `generateContent` con reintentos ante 503/429. |
| `embeddings.js` | Vectores para `perfiles.notasRelevantes`. |
| `resumenCanal.js` | Resumen de 1 a 200 mensajes, sin menciones ni enlaces. |
| `voz.js`, `liveVoz*`, `mezclador.js` | Voz: ver la skill `voz-sonidos`. |

## Sistemas (`src/systems/duende/`)

- `config.js`: lo que viene de `.env` (`GEMINI_MODEL`, `DUENDE_MAX_TOKENS`, `DUENDE_MAX_TOKENS_FALLBACK`, `DUENDE_DAILY_LIMIT`, `DUENDE_DAILY_LIMIT_USER` (15 por defecto), `DUENDE_LOG_FULL_PROMPT`…).
- `cuotas.js`: `consumir([[clave, tope]…])` todo o nada, `devolver`, día de Madrid.
- `memoria.js`: `conversationHistory` por canal, `guardarDiferido`, `saveHistory`.
- `perfiles.js` (+ `perfiles/`): personalidades, perfiles por Discord ID, notas de `/duende recuerda`, personalidad por canal (migración 008).
- `personas.js`: `resolveNameToDiscordId`, `mentionizeKnownNames`, `buildPersonProfileText`. Los apodos, en `systems/apodos.js` (tabla `duende_apodos`).
- `tono.js`: madrugada y canales formales (apagado por defecto).
- `modeloGemini.js`: cambio automático de modelo al arrancar (`GEMINI_FALLBACK_MODELS`), con alerta a admins y auditoría.
- `espontaneo.js`, `recuerdosAuto.js`, `imagenes.js` (cooldown 45 s y `IMAGE_GEN_DAILY_LIMIT`), `trabajo.js`.

## Comandos

`src/commands/duende/`: `duende.js`, `imagen.js`, `imagenes.js`, `resumen.js`, `bola8.js`, `javier.js`. Panel de personalidades y perfiles: `src/adminPanel/perfilesDuende.js`; apodos: `src/adminPanel/apodos.js`.

## Ajustes por servidor

`duende.model`, `duende.temperature`, `duende.history_limit`, `duende.allowed_channel_id`, `duende.espontaneo_enabled`, `duende.espontaneo_channel_id`, `duende.madrugada_*`, `duende.canales_formales` (ver `src/systems/guildSettings/definicion.js`).

## Añadir una herramienta

1. Declaración (`name`, `description` que diga cuándo usarla y qué no inventar, `parameters` con `SchemaType`) y ejecutor `async (args, ctx, d = REALES)` en el fichero de su dominio.
2. Añadirla al mapa de ejecutores de `herramientas.js` y, si es de un grupo nuevo, decidir en `configuracionBase` dónde se declara.
3. Validar los `args` (el modelo puede mandar cualquier cosa) y devolver `{ error }` si no valen.
4. Tests del ejecutor con dobles, incluido el caso de nombre que no resuelve.
