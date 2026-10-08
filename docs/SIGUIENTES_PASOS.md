# Siguientes pasos

Para quien coja el proyecto ahora: dónde está, qué comprobar primero y qué decisiones quedan abiertas. Actualizado el
2026-10-08. Si algo de aquí ya está hecho, borrarlo (y apuntarlo en el [CHANGELOG](CHANGELOG.md)).

Para entender el proyecto en general: [README](../README.md) (puesta en marcha y convenciones),
[FUNCIONALIDADES](FUNCIONALIDADES.md) (qué hace el bot), [DEPLOY](DEPLOY.md) (cómo se despliega) y
[FEATURES](planificacion/FEATURES.md) (ideas, con el estado de cada una).

## 1. Dónde estamos

- Todas las issues de la planificación están hechas: apuestas (combinadas, goles y hándicap, directo, liga de
  pronósticos, quinielas, retos), cripto (pool de liquidez, solo TTCL, panel con pestañas), tienda y Duende con panel,
  Plex (`/plex` con botones, trofeos por país, recomendaciones, sesión de cine, Wrapped privado por DM), pase de batalla,
  `/sonidos` y `/conectar`.
- Migraciones: hasta la `038_plex_wrapped_enviados`. La siguiente es la `039`.
- Los cabos sueltos de la revisión del 2026-10-08 están cerrados: `/ayuda` cubre `/plex`, `/sonidos`, `/conectar` y
  `/pase`; los logros completados dan XP de pase; en `/paneladmin` → ⚽ Apuestas están los premios de la liga; y
  Mis jugadas y Stats muestran las combinadas.
- `npm run check` (ESLint, Prettier y Jest) en verde. Los tests usan una BD en memoria y no tocan Discord, Odds API,
  Tautulli, Seerr, TMDB ni Gemini.
- No hay errores abiertos ([ERRORES](planificacion/ERRORES.md)). La deuda técnica está en
  [DEUDA_TECNICA](planificacion/DEUDA_TECNICA.md).

## 2. Lo primero, en este orden

1. **Probar en Discord** las listas de [TAREAS](planificacion/TAREAS.md). Hay unas 60 comprobaciones a mano sin marcar,
   sobre todo de lo que depende de Discord de verdad: `/sonidos` y `/conectar` (que el bot entre y salga del canal),
   la tertulia por voz del Duende (opt-in, si está activada en el servidor), las apuestas en directo (con `ODDS_DIRECTO=1`), el Wrapped
   por DM y los premios de la liga en `/paneladmin`.
2. **Comprobar las competiciones de la Odds API**: `ODDS_API_KEY=... node scripts/competicionesOdds.js`. Eurocopa, Copa
   del Rey y Europa League tienen claves sin verificar. El Mundial (`soccer_fifa_world_cup`) sí está confirmado. Si una
   clave no sale en `/v4/sports`, corregirla en `DEPORTES` de `src/services/oddsApi.js`.
3. **Ramas remotas viejas**: las ramas `feature/…` ya fusionadas siguen en GitHub. Borrarlas desde la web de GitHub
   (el proxy del entorno no deja borrarlas por git).
4. **Copia de seguridad** de `data/banco.db` antes de desplegar (`npm run db:backup` dentro del contenedor).
5. **Desplegar** desde `main` ([DEPLOY](DEPLOY.md)). Al arrancar se aplican las migraciones pendientes; en el log,
   `[Migraciones] Aplicada …`.
6. **Variables de entorno nuevas** que hay que tener en el `.env` del servidor para usar lo de estas semanas (ver
   `.env.example`): `TMDB_API_KEY` (trofeos por país), `SEERR_*` (recomendaciones y pedidos), `ODDS_DIRECTO`
   (apuestas en directo, opcional), `DUENDE_RECUERDOS_AUTO` y `DUENDE_RECUERDOS_MAX_DIA` (recuerdos automáticos),
   `SONIDOS_DIR` (opcional, si los sonidos no van en `DATA_DIR/sonidos`).

## 3. Decisiones pendientes

Ninguna de estas se ha implementado; cada una necesita una respuesta antes de tocar código.

- **Roles de Discord en el pase de batalla.** El diseño los proponía (moderación, emojis…) y no se han concedido, porque
  los permisos del servidor los decide el servidor. Si se quieren, se harían uno a uno y con confirmación explícita.
