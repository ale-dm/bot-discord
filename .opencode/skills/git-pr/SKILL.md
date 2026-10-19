---
name: git-pr
description: Ramas, commits y pull requests de El Duende según CONTRIBUTING.md. Cárgala solo cuando la tarea sea crear una rama, hacer commit, push o abrir, actualizar o mergear un PR. No hagas commit ni push si no te lo han pedido.
---

Resumen operativo de `CONTRIBUTING.md`; si hay duda, manda ese fichero.

## Ramas

- `main` = producción (NAS). `developer` = integración. **Nunca push directo a ninguna de las dos.**
- Una rama por cosa, desde `developer` al día: `feature/<issue>-algo-corto`, `fix/<issue>-...`, `refactor/<issue>-...`; solo documentación sin issue: `docs/algo-corto`.
- Antes de crear: `git status` limpio, `git checkout developer`, `git pull origin developer`, `git checkout -b <rama>`.
- Conflictos: en tu rama, `git fetch origin` y `git merge origin/developer`; nunca rebase ni force-push sobre ramas compartidas.

## Commits

- Conventional Commits en español: `tipo(alcance): descripción` en minúscula y sin punto final. Tipos: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`.
- Antes de cada commit: `npm run check` en verde. Si no lo está, no se hace commit.
- No incluyas `.env`, `data/`, `logs/`, `models/` ni ficheros temporales. Revisa `git diff --staged` antes.

## Pull requests

- Siempre contra `developer` (salvo el PR `developer` → `main`, que lo abre y mergea una persona).
- **El título del PR es el commit final** (squash): `tipo(alcance): descripción (#N)`.
- Rellena de verdad `.github/pull_request_template.md`: qué cambia, por qué, cómo se ha probado y las casillas (check, Discord, CHANGELOG, migración `NNN_...`). Pon `Closes #N`.
- Merge `feature/fix/refactor → developer`: **Squash and merge**, y solo con el check `test` en verde. Después cierra el issue a mano (GitHub no lo cierra al mergear en `developer`) y borra la rama.
- `developer → main`: **Merge commit**, nunca squash, y nunca lo mergea un agente.

## Prohibido sin permiso explícito

`git push` (pide confirmación), `git reset --hard`, `git clean`, `git push --force`, `git branch -D` de ramas ajenas y cualquier cambio en la protección de ramas.
