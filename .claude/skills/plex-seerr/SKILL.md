---
name: plex-seerr
description: Integración de Plex (vía Tautulli) y Seerr (Jellyseerr) en El Duende: clientes, vínculos, historial, fichas, idiomas, logros y trofeos de Plex, novedades, rankings y pedidos de Seerr. Cárgala siempre que la tarea toque src/services/tautulliClient.js, src/services/seerrClient.js, src/systems/plex*, pedidosSeerr o seerrCupo, las herramientas de Plex/Seerr del Duende o 🎬 Plex / 🍿 Seerr del panel admin, o revise un cambio ahí. No la cargues para el resto del Duende sin Plex ni Seerr.
---

La documentación de referencia es `docs/tecnico/PLEX_Y_SEERR.md` (arquitectura, herramientas, guardarraíles, sincronización y trofeos). Léela antes de decidir; el resumen operativo está en `references/mapa.md`.

## Reglas no negociables

1. **Las APIs externas solo en `src/services/`**: `tautulliClient.js` (query `apikey`, respuesta `{ response: { result, data } }`) y `seerrClient.js` (cabecera `X-Api-Key`). Configuración: override por servidor en `guildSettings` (`plex.tautulli_url`/`plex.tautulli_api_key`, `seerr.url`/`seerr.api_key`) y, si no, `.env`. Las claves pasan por `registerSecret` antes de usarse.
2. **Nunca un ID inventado por el modelo.** Las personas se resuelven por nombre con `resolveNameToDiscordId` contra miembros reales del servidor y luego `plexLinks` (vínculos que pone un admin). El `tmdbId` de un pedido solo vale si sale de `buscar_contenido_seerr` en ese mismo canal en los últimos 15 min (`getCachedSearchResult`).
3. **Pedir en Seerr es la única escritura externa**: antes de crear, atajo si ya está disponible o pedido (estados 2–5); el cupo diario es de **quien habla** (`seerrCupo`, scope `seerr_request`, compartido con el 📥 de 🎯 Para ti), se comprueba antes y solo se gasta si Seerr acepta.
4. **Atribución en Seerr**: primero el Discord ID del perfil de Seerr (`resolveSeerrUserByDiscordId`) y, si no, el `plexUsername` vinculado. Si no se resuelve, error legible: nunca se pide a nombre de nadie sin identificarlo.
5. **Canales permitidos** por separado para Plex y Seerr (`isChannelAllowed`, lista vacía = sin restricción). En un canal no permitido las herramientas ni se declaran al modelo.
6. **Solo lectura en Plex**: las herramientas de Plex no escriben nada. Cortar streams (`terminate_session`) está descartado para la IA (sección 4.7 del documento).
7. **Errores y caídas**: un fallo de Tautulli o Seerr devuelve `{ error }` legible al Duende o se registra en el log; nunca se dan por perdidas fichas si Plex está caído (comprobación previa en `plexFichas`). Las excepciones de Tautulli con respuesta llevan `respuestaDeTautulli: true`.
8. **Sin backfill**: el canal de novedades fija una línea base la primera vez y solo anuncia lo nuevo.
9. **Privacidad**: entre amigos no hay restricciones de quién consulta a quién, pero se respeta a quien oculta sus logros (`plex_preferencias`) y los trofeos solo los ve quien los tiene, salvo los de admin.
10. Un ajuste nuevo de `plex.*` o `seerr.*` va en `definicion.js` (`DEFAULT_FLAT` y `KEY_TYPES`) y en su panel; un cambio de tabla, con `migracion-sqlite`.

## Tests

Carga `estandar-tests`. Nunca Tautulli, Seerr ni TMDB reales: `jest.mock` del cliente (`tests/plexHistorial.test.js`, `tests/pedidosSeerr.test.js`), dobles inyectados en las herramientas (`d = REALES_SEERR`, `tests/seerrHerramientasCobertura.test.js`) o un servidor HTTP falso (`tests/plexTautulliHttp.test.js`). Para carga, `tests/plexTrofeosCarga.test.js`.

## Al terminar

Si cambia el diseño, el flujo o una decisión, actualiza `docs/tecnico/PLEX_Y_SEERR.md` además de los documentos de siempre.
