# El Duende — instrucciones del proyecto

## Equipo de agentes

- `orquestador` (`primary`): producto, roadmap y decisiones. No escribe código; solo documentación en `docs/**`.
- `explorador` (`all`, solo lectura): mapea el estado actual y propone oportunidades sin decidir el roadmap. Se puede seleccionar directamente o lanzar como subagente.
- `desarrollador` (`all`): implementa en este repositorio, añade tests y ejecuta `npm run check`.
- `revisor` (`all`, solo lectura): audita cambios, riesgos, tests y convenciones. Se puede seleccionar directamente o lanzar como subagente.

Flujo recomendado: `orquestador` → `explorador` (si falta contexto) → `desarrollador` → `revisor` → `orquestador` para decidir y cerrar.

## Skills del proyecto y enrutado

Cada agente tiene permitidas solo las skills de su ámbito. No se carga una skill “por si acaso”: se carga cuando la tarea entra en su fila.

| Tarea | Skill | Agente(s) |
|---|---|---|
| Escribir, modificar o revisar tests | `estandar-tests` | `desarrollador`, `revisor`; `explorador` solo para mapear cobertura |
| Configurar OpenCode (agentes, skills, plugins, MCP) | `opencode` | `orquestador`, `desarrollador` |
| Reportar un bug de OpenCode | `report` | `orquestador` |
| Producto, roadmap, ideas, decisiones | — (prompt del orquestador) | `orquestador` |
| Explorar estado, arquitectura y oportunidades | — (prompt del explorador) | `explorador` |
| Migración de BD | `migracion-sqlite` | `desarrollador`, `revisor` |
| Comando nuevo | `comando-discord` | `desarrollador` |
| Panel, botones o modales | `panel-discord` | `desarrollador`, `revisor` |
| Documentación del proyecto | `docs-proyecto` | `desarrollador`, `orquestador` |
| Git, ramas y PR | `git-pr` | `desarrollador` |
| Economía y dinero | `economia-dinero` | `desarrollador`, `revisor` |
| Apuestas y liquidación | `apuestas-liquidacion` (prevista) | `desarrollador`, `revisor` |
| Plex y Seerr | `plex-seerr` (prevista) | `desarrollador`, `revisor` |
| Duende e IA | `duende-ia` (prevista) | `desarrollador`, `revisor` |
| Voz y sonidos | `voz-sonidos` (prevista) | `desarrollador`, `revisor` |
| Cripto TTCL | `cripto-ttcl` (prevista) | `desarrollador`, `revisor` |
| Panel de administración | `admin-panel` (prevista) | `desarrollador`, `revisor` |
| Despliegue y Docker | `despliegue-docker` (prevista) | `desarrollador`, `revisor` |

`opencode` y `report` son skills **integradas** de OpenCode: no viven en `.opencode/skills/` y no hay que crearlas. Se mantienen en los permisos de los agentes que las usan.

Reglas:

- Carga la skill **solo** si la tarea entra en su fila, y hazlo sin esperar a que te lo pidan: cada agente la activa en cuanto ve que la tarea es suya. Si entran varias, cárgalas todas, empezando por la más específica.
- La activación automática depende de la `description` de cada `SKILL.md`: debe decir cuándo cargarla («Cárgala siempre que…») y cuándo no.
- Si no hay skill aplicable, trabaja con el prompt del agente y este `AGENTS.md`.
- No cargues una skill para una tarea que no sea suya; el permiso `skill` de cada agente ya lo impide.
- Al crear una skill nueva: añádela a esta tabla y a los permisos `skill` de los agentes que deban usarla.
- Formato que exige OpenCode: la skill vive en `.opencode/skills/<nombre>/SKILL.md` y su `name` es ese mismo `<nombre>` (minúsculas y guiones). Los permisos de cada agente van en `permission:` (singular) con las claves `edit`, `bash`, `task` y `skill`; gana la última regla que coincide, así que `"*"` va primero.
- Mantén `SKILL.md` corto (reglas y un índice) y deja el detalle en `references/`, para que cargar la skill cueste poco contexto.
- La única copia de los agentes y de las skills propias del proyecto es `.opencode/` de este repositorio; las integradas (`opencode`, `report`) vienen con OpenCode. Abre OpenCode en la raíz del repositorio.

