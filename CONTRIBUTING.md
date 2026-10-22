# Cómo trabajamos

Dos personas con acceso de escritura al repo. Para no pisarnos el trabajo ni romper lo que corre en el NAS:

## Ramas

- **`main`** — lo que corre en producción (el NAS). Solo llega aquí por PR desde `developer`, nunca con push directo.
- **`developer`** — rama de integración. Aquí se juntan las features antes de pasar a `main`. Tampoco se le hace push
  directo: cada cosa nueva entra por PR desde su propia rama.
- **`feature/lo-que-sea`** (o `fix/lo-que-sea`, `refactor/lo-que-sea`, `docs/lo-que-sea`) — una rama por cada cosa que
  se esté haciendo, creada desde `developer`. Cuando esté lista, PR contra `developer`.

De vez en cuando (cuando `developer` lleve un rato estable, no cada commit) se abre un PR de `developer` → `main`.

```
feature/x ──┐
             ├─▶ developer ──▶ main (al NAS)
feature/y ──┘
```

**Una rama (y un PR) por cada cosa.** Si varios issues son el mismo refactor troceado (p. ej. #472/#474/#475, «separar
capas»), pueden compartir rama y PR: entonces el nombre los cubre todos (`refactor/472-475-...`) y la descripción pone
`Closes #472, #474, #475`. Fuera de ese caso, nada de mezclar ideas en una rama.

## Flujo del día a día

