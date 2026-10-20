# Imagen y arranque

## Ficheros

| Fichero | Qué hace |
|---|---|
| `Dockerfile` | `node:22-bookworm-slim`; paquetes del sistema (build tools para `better-sqlite3`, `ffmpeg`, `python3-venv`, `tini`, `curl`, `unzip`…); venv de Vosk en `/opt/vosk` con `vosk/requirements.txt`; modelo `vosk-model-small-es-0.42` (`ARG VOSK_MODEL`) en `/app/models`; `npm install --omit=dev`; `COPY . .`; `LOCAL_STT_URL=http://127.0.0.1:5001/transcribe`; `ENTRYPOINT ["/usr/bin/tini", "-g", "--"]` y `CMD ["deploy/docker-entrypoint.sh"]`. |
| `.dockerignore` | Fuera de la imagen: `node_modules`, `.git`, `.env`, `.env.*` (salvo `.env.example`), `stack.env`, `.claude`, `.vscode`, `data`, `logs`, `models`, `tmp`, `vosk/.venv`, `docs`, `tests`, `coverage`, `*.md`, audio y comprimidos. |
| `deploy/docker-entrypoint.sh` | `node src/discord/registerCommands.js` → Vosk (`VOSK_MODEL_PATH`, `VOSK_PORT` 5001) si `STT_ENABLED` es 1 (por defecto) → `exec node src/index.js`. Con `set -e`: si falla el registro de comandos, no arranca. |
| `deploy/portainer-stack.yml` | Stack del servidor: `build` desde la raíz del repo, `image: el-duende:latest`, `pull_policy: build` (reconstruye en cada «Pull and redeploy»), `env_file: ../stack.env`, `LOG_CONSOLE_LEVEL: info`, `restart: unless-stopped`, volúmenes `/compose/duende-bot/data` y `/compose/duende-bot/logs`. |
| `deploy/docker-compose.local.yml` | Lo mismo en local, con `../.env`, `../data` y `../logs`. |

## Qué hace el bot al arrancar y en marcha

- Aplica las migraciones pendientes (`src/core/migrations/`), registradas en el log como `[Migraciones] Aplicada NNN_…`.
- Si se reinició con partidas de casino a medias, devuelve lo apostado.
- Tareas programadas en `src/app/tareas.js` (hora de Madrid): liquidación de apuestas a los :15, copia de la BD a las 04:30 en `data/backups/banco-AAAA-MM-DD.db` (se guardan `BACKUP_KEEP`, 7 por defecto; si estaba caído, la hace al arrancar).
- `SIGTERM`/`SIGINT` → `shutdown` (vacía logs, cierra la BD). Un error no controlado sale con código 1 y Docker lo levanta (`unless-stopped`).

## Logs

`logs/app-log.txt`, `warn-log.txt`, `error-log.txt`, con rotación. `LOG_LEVEL` (por defecto `info`) y `LOG_CONSOLE_LEVEL` (por defecto `warn`; el stack lo pone a `info`). Se cambia en caliente en 🩺 Sistema. Las claves registradas con `registerSecret` se ocultan.

## Variables

La lista comentada está en `.env.example` (Discord, Gemini y el Duende, Odds API, Tautulli, Seerr, TMDB, voz, STT, Gemini Live, logs…). Rutas: `DATA_DIR` y `LOG_DIR` (por defecto `data/` y `logs/`, ver `src/core/paths.js`); `SONIDOS_DIR` para los sonidos. Las variables que ya no se usan se listan al final de `docs/DEPLOY.md`.

## Flujo de una actualización (lo hace el usuario)

1. `npm run check` y push de la rama de trabajo; PR a `developer`; `developer` → `main` con merge commit.
2. Copia de `banco.db` en el servidor.
3. Portainer → Stacks → `el-duende` → **Pull and redeploy**.
4. `docker logs -f duende-bot` y la lista de `docs/planificacion/TAREAS.md`.

Cambiar una variable: editarla en el stack y **Update the stack**. GitOps (polling) está disponible pero se recomienda no activarlo.
