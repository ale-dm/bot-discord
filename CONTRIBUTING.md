# Cómo trabajamos

Dos personas con acceso de escritura al repo. Para no pisarnos el trabajo ni romper lo que corre en el NAS:

## Ramas

- **`main`** — lo que corre en producción (el NAS). Solo llega aquí por PR desde `developer`, nunca con push directo.
- **`developer`** — rama de integración. Aquí se juntan las features antes de pasar a `main`. Tampoco se le hace push
  directo: cada cosa nueva entra por PR desde su propia rama.
- **`feature/lo-que-sea`** (o `fix/lo-que-sea`) — una rama por cada cosa que se esté haciendo, creada desde `developer`.
  Cuando esté lista, PR contra `developer`.

De vez en cuando (cuando `developer` lleve un rato estable, no cada commit) se abre un PR de `developer` → `main`.

```
feature/x ──┐
             ├─▶ developer ──▶ main (al NAS)
feature/y ──┘
```

## Flujo del día a día

**Nombre de la rama**: `feature/<nº issue>-algo-corto` o `fix/<nº issue>-algo-corto`, p. ej. `feature/12-liga-pronosticos`
para el issue #12. Así se ve de un vistazo a qué idea corresponde sin abrir GitHub.

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

**Al terminar**: abre el PR contra `developer` (no contra `main`), con "Closes #12" en la descripción. Espera a que
el check `test` esté verde y a que el otro lo revise.

**Al mergear**: en `feature → developer` usa **Squash and merge** (el botón del PR en GitHub) — así `developer` queda
con un commit limpio por feature, en vez de todos los commits intermedios ("wip", "arreglo typo"...). Después, borra
la rama (GitHub lo ofrece en el mismo sitio) y actualiza tu local:

```
git checkout developer
git pull origin developer
git branch -d feature/12-liga-pronosticos
```

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
- La plantilla de PR pide marcar si `npm test` pasa y si se ha probado en Discord. Rellenarla de verdad, no por rellenar.
- Si el PR cierra una idea, se cierra su [Issue](https://github.com/ale-dm/bot-discord/issues?q=is%3Aopen+label%3Afeature-idea)
  (poner "Closes #N" en la descripción del PR) y se apunta en [`docs/CHANGELOG.md`](docs/CHANGELOG.md).
- Revisar el PR del otro antes de aprobar, aunque sea rápido — para eso somos dos.
- **Excepción**: los PRs que abre Claude Code los mergea él mismo (squash) en cuanto pasan `npm test` en local,
  sin esperar revisión — así lo pidió `ale-dm`. Si ves uno mergeado sin tu aprobación, es por esto, no un descuido.

## CI

Cada PR contra `main` o `developer` corre `npm test` solo (`.github/workflows/test.yml`). Un PR con los tests en rojo
no se mergea.

## Falta configurar en GitHub (ajustes del repo, no código)

Para que las reglas de arriba se cumplan solas y no dependan de acordarnos:

1. **Settings → Branches → Branch protection rules**: una regla para `main` y otra para `developer`.
   - "Require a pull request before merging" (bloquea el push directo).
   - "Require status checks to pass before merging" → marcar el check `test` (el de `npm test`).
   - Opcional con dos personas: "Require approvals" (1) para que el otro tenga que aprobar antes de mergear.
2. Con eso activo, GitHub ya no deja hacer push directo a `main`/`developer` ni mergear un PR con los tests en rojo,
   ni para el admin del repo si se marca "Do not allow bypassing the above settings".
3. **Project board** (pestaña *Projects* del repo → *New project* → plantilla *Board*): esto no se puede crear con la
   API usada aquí, hay que darle una vez a mano. Columnas sugeridas: Por hacer / En progreso / Hecho. Luego
   *Add item* → *Add from repository* → filtrar por `label:feature-idea` para meter de golpe los 39 issues migrados
   de `FEATURES.md`.

## Ideas de funcionalidad

Viven en [Issues con label `feature-idea`](https://github.com/ale-dm/bot-discord/issues?q=is%3Aopen+label%3Afeature-idea),
no en un markdown. Labels: categoría (`apuestas`, `duende-ia`, `plex-seerr`, `economia`, `administracion`) y esfuerzo
(`esfuerzo-S`/`M`/`L`). `prioridad` marca las que más aportan con menos trabajo.
