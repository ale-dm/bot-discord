# Cómo trabajamos

Dos personas con acceso de escritura al repo. Para no pisarnos el trabajo ni romper lo que corre en el NAS:

## Ramas

- **`main`** — lo que corre en producción (el NAS). Solo llega aquí por PR desde `developer`, nunca con push directo.
- **`developer`** — rama de integración. Aquí se juntan las features antes de pasar a `main`. Tampoco se le hace push
  directo: cada cosa nueva entra por PR desde su propia rama.
- **`feature/lo-que-sea`** (o `fix/lo-que-sea`, o `refactor/lo-que-sea`) — una rama por cada cosa que se esté haciendo,
  creada desde `developer`. Cuando esté lista, PR contra `developer`.

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

**Nombre de la rama**: `feature/<nº issue>-algo-corto`, `fix/<nº issue>-algo-corto` o `refactor/<nº issue>-algo-corto`,
p. ej. `feature/12-liga-pronosticos` para el issue #12. Así se ve de un vistazo a qué idea corresponde sin abrir GitHub.

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

## Falta configurar en GitHub (ajustes del repo, no código)

> Estado a día de hoy: **`main` no está protegida** (`gh api repos/ale-dm/bot-discord/branches/main/protection` da
> *Branch not protected*), así que ahora mismo todo esto depende de la disciplina. Es lo primero a arreglar.

Para que las reglas de arriba se cumplan solas y no dependan de acordarnos:

1. **Settings → Branches → Branch protection rules**: una regla para `main` y otra para `developer`.
   - "Require a pull request before merging" (bloquea el push directo).
   - "Require status checks to pass before merging" → marcar el check `test` (el de `npm run check`).
   - "Require approvals" (1) para que el otro tenga que aprobar antes de mergear. **Decisión pendiente**: con esto
     activo, la excepción de Claude (auto-merge sin revisión) se choca con la regla. Opciones: (a) no exigir
     aprobaciones y confiar en el CI; (b) exigirlas y que Claude no pueda auto-mergear; (c) exigirlas y dar bypass a
     Claude. Hay que elegir una y dejarla escrita aquí.
2. Con eso activo, GitHub ya no deja hacer push directo a `main`/`developer` ni mergear un PR con el check en rojo,
   ni para el admin del repo si se marca "Do not allow bypassing the above settings".
3. **Project board** (pestaña *Projects* del repo → *New project* → plantilla *Board*): esto no se puede crear con la
   API usada aquí, hay que darle una vez a mano. Columnas sugeridas: Por hacer / En progreso / Hecho. Luego
   *Add item* → *Add from repository* → filtrar por `label:feature-idea` para meter de golpe los 39 issues migrados
   de `FEATURES.md`.

## Ideas de funcionalidad

Viven en [Issues con label `feature-idea`](https://github.com/ale-dm/bot-discord/issues?q=is%3Aopen+label%3Afeature-idea),
no en un markdown. Labels: categoría (`apuestas`, `duende-ia`, `plex-seerr`, `economia`, `administracion`) y esfuerzo
(`esfuerzo-S`/`M`/`L`). `prioridad` marca las que más aportan con menos trabajo.
