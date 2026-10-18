# Siguientes pasos

Para quien coja el proyecto ahora: dónde está, qué comprobar primero y qué decisiones quedan abiertas. Actualizado el
2026-10-18. Si algo de aquí ya está hecho, borrarlo (y apuntarlo en el [CHANGELOG](CHANGELOG.md)).

Para entender el proyecto en general: [README](../README.md) (puesta en marcha y convenciones),
[FUNCIONALIDADES](FUNCIONALIDADES.md) (qué hace el bot), [DEPLOY](DEPLOY.md) (cómo se despliega) y las ideas, que son
issues en GitHub con la etiqueta `feature-idea` ([FEATURES](planificacion/FEATURES.md) solo redirige allí).

## 1. Dónde estamos

- El [plan de las issues](planificacion/PLAN_ISSUES.md) está **terminado**: las 185 issues están cerradas. La última en
  caer ha sido la **fase 2**, los tres refactors de arquitectura: **#472** (`systems/` sin embeds ni Discord), **#474**
  (reglas de los juegos separadas de sus manejadores) y **#475** (herramientas del Duende con dependencias inyectadas).
- Última release a `main`: la fase 2 de refactor (#505, #506, #507), sobre la voz de `/conectar` (#499, #500) y los
  tests deterministas (#501), tras las fases 1-12 del plan restante (#496, #497). Todo en el [CHANGELOG](CHANGELOG.md).
- Migraciones: hasta la `070_admin_extras`. La siguiente es la `071`.
- `npm run check` (ESLint con límites de tamaño, Prettier y Jest) en verde: 2857 tests en 225 suites. Los tests usan una
  BD en memoria y no tocan Discord, Odds API, Tautulli, Seerr, TMDB ni Gemini.
- No hay errores abiertos ([ERRORES](planificacion/ERRORES.md)). La deuda técnica no tiene filas abiertas
  ([DEUDA_TECNICA](planificacion/DEUDA_TECNICA.md)); lo pendiente está en issues.

## 2. Lo primero, en este orden

1. **Desplegar** desde `main` ([DEPLOY](DEPLOY.md)): Portainer → Stacks → `el-duende` → **Pull and redeploy**. Al
   arrancar se aplican las migraciones pendientes; en el log, `[Migraciones] Aplicada …`.
2. **Copia de seguridad** de `data/banco.db` antes de desplegar (`npm run db:backup` dentro del contenedor).
3. **Comprobar las competiciones de la Odds API**: `ODDS_API_KEY=... node scripts/competicionesOdds.js`. Eurocopa, Copa
   del Rey y Europa League tienen claves sin verificar. El Mundial (`soccer_fifa_world_cup`) sí está confirmado. Si una
   clave no sale en `/v4/sports`, corregirla en `DEPORTES` de `src/services/oddsApi.js`.
4. **Variables de entorno nuevas** que hay que tener en el `.env` del servidor para usar lo de estas semanas (ver
   `.env.example`): `TMDB_API_KEY` (trofeos por país), `SEERR_*` (recomendaciones y pedidos), `ODDS_DIRECTO`
   (apuestas en directo, opcional), `DUENDE_RECUERDOS_AUTO` y `DUENDE_RECUERDOS_MAX_DIA` (recuerdos automáticos),
   `SONIDOS_DIR` (opcional, si los sonidos no van en `DATA_DIR/sonidos`).

## 3. Decisiones pendientes

Ninguna de estas se ha implementado; cada una necesita una respuesta antes de tocar código.

- **Roles de Discord en el pase de batalla.** El diseño los proponía (moderación, emojis…) y no se han concedido, porque
  los permisos del servidor los decide el servidor. Si se quieren, se harían uno a uno y con confirmación explícita.
- **Recompensa del pase**: ahora son monedas (80…2.500, más un bonus de 2.000 al final). Se podría cambiar a TTCL.

## 4. Ideas abiertas y plan

El [plan de las issues](planificacion/PLAN_ISSUES.md) está **terminado** y no quedan issues abiertas. A partir de aquí,
cada idea nueva se añade como issue con la etiqueta `feature-idea`; las decisiones pendientes de la sección 3 (roles y
recompensa del pase de batalla) siguen sin respuesta.

## 5. Mapa de lo nuevo

| Fichero | Qué hace |
|---|---|
| `src/commands/plex/plex.js`, `src/paneles/plex.js` | `/plex` con botones: cine, para ti, Wrapped y perfil |
| `src/systems/plexWrapped.js` | Wrapped mensual privado: un DM por persona (día 1, desde las 10:00 de Madrid) |
| `src/systems/sonidos.js`, `src/systems/presencia.js` | Guardar y reproducir sonidos; la presencia de `/conectar` (15, 30, 60 o 120 min) |
| `src/systems/ocupacion.js` | Quién ocupa el audio de un servidor: `/conectar` es el dueño y los demás reutilizan su conexión |
| `src/commands/voz/sonidos.js`, `src/commands/voz/conectar.js` | `/sonidos` (tablero de botones) y `/conectar` |
| `src/adminPanel/sonidos.js` | `/paneladmin` → 🔊 Sonidos: subir (modal con archivo) y borrar |
| `src/systems/pase/pase.js`, `src/paneles/pase.js`, `src/commands/progresion/pase.js` | Pase de batalla; `/pase` |
| `src/systems/achievementsSystem.js` | Cada logro completado da XP de pase (no los de la importación de Plex) |
| `src/systems/apuestas/misJugadas.js`, `src/paneles/misJugadas.js` | Combinadas en 📋 Mis jugadas y en las estadísticas |
| `src/adminPanel/apuestas.js` | `/paneladmin` → ⚽ Apuestas, incluidos los premios de la liga |
| `src/systems/duende/recuerdosAuto.js` | Recuerdos automáticos del Duende (las admins deciden por DM) |
| `src/systems/retos/` | Retos separados por tipo (crear, duelos, porras, partidos, cobros, persistencia y revisión). `systems/retos.js` es la fachada |
| `src/services/duende/chat/`, `src/paneles/duendeAcciones.js` | El flujo de «hablar» del Duende y las acciones de su panel. `commands/duende/duende.js` es la fachada del comando |
| `src/services/duende/liveVoz/` | Voz en directo: constantes, sesión, declaraciones de herramientas, conexión con Gemini y captura (la tertulia) |
| `src/systems/guildSettings/` | Ajustes: la lista (`definicion.js`), los valores, el acceso con caché, los permisos de comandos y los límites |
| `src/juegos/apuestas/quiniela/`, `src/systems/apuestas/liquidacion/` | Editor y botones de la quiniela; la liquidación en partes (caducidad, partidos, quinielas, orquesta y anuncios) |
| `src/paneles/perfil/` | Pantallas de `/perfil`: básicos, embeds, logros, ficha y rankings |
| `src/systems/apuestas/ranking.js`, `src/core/migrations/043_resumen_apuestas.js` | Ranking de apostadores: lee `apuestas_resumen`, que se reconstruye al terminar cada liquidación (`liquidacion/orquesta.js`) |
| `src/systems/casino/` | Reglas de ruleta, tragaperras, adivinar y ppt; los cobros del blackjack están en `systems/blackjackCobros.js` |
| `src/services/duende/` | Chat, voz en directo (`liveVoz/`), herramientas del Duende y la generación de imagen (`imagenGemini.js`) |
| `src/systems/plexFichas/`, `src/systems/plexTrofeos/`, `src/systems/duende/perfiles/` | Partes de Plex y de los perfiles del Duende, cada una en su módulo; la fachada conserva el nombre antiguo |
| `src/adminPanel/apuestas/`, `niveles/`, `plex/` | Vistas y botones de cada sección de `/paneladmin` |
| `src/paneles/retos*.js` | Retos: pestaña, pasos, mensaje público y piezas privadas; `paneles/retos.js` es la fachada |

Al partir un fichero, la fachada conserva los nombres que ya usaba el resto del código; así el resto no cambia.

## 6. Recetas

- **Una migración nueva**: el siguiente número libre (hoy el `071`) en `src/core/migrations`, con `up(db)`. Nunca editar
  una que ya se haya aplicado en producción. En `tests/plexImportacion.test.js` el número de migraciones se cuenta solo
  (`runMigrations(bd)`), así que no hay que tocarlo.
- **Un comando nuevo**: el módulo en `src/commands/…`, con `data` y `run`, y su nombre en la lista de
  `tests/parte8Admin.test.js`. Si tiene botones, `componentHandlers` con un prefijo propio. Añadirlo a `/ayuda`
  (`src/commands/general/ayuda.js`) y a [FUNCIONALIDADES](FUNCIONALIDADES.md).
- **Un ajuste nuevo**: su clave y tipo en `src/systems/guildSettings/definicion.js` (las dos listas, `DEFAULT_FLAT` y
  `KEY_TYPES`), y su control en el panel admin correspondiente.
- **Un logro de pase**: si el evento da XP de pase, usar `pase.registrarSeguro(guildId, userId, categoria, cantidad)`
  con una categoría de `CATEGORIAS` (`src/systems/pase/pase.js`), con su tope diario.

## 7. Convenciones (resumen)

- `npm run check` antes de cada commit (ESLint, Prettier y Jest).
- Merges: los PRs de una feature a `developer` se hacen con squash, como dice [CONTRIBUTING](../CONTRIBUTING.md); de `developer` a `main`, con merge commit.
- ESLint limita el tamaño en `src/` a 60 líneas por función y 400 por fichero, que es la meta de la puntuación (el catálogo de logros queda fuera por ser datos). No se sube el límite para pasar un fichero: se parte.
- Cada cambio, en el [CHANGELOG](CHANGELOG.md) y, si cambia lo que ve la gente, en
  [FUNCIONALIDADES](FUNCIONALIDADES.md); lo que haya que probar a mano, en [TAREAS](planificacion/TAREAS.md); las
  migraciones, en [DEPLOY](DEPLOY.md).
- Discord limita las filas de botones (5 por fila, 5 filas por mensaje) y los textos de los modales (45 caracteres de
  etiqueta): revisarlo al añadir controles.
- Ojo con `node -e "require('./src/...')"` fuera de los tests: abre `data/banco.db` y aplica las migraciones pendientes.
  Para curiosear, `DB_PATH=:memory:` delante.
- Mensajes de commit en español, explicando el porqué.