## Dónde está el código

- Este repositorio es `bot-discord` (git, Node >= 22.12, CommonJS, Discord.js v14, better-sqlite3, Jest, ESLint y Prettier).
- Salvo que se indique otra cosa, trabaja siempre dentro de este repositorio.
- Los comandos se ejecutan en la raíz del repositorio.

## Documentación que hay que leer antes de decidir o tocar código

- `docs/SIGUIENTES_PASOS.md`: estado actual, prioridades y decisiones abiertas.
- `docs/planificacion/PLAN_ISSUES.md`: orden de trabajo por fases.
- `docs/planificacion/PUNTUACION.md`: auditoría y estándar de calidad.
- `docs/planificacion/ERRORES.md` y `DEUDA_TECNICA.md`: problemas conocidos.
- `docs/FUNCIONALIDADES.md`: qué hace el bot y qué comandos existen.
- `README.md` y `CONTRIBUTING.md`: estructura, convenciones y flujo de ramas.

No des por hecho el contenido de memoria: si un dato importa, léelo del repositorio. Algunos números de la documentación pueden estar desfasados; por ejemplo, para migraciones comprueba siempre el número más alto real en `src/core/migrations/`.

## Comandos

Dentro del repositorio:

- `npm test` — Jest, con BD en memoria.
- `npm run check` — ESLint + Prettier + Jest. Es la verificación obligatoria antes de dar algo por terminado.
- `npm run lint`, `npm run format`, `npm run format:check`.
- `npm run db:check`, `npm run db:backup` — solo cuando haga falta; nunca tocar la BD real sin permiso.

## Arquitectura y convenciones clave

- Dependencias: `commands` → `systems`/`services`; nunca al revés.
- Los mensajes/embeds/botones van en `src/paneles/`; los comandos solo reparten.
- La lógica compartida va en `src/systems/`; las APIs externas en `src/services/`.
- Rutas siempre desde `src/core/paths.js`, nunca relativas al fichero.
- Logs con `require("../../core/logger").createLogger("Módulo")`.
- Dinero: todo movimiento pasa por `src/systems/dinero.js`. Excepciones documentadas: `systems/casinoTransactions.js` y `adminPanel/bank.js`.
- Base de datos: ninguna tabla se crea desde un comando. Cambios de esquema = migración nueva en `src/core/migrations/NNN_nombre.js`. Nunca editar una migración ya aplicada.
- Ajustes por servidor: `src/systems/guildSettings/definicion.js` (`DEFAULT_FLAT` y `KEY_TYPES`) + control en el panel admin.
- Botones/menús/modales: `componentHandlers` con prefijos propios; cada `customId` debe ser único en el mensaje.
- Límites de Discord: 5 botones por fila, 5 filas por mensaje, 45 caracteres de etiqueta en modales.
- ESLint limita `src/` a 60 líneas por función y 400 por fichero. No subir el límite: partir el fichero y mantener fachadas cuando sea necesario.
- Nada de escribir ficheros en la raíz del proyecto: datos en `data/`, logs en `logs/`, temporales en la carpeta temporal del sistema.
- Los tests usan BD en memoria y no tocan Discord, Odds API, Tautulli, Seerr, TMDB ni Gemini.
- Mensajes de usuario, documentación y commits en español.

## Flujo de trabajo

- Ramas: `feature/<issue>-algo-corto` o `fix/<issue>-algo-corto` desde `developer`; PR contra `developer`; `developer` → `main` con merge commit.
- Nunca push directo a `main` ni a `developer`.
- Antes de commit: `npm run check` en verde.
- Cada cambio: apuntarlo en `docs/CHANGELOG.md`; si cambia lo que ve el usuario, también en `docs/FUNCIONALIDADES.md`; si requiere prueba manual en Discord, en `docs/planificacion/TAREAS.md`; si añade migración o variable de entorno, en `docs/DEPLOY.md`.

## Seguridad

- No leer, imprimir ni commitear secretos. `.env.example` sí se puede leer; `.env` no.
- No tocar `data/banco.db`, `logs/`, `models/` ni credenciales.
- No ejecutar comandos destructivos (`git reset --hard`, `git clean -fd`, borrados recursivos, `npm publish`) sin autorización explícita.