- **Recompensa del pase**: ahora son monedas (80…2.500, más un bonus de 2.000 al final). Se podría cambiar a TTCL.
- **Cancelar una combinada** antes de que empiece algún partido (hoy solo se cancelan apuestas sueltas).
- **Sonidos**: el próximo paso acordado es mejorar el funcionamiento de `/sonidos`. Antes de empezar, hay que decidir
  qué se quiere mejorar (ver el apartado 4).
- **Trofeos por país**: dependen de que Tautulli devuelva los `guid` `tmdb://`. Si no lo hace, los trofeos por país no
  salen.
- **Recomendaciones de Seerr**: se asume que `/{movie|tv}/{id}/recommendations` responde como en la documentación. Si
  devuelve otra cosa, el panel "🎯 Para ti" quedaría vacío sin error.

## 4. Ideas abiertas (sin empezar)

De [FEATURES](planificacion/FEATURES.md), en orden de esfuerzo estimado:

- Alertas de precio de TTCL por DM (S).
- Cancelar combinadas antes de que empiecen (S).
- Estadísticas de uso de los sonidos: cuáles se usan más (S).
- Sonido de entrada al usar `/conectar` (M).
- Estrenos de la semana en `/plex`, con 📥 para pedirlos (M).
- Resumen diario del canal del Duende (M).
- Historial de temporadas del pase (M).

## 5. Mapa de lo nuevo

| Fichero | Qué hace |
|---|---|
| `src/commands/plex/plex.js`, `src/paneles/plex.js` | `/plex` con botones: cine, para ti, Wrapped y perfil |
| `src/systems/plexWrapped.js` | Wrapped mensual privado: un DM por persona (día 1, desde las 10:00 de Madrid) |
| `src/systems/sonidos.js`, `src/systems/presencia.js` | Guardar y reproducir sonidos; la presencia de `/conectar` (30 min por defecto) |
| `src/commands/voz/sonidos.js`, `src/commands/voz/conectar.js` | `/sonidos` (tablero de botones) y `/conectar` |
| `src/adminPanel/sonidos.js` | `/paneladmin` → 🔊 Sonidos: subir (modal con archivo) y borrar |
| `src/systems/pase/pase.js`, `src/paneles/pase.js`, `src/commands/progresion/pase.js` | Pase de batalla; `/pase` |
| `src/systems/achievementsSystem.js` | Cada logro completado da XP de pase (no los de la importación de Plex) |
| `src/systems/apuestas/misJugadas.js`, `src/paneles/misJugadas.js` | Combinadas en 📋 Mis jugadas y en las estadísticas |
| `src/adminPanel/apuestas.js` | `/paneladmin` → ⚽ Apuestas, incluidos los premios de la liga |
| `src/systems/duende/recuerdosAuto.js` | Recuerdos automáticos del Duende (las admins deciden por DM) |

## 6. Recetas

- **Una migración nueva**: el siguiente número (`039_…`) en `src/core/migrations`, con `up(db)`. Nunca editar una que
  ya se haya aplicado en producción. Actualizar el número de migraciones en `tests/plexImportacion.test.js`.
- **Un comando nuevo**: el módulo en `src/commands/…`, con `data` y `run`, y su nombre en la lista de
  `tests/parte8Admin.test.js`. Si tiene botones, `componentHandlers` con un prefijo propio. Añadirlo a `/ayuda`
  (`src/commands/general/ayuda.js`) y a [FUNCIONALIDADES](FUNCIONALIDADES.md).
- **Un ajuste nuevo**: su clave y tipo en `src/systems/guildSettings.js` (las dos listas), y su control en el panel
  admin correspondiente.
- **Un logro de pase**: si el evento da XP de pase, usar `pase.registrarSeguro(guildId, userId, categoria, cantidad)`
  con una categoría de `CATEGORIAS` (`src/systems/pase/pase.js`), con su tope diario.

## 7. Convenciones (resumen)

- `npm run check` antes de cada commit (ESLint, Prettier y Jest).
- Cada cambio, en el [CHANGELOG](CHANGELOG.md) y, si cambia lo que ve la gente, en
  [FUNCIONALIDADES](FUNCIONALIDADES.md); lo que haya que probar a mano, en [TAREAS](planificacion/TAREAS.md); las
  migraciones, en [DEPLOY](DEPLOY.md).
- Discord limita las filas de botones (5 por fila, 5 filas por mensaje) y los textos de los modales (45 caracteres de
  etiqueta): revisarlo al añadir controles.
- Ojo con `node -e "require('./src/...')"` fuera de los tests: abre `data/banco.db` y aplica las migraciones pendientes.
  Para curiosear, `DB_PATH=:memory:` delante.
- Mensajes de commit en español, explicando el porqué.
