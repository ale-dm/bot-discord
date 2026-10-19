---
name: despliegue-docker
description: Despliegue de El Duende: Dockerfile, .dockerignore, deploy/ (entrypoint, stack de Portainer, compose local), variables de entorno y la sección de despliegue de docs/DEPLOY.md. Cárgala siempre que la tarea cambie la imagen, el arranque del contenedor, los volúmenes, una dependencia nativa o del sistema, la versión de Node, una variable de entorno nueva o los pasos para desplegar o restaurar, o revise un cambio ahí. No la cargues para un cambio de código que no toca nada de eso (solo apunta su migración en DEPLOY.md, como dice migracion-sqlite).
---

El bot corre en Docker en el servidor **elements** como stack de Portainer construido **desde el repositorio** (`deploy/portainer-stack.yml`, rama `main`). El detalle está en `docs/DEPLOY.md`; el resumen técnico, en `references/imagen-y-arranque.md`.

## Reglas no negociables

1. **No despliegues tú.** Ni `git push` a `main` o `developer`, ni Portainer, ni `docker` contra el servidor. Desplegar es mergear `developer` → `main` y que alguien pulse **Pull and redeploy**; lo decide el usuario (`git-pr` para el flujo de ramas).
2. **Nada de datos dentro de la imagen**: `data/` y `logs/` son volúmenes (`/compose/duende-bot/data` y `/logs` → `/app/data`, `/app/logs`), y `.dockerignore` deja fuera `.env*` (salvo `.env.example`), `stack.env`, `data`, `logs`, `models`, `docs`, `tests` y `*.md`. Si añades una carpeta que no debe ir a la imagen, añádela ahí.
3. **Secretos solo en el stack** (Environment variables de Portainer → `stack.env`) o en `.env` local; nunca en el `Dockerfile`, los YAML ni la imagen. No leas `.env` ni `stack.env`.
4. **Node y voz van juntos**: `FROM node:22-bookworm-slim` porque `@discordjs/voice` 0.19 (DAVE) pide Node ≥ 22.12, igual que `engines` en `package.json`. `tests/dependenciasVoz.test.js` comprueba las dos cosas: si cambias una, cambia la otra.
5. **El arranque es `tini` → `deploy/docker-entrypoint.sh`**: registra los slash commands, arranca Vosk en segundo plano (salvo `STT_ENABLED=0`) y hace `exec node src/index.js`. Mantén `exec` y `tini -g` para que `SIGTERM` llegue al bot y a Vosk y la parada sea limpia (el bot cierra la BD en `shutdown`).
6. **Las migraciones se aplican solas al arrancar.** Cualquier migración, variable nueva o paso manual va en `docs/DEPLOY.md` con una sección `### <Qué> (migración NNN, AAAA-MM-DD)`, y la variable también en `.env.example` (comentada si es opcional).
7. **Antes de actualizar, copia de la BD** (`cp …/banco.db …/banco.db.bak-$(date +%F)`); para restaurar, parar el stack, sustituir `banco.db` y borrar `banco.db-wal` y `banco.db-shm`. No cambies esos pasos sin actualizar `docs/DEPLOY.md`.
8. **Un cambio de dependencias del sistema o de Node exige reconstruir la imagen**: `docker restart` sigue con la anterior. Dilo en `docs/DEPLOY.md`.
9. **Capas**: lo que cambia poco va antes (paquetes del sistema, venv y modelo de Vosk, `package*.json` + `npm install --omit=dev`) y el código al final, para no perder la caché. Sin dependencias de desarrollo en la imagen.

## Comprobar

- `npm run check` en verde siempre. Si cambias el `Dockerfile` o `deploy/`, prueba en local con `docker compose -f deploy/docker-compose.local.yml up --build` (usa el `.env`, `data/` y `logs/` del repo) solo si el usuario lo autoriza, y con el bot local parado si comparte token.
- En el servidor, quien despliega mira `docker logs -f duende-bot` (`[Migraciones] Aplicada NNN_…`) y `/paneladmin` → 🩺 Sistema.

## Al terminar

`docs/DEPLOY.md` (pasos, migraciones, variables, reconstrucción), `.env.example` si hay variable nueva, `docs/CHANGELOG.md`, y en `docs/planificacion/TAREAS.md` lo que haya que probar tras desplegar.
