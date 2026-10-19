---
name: duende-ia
description: El Duende y la IA de El Duende (Gemini): chat, prompt y contexto, historial, personalidades y perfiles, herramientas (function calling), cuotas diarias, cambio automático de modelo, imágenes, resumen de canal, mensajes espontáneos, recuerdos automáticos y /trabajar. Cárgala siempre que la tarea toque src/services/duende/ (salvo la voz), src/systems/duende/, src/services/geminiClient.js o src/commands/duende/, o revise un cambio ahí. Para herramientas de Plex o Seerr carga también plex-seerr; para la voz, voz-sonidos.
---

El bucle de Gemini está en `src/services/duende/gemini.js`; el turno de chat, en `src/services/duende/chat/` (`hablar` → `contexto` → `generar` → `enviar`); las piezas sin API (configuración, cuotas, memoria, perfiles, personas, tono), en `src/systems/duende/`. Mapa completo en `references/mapa.md`.

## Reglas no negociables

1. **Un solo cliente de Gemini**: `src/services/geminiClient.js` (SDK `@google/genai`). No crees otro cliente ni llames a la API desde un comando o un sistema.
2. **El `userId` y el `guildId` salen siempre del contexto real** (`toolContext`), nunca de algo que diga el modelo. A otras personas solo se llega por nombre con `resolveNameToDiscordId` contra miembros reales.
3. **Herramientas**: declaración + ejecutor en `src/services/duende/herramientas/<dominio>.js` y exportadas por la fachada `herramientas.js`. Solo se declaran donde se pueden usar (Plex/Seerr en canales permitidos, economía con `ctx.propuestas`, imagen con `ctx.imagenes`). Un ejecutor devuelve datos o `{ error }` legible; no lanza para el usuario. Sus dependencias van inyectables (`d = REALES_…`) para los tests.
4. **Ninguna herramienta mueve dinero ni escribe en el bot**: las de 🧙 economía solo **proponen** (`proponer`, como mucho 3 por respuesta) y el dinero se mueve solo si la persona pulsa ✅. La única escritura externa es el pedido de Seerr, con sus guardarraíles (`plex-seerr`).
5. **Topes**: como mucho `DUENDE_MAX_TOOL_ROUNDS` vueltas de herramientas. Cuotas diarias persistentes en `systems/duende/cuotas.js` (`chat:global`, `chat:<persona>`, `imagen:<persona>`; 0 apaga el tope). Un fallo de la API de imagen devuelve el cooldown y el cupo.
6. **«Usa las herramientas» va en el `systemInstruction`** (`configuracionBase`), no en el texto de una personalidad, para que una personalidad nueva no lo anule.
7. **Nunca lanza al usuario**: `pedirRespuestaGemini` reintenta con un prompt seguro (y con herramientas) si Gemini bloquea por `PROHIBITED_CONTENT`; si falla de otra forma, texto de disculpa.
8. **Modelo**: el del servidor (`duende.model`) o `GEMINI_MODEL`. `modeloGemini.js` lo cambia solo si el modelo no existe o no usa herramientas; un fallo de cuota, red o timeout solo se avisa.
9. **Nada se guarda en un perfil sin un admin**: los recuerdos automáticos llegan por DM a los admins con ✅/❌.
10. **Historial en memoria** (`systems/duende/memoria.js`, `data/duende-history.json`): editar el JSON con el bot en marcha no sirve; el guardado sobrescribe con la copia en memoria.
11. **Respuestas a Discord**: nunca más de 2000 caracteres (`chat/enviar.js`); los nombres conocidos se convierten en menciones con `mentionizeKnownNames`, no a mano. Un ajuste nuevo de `duende.*` va en `definicion.js` y en ⚙️ Config Global → 🤖 Duende.

## Tests

Carga `estandar-tests`. Gemini nunca de verdad: `jest.mock("../src/services/geminiClient")` (`tests/duende.test.js`) o `jest.mock("../src/services/duende/gemini")` (`tests/duendeFase11.test.js`). Herramientas con dobles inyectados (`tests/herramientasDuendeInyeccion.test.js`). Comprueba que un nombre que no resuelve devuelve `{ error }` y que no se inventa un id.

## Revisión

Una herramienta que acepta un id del modelo, mueve dinero sin el ✅ de la persona o llama a Gemini fuera de `services/` es **Alto** como mínimo.
