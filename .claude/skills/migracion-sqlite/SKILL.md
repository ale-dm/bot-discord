---
name: migracion-sqlite
description: Migraciones de better-sqlite3 de El Duende. Cárgala siempre que la tarea cree o cambie una tabla, columna o índice, añada un fichero en src/core/migrations/ o revise una migración. No la cargues para consultas o repositorios que no cambian el esquema.
---

El esquema completo vive en `src/core/migrations/`. `index.js` aplica cada `NNN_nombre.js` una sola vez, en orden y dentro de una transacción, y lo apunta en `schema_migrations`. `core/db.js` lo llama al abrir la BD, así que los tests (BD en memoria) arrancan con el esquema entero.

## Reglas no negociables

1. **Número siguiente al más alto real.** Lista `src/core/migrations/` y suma uno; no te fíes del número que diga la documentación. Tres cifras (`071_algo.js`), nombre en `snake_case` o con guiones (`[\w-]+`).
2. **Nunca edites una migración ya aplicada.** No se volvería a ejecutar en producción. Si algo está mal, se corrige en una migración nueva.
3. **Ninguna tabla se crea desde un comando, sistema o repositorio.** Todo `CREATE`/`ALTER` va en una migración.
4. **Forma del fichero**: un comentario inicial que diga qué añade y para qué issue (`#N`), `function up(db, ctx)` y `module.exports = { up };`. `ctx.log` es el logger de esa migración.
5. **Idempotente cuando se pueda**: `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`. Para `ALTER TABLE ... ADD COLUMN`, comprueba antes con `PRAGMA table_info(tabla)`.
6. **Sin `BEGIN`/`COMMIT` propios**: el runner ya envuelve `up` en una transacción; si falla, la BD queda como estaba.
7. **Dinero en enteros**, fechas como `INTEGER` en milisegundos (`Date.now()`), salvo que la tabla vecina ya use otra convención.
8. **Índices** para las columnas por las que se filtra u ordena (ver `040_indices_consultas.js` y `docs/tecnico/MEDICION_BD.md`).
9. **Nunca toques `data/banco.db`.** Para probar, tests con BD en memoria; `npm run db:check` solo si hace falta y con permiso.

## Tests

- `tests/migrations.test.js` comprueba que se aplican todas y que una segunda pasada no hace nada; no hay que tocar ningún contador.
- Si la migración transforma datos existentes (no solo crea), añade un test propio al estilo de `tests/migracion039Decadas.test.js`: siembra el estado anterior, borra la fila de `schema_migrations` y vuelve a ejecutar `runMigrations`.
- Carga también `estandar-tests` si vas a escribir esos tests.

## Al terminar

- `docs/DEPLOY.md`: una sección `### <Qué> (migración NNN, AAAA-MM-DD)` con lo que cambia al desplegar.
- `docs/CHANGELOG.md`: menciona el número de migración.
- En el PR, marca la casilla de migraciones con `NNN_...`.