**Nombre de la rama**: `feature/<nº issue>-algo-corto`, `fix/<nº issue>-algo-corto` o `refactor/<nº issue>-algo-corto`
(p. ej. `feature/12-liga-pronosticos` para el issue #12). Los cambios solo de documentación, que no cierran ninguna
idea, pueden ir como `docs/algo-corto`. Así se ve de un vistazo a qué idea corresponde sin abrir GitHub.

**Antes de empezar algo nuevo** — asígnate el issue en GitHub (o muévelo a "En progreso" en el Project board) para
que el otro no empiece lo mismo, y parte siempre de `developer` al día:

```
git checkout developer
git pull origin developer
git checkout -b feature/12-liga-pronosticos
```

**Mientras trabajas**: commits normales, los que necesites. Push cuando quieras (no hace falta esperar a terminar):

```
git push -u origin feature/12-liga-pronosticos
```

**Mensajes de commit**: [Conventional Commits](https://www.conventionalcommits.org/) en español — `tipo(alcance):
descripción`, tipo en minúscula (`feat`, `fix`, `refactor`, `docs`, `test`, `chore`...), alcance opcional (`voz`,
`systems`, `juegos`...) y descripción en minúscula y sin punto final:

```
feat(juegos): quiniela de la jornada (#384)
fix(voz): /conectar elige el tiempo y nada lo desconecta (#499)
refactor(systems): los sistemas no dependen de Discord (#472)
```

Como los PR se mergean con **Squash and merge**, el **título del PR es el commit final** de `developer`: escribe ahí el
mensaje bueno (con el `(#N)` del issue) y deja los «wip» para los commits intermedios de la rama.

**Al terminar**: abre el PR contra `developer` (no contra `main`), con "Closes #12" en la descripción. Espera a que
el check `test` esté verde y a que el otro lo revise.

**Al mergear**: en `feature → developer` usa **Squash and merge** (el botón del PR en GitHub) — así `developer` queda
con un commit limpio por feature, en vez de todos los commits intermedios ("wip", "arreglo typo"...). Después, borra
la rama (GitHub lo ofrece en el mismo sitio) y actualiza tu local:

```
git checkout developer
git pull origin developer
git branch -D feature/12-liga-pronosticos
```

> Con squash la rama **no** queda como ancestro de `developer`, así que `git branch -d` se negaría («not fully
> merged»): hay que borrarla con `-D` (o dejar que la borre GitHub y hacer `git fetch --prune`).

**De `developer` a `main`**: cuando `developer` lleve un rato estable (varias features ya probadas en Discord, no
cada commit), PR de `developer` → `main`. Aquí usa **Merge commit** normal, no squash — así se ve qué features
concretas entraron juntas en ese despliegue, útil si hay que averiguar cuál rompió algo. Tras mergear, actualiza el
NAS (`git pull` en `main` + reiniciar el proceso del bot).

**Si los dos tocáis cosas relacionadas y hay conflicto**: resuélvelo en tu propia rama antes de abrir el PR, trayendo
`developer` a tu rama:

```
git fetch origin
git merge origin/developer
# resolver conflictos, git add, git commit
git push
```

## Pull requests

- Siempre por PR, aunque sea un cambio pequeño — así el otro ve qué ha cambiado y por qué, y los tests corren solos.
- La plantilla de PR pide marcar que `npm run check` (lint + formato + tests) pasa, si se ha probado en Discord y si
  toca migración. Rellenarla de verdad, no por rellenar.
- Si el PR cierra una idea, pon "Closes #N" en la descripción del PR y apúntalo en [`docs/CHANGELOG.md`](docs/CHANGELOG.md).
  **Ojo**: GitHub solo cierra el issue automáticamente al mergear en la rama por defecto (`main`), y nuestros PRs van a
  `developer`; así que, al mergear el PR a `developer`, **cierra el issue a mano** (comentario con el enlace al PR). El
  `Closes #N` se deja igual por si algún día el PR apunta a `main`.
- Revisar el PR del otro antes de aprobar, aunque sea rápido — para eso somos dos.
- **Excepción**: los PRs que abre Claude Code los mergea él mismo (squash) **en cuanto el check `test` del CI está
  verde**, sin esperar revisión — así lo pidió `ale-dm`. El CI es innegociable incluso aquí. Y la excepción vale solo
  para `feature/fix/refactor → developer`; los PR de `developer → main` (producción) los aprueba y mergea una persona.
  Si ves uno mergeado sin tu aprobación, es por esto, no un descuido.

## CI

Cada PR contra `main` o `developer` corre `npm run check` (`.github/workflows/test.yml`): ESLint, `prettier --check` y
`jest`. Un PR con el check `test` en rojo no se mergea (y, con la protección de ramas bien puesta, GitHub no deja).

## Configuración de GitHub (ajustes del repo, no código)

**Hecho** (aplicado por API el 2026-10-18): `main` y `developer` están protegidas. Se comprueba con
`gh api repos/ale-dm/bot-discord/branches/main/protection`:

- **PR obligatorio** antes de mergear (bloquea el push directo, **también para admins**: `enforce_admins`).
- **Check `test` obligatorio** (el de `npm run check`), con `strict`: la rama tiene que estar al día con su base.
- **0 aprobaciones**, para no romper la excepción de Claude (auto-merge con el CI verde). Si algún día se quiere revisión
  del otro, subir a 1 — pero entonces Claude ya no podrá auto-mergear (y `developer → main` seguiría siendo de una
  persona).
- Sin force-push ni borrado de ramas; las conversaciones de review hay que resolverlas antes de mergear.

**Pendiente**: el **Project board** (pestaña *Projects* → *New project* → plantilla *Board*). No se puede crear con la
API (`gh` de aquí no trae el comando `project`), hay que darle una vez a mano. Columnas sugeridas: Por hacer / En
progreso / Hecho. Luego *Add item* → *Add from repository* → filtrar por `label:feature-idea`.

## Ideas de funcionalidad

Viven en [Issues con label `feature-idea`](https://github.com/ale-dm/bot-discord/issues?q=is%3Aopen+label%3Afeature-idea),
no en un markdown. Labels: categoría (`apuestas`, `duende-ia`, `plex-seerr`, `economia`, `administracion`) y esfuerzo
(`esfuerzo-S`/`M`/`L`). `prioridad` marca las que más aportan con menos trabajo.

### Formato de una idea

Todas las ideas siguen la misma plantilla (`.github/ISSUE_TEMPLATE/feature-idea.md`), para poder compararlas y
priorizarlas sin abrir cada una:

- **Esfuerzo:** S, M o L, el mismo del label.
- **Qué es:** una o dos frases.
- **Comportamiento:** qué ve y puede hacer el usuario, caso por caso.
- **Detalles técnicos (orientativo):** dónde encaja y qué reutiliza; no es un diseño cerrado.
- **Criterios de aceptación:** lista de comprobación.
- **Decisiones abiertas:** lo que falta por decidir, en preguntas.

No se repiten el título ni las etiquetas en el cuerpo. Si una idea ya está implementada, se comenta con el enlace al
commit o al PR y se cierra; no se reescribe.
