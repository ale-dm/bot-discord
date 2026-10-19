---
name: Estándar de tests de El Duende
description: Convenciones y estándares para escribir, revisar y ejecutar tests Jest del proyecto. Úsala antes de crear o modificar tests, al revisar una PR o al investigar un fallo.
---

Esta skill define cómo se escriben, organizan, ejecutan y revisan los tests del repositorio. No es una guía genérica de Jest: recoge las convenciones que ya usa el proyecto.

## Cuándo usar esta skill

- Antes de escribir o modificar cualquier test.
- Al implementar una feature, un bugfix, una migración, un comando o un panel.
- Al revisar una PR y comprobar si faltan casos o hay riesgo de flakiness.
- Al investigar un test que falla de forma intermitente.
- Al tocar código con poca cobertura.

## Reglas no negociables

1. **`test`, no `it`.** El repo usa `test(...)` de forma exclusiva. No introduzcas `it(...)`.
2. **Nombres en español y orientados a comportamiento.** El nombre debe decir qué se espera, no qué función se llama.
3. **Un test, un comportamiento.** Si necesitas varios `act` independientes, probablemente sean varios tests.
4. **Sin servicios reales.** Nunca Discord, Gemini, Odds API, Tautulli, Seerr, TMDB, Giphy, STT ni red real.
5. **Sin BD real.** Nunca `data/banco.db`. Los tests usan `DB_PATH=:memory:` gracias a `tests/setupEnv.js`.
6. **Sin `.only`, `.skip` ni `test.failing`.** No se commitean tests desactivados ni “pendientes” disfrazados.
7. **Sin `console.*`.** Los tests no imprimen por consola; `setupEnv.js` ya apaga los logs.
8. **Restaura todo lo que cambies.** Mocks, timers, `process.env`, `global.fetch`, ficheros temporales y estado global.
9. **Determinismo.** Controla reloj, azar, orden de datos y IDs. Un test que depende del tiempo o del azar es un test roto.
10. **Assertions sobre el estado y los efectos.** No basta con comprobar que se llamó a `reply`; comprueba también la BD, el saldo, el inventario o el efecto real.
11. **Verificación real.** `npm test` debe pasar. Si tocaste código, `npm run check` (ESLint + Prettier + Jest) debe pasar antes de dar el trabajo por terminado.

## Stack y comandos

Los tests viven en `tests/*.test.js`. Jest usa entorno `node`, CommonJS y `tests/setupEnv.js` como `setupFiles`.

Dentro del repositorio:

| Comando | Para qué |
|---|---|
| `npm test` | Toda la suite. Es lo que corre la CI. |
| `npx jest tests/foo.test.js` | Un solo archivo. |
| `npx jest -t "texto del test"` | Un test o grupo por nombre. |
| `npx jest --coverage` | Cobertura por líneas, ramas y funciones. |
| `npm run check` | ESLint + Prettier + Jest. Obligatorio antes de cerrar un cambio de código. |

La CI (`.github/workflows/test.yml`) ejecuta `npm test` en PR y push a `main` y `developer`. Un PR con tests en rojo no se mergea.

## Organización de archivos

- Un archivo por área o feature: `tests/mercado.test.js`, `tests/apuestasResumen.test.js`, `tests/adminNivelesConfigPanel.test.js`.
- `*Cobertura.test.js` se usa para tests orientados a cubrir ramas de un módulo concreto. No es un cajón de sastre: si el test pertenece a una feature, va al archivo de esa feature.
- `parteN*.test.js` agrupa pruebas de un plan transversal de paneles.
- `*FaseN.test.js` agrupa pruebas de una fase de desarrollo.
- Los helpers son locales al archivo y se declaran arriba. No hay una carpeta compartida de helpers; si un helper se repite en muchos archivos, se valora extraerlo, pero no se duplica lógica compleja.
- `tests/setupEnv.js` configura la BD en memoria, `DATA_DIR` y `LOG_DIR` en el directorio temporal del sistema, y silencia la consola.

## Anatomía de un archivo

```js
// Área: qué cubre este archivo. BD en memoria, sin Discord ni red.
// Si hay mocks o un reloj concreto, se explica aquí.
const db = require("../src/core/db");
const modulo = require("../src/systems/modulo");

const G = "g-test-modulo";

const crearUsuario = (id, { efectivo = 1000 } = {}) => {
    db.prepare("INSERT INTO banco (userId, saldo, enMano) VALUES (?, 0, ?)").run(id, efectivo);
    return id;
};

beforeEach(() => {
    // Limpiar solo el estado mutable que afecta a este archivo.
});

afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
});

describe("nombre del área o feature (#issue)", () => {
    test("comportamiento esperado en lenguaje natural", () => {
        // Arrange
        const id = crearUsuario("u-1");

        // Act
        const resultado = modulo.hacerAlgo(id);

        // Assert
        expect(resultado.ok).toBe(true);
        expect(db.prepare("SELECT ...").get(id)).toMatchObject({ ... });
    });

    test("caso límite o error: no debe dejar efectos", () => {
        // ...
    });
});
```

## Nombres y estructura

- `describe` agrupa por feature, área o issue: `describe("mercado entre jugadores (#374)", ...)`.
- `test` describe el comportamiento: `test("sin saldo no se cobra ni se entrega nada", ...)`.
- Incluye el número de issue cuando el test protege una feature o un bugfix concreto.
- Para variantes, usa `test.each`:

```js
test.each(["sí", "Si", "YES", "1"])("con «%s» se acepta", (respuesta) => {
    expect(esAfirmativo(respuesta)).toBe(true);
});
```

- No uses snapshots. El repo no los usa y no aportan claridad sobre el comportamiento.
- No uses `test.concurrent`. La suite no lo usa y complica el aislamiento de la BD.

## Datos y base de datos

- Para el flujo normal, usa la BD compartida del archivo: `const db = require("../src/core/db")`.
- Prepara los datos con SQL directo y helpers locales. Es más explícito y rápido que montar servicios completos.
- Usa IDs únicos por archivo (`g-mercado`, `u-1`, `f7-1`) para no chocar con otros tests del mismo archivo.
- Si un test modifica filas que otros tests leen, límpialas en `beforeEach` o usa IDs nuevos.
- No dependas del orden de ejecución. Cada test debe poder correr solo.
- Para probar migraciones o esquemas antiguos, crea una BD independiente:

```js
const Database = require("better-sqlite3");
const { runMigrations } = require("../src/core/migrations");

const db = new Database(":memory:");
runMigrations(db);
// ...
db.close();
```

- Nunca uses `data/banco.db` ni rutas absolutas del proyecto.
- Si el test escribe ficheros, usa un directorio temporal:

```js
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "el-duende-test-"));
process.env.DATA_DIR = dir;

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
```

- Si cambias `process.env` después de cargar un módulo con estado a nivel de módulo, vuelve a cargarlo con `jest.isolateModules(() => { ... })` o `jest.resetModules()`.

## Mocks

Mockea en la frontera, no la lógica que quieres probar.

- Servicios externos: `jest.mock("../src/services/tautulliClient", ...)`, `seerrClient`, `oddsApi`, `giphy`, `stt`.
- SDKs: `@google/genai`, `@discordjs/voice`, `prism-media`, `node-cron`.
- Red: `global.fetch = jest.fn(...)` o `jest.spyOn(global, "fetch")`.
- Tiempo: `jest.spyOn(Date, "now")`, `jest.useFakeTimers(...)`.
- Azar: inyecta `rng` si la API lo permite; si no, `jest.spyOn(Math, "random")`.

Buenas prácticas:

- Declara las variables `mock*` antes de `jest.mock` para que el factory hoisteado pueda usarlas.
- Usa `jest.requireActual` cuando solo quieras sustituir una parte:

```js
const mockGenerate = jest.fn();
jest.mock("@google/genai", () => ({
    ...jest.requireActual("@google/genai"),
    GoogleGenAI: jest.fn(() => ({ models: { generateContent: mockGenerate } })),
}));
```

- Restaura siempre: `afterEach(() => jest.restoreAllMocks())`.
- Si cambias `global.fetch`, guarda el original y restáuralo en `finally` o en `afterEach`.
- No mockees el módulo que estás probando salvo que el test sea de integración y el mock sea un colaborador externo.
- No mockees `db` si lo que quieres verificar es el efecto en la BD; usa la BD en memoria.

## Discord falso

No uses objetos reales de `discord.js`. Crea interacciones planas con las propiedades que el handler necesita:

```js
const interaccion = (extra = {}) => ({
    guildId: G,
    guild: { id: G },
    user: { id: "u-admin", username: "admin", tag: "admin" },
    member: { permissions: { has: () => true } },
    client: {
        slashCommands: new Map(),
        guilds: { cache: new Map() },
        user: { displayAvatarURL: () => null },
        users: { fetch: async () => null },
    },
    reply: jest.fn(async () => {}),
    update: jest.fn(async () => {}),
    deferReply: jest.fn(async () => {}),
    editReply: jest.fn(async () => {}),
    showModal: jest.fn(async () => {}),
    ...extra,
});
```

Para botones y modales, añade `customId` y `fields.getTextInputValue` / `getStringSelectValues`. Después inspecciona `mock.calls`:

```js
const ids = (payload) => payload.components.flatMap((r) => r.components.map((b) => b.data.custom_id));
const ultimo = (mock) => mock.mock.calls.at(-1)[0];

expect(ids(ultimo(i.reply))).toEqual(expect.arrayContaining(["paneladmin_cat_home"]));
expect(ultimo(i.update).embeds[0].data.description).toMatch(/creado/);
```

Comprueba también los límites de Discord: 5 botones por fila, 5 filas por mensaje, 45 caracteres de etiqueta en modales y `customId` único en el mensaje.

## Tiempo y azar

- Prefiere APIs que acepten `ahora` o `rng` como parámetro. Es la forma más limpia y no requiere mocks.
- Si no existe, usa `jest.spyOn(Date, "now").mockReturnValue(...)` y restaura.
- Para fechas completas, `jest.useFakeTimers({ now, toFake: ["Date"] })`; vuelve a `jest.useRealTimers()` en `afterEach` o al inicio del siguiente test.
- Si el código usa I/O real en segundo plano, no falsees `setImmediate`/`nextTick` sin necesidad; espera de forma determinista.
- Para dejar correr promesas fire-and-forget, usa `await new Promise((r) => setImmediate(r))`. No uses `setTimeout` arbitrarios.
- Para el azar, fija valores concretos y explica en un comentario qué carta, tirada o elección produce cada valor.

## Qué debe cubrir un test

Como mínimo, según el cambio:

| Tipo | Ejemplos |
|---|---|
| Camino feliz | Se crea, se cobra, se guarda, se responde. |
| Límites | 0, negativo, máximo, caducado, stock nulo, texto vacío, 45/46 caracteres. |
| Errores y rollback | Sin saldo, sin permisos, API caída, dato inválido; la BD no cambia. |
| Idempotencia | Repetir la acción no duplica cobros, mensajes ni filas. |
| Tiempo | Cambio de día, racha, expiración, zona horaria de Madrid. |
| Permisos | Admin, dueño, usuario normal, DM, guild distinta. |
| Integraciones | Respuesta vacía, error HTTP, timeout, datos incompletos. |
| Regresión | Un bug corregido tiene un test que fallaba antes y pasa después. |
| Migraciones | BD vacía, BD antigua, datos preservados, doble ejecución. |
| Rendimiento | `EXPLAIN QUERY PLAN` usa el índice esperado; no midas tiempos frágiles. |
| UI | Embeds, botones, modales, `customId`, límites de Discord. |

No escribas tests que solo ejecuten líneas sin comprobar comportamiento. La cobertura es una señal, no el objetivo.

## Cobertura

- Mide con `npx jest --coverage`.
- Prioriza ramas y casos de error sobre porcentaje de líneas.
- No hay `coverageThreshold` en Jest: la cobertura no bloquea la CI. Eso no significa ignorarla.
- Si tocas un fichero con cobertura baja, añade tests de las ramas que modifiques.
- No añadas tests artificiales solo para subir el número. Un test sin assertions útiles es deuda.

## Verificación

Antes de terminar:

1. Ejecuta el archivo que has tocado: `npx jest tests/tuArchivo.test.js`.
2. Ejecuta la suite completa: `npm test`.
3. Si cambiaste código de producción, ejecuta `npm run check`.
4. Si el cambio incluye migración, comando, panel o variable de entorno, actualiza también la documentación que corresponda.

Cuando reportes, indica el comando exacto y el resultado real. No digas “los tests pasan” sin haberlos ejecutado.

## Checklist de revisión

Al revisar tests, comprueba:

- ¿El nombre del test describe el comportamiento y está en español?
- ¿Hay camino feliz, al menos un límite y al menos un error/rollback?
- ¿Se comprueba el estado final (BD, saldo, inventario, fichero), no solo la respuesta?
- ¿El test es independiente del orden y de otros tests del archivo?
- ¿Se restauran mocks, timers, `process.env`, `global.fetch` y ficheros temporales?
- ¿Hay red, Discord, BD o APIs reales? No debe haberlos.
- ¿El reloj y el azar están controlados?
- ¿Se usan IDs únicos o limpieza en `beforeEach`?
- ¿El mock está en la frontera y no sustituye la lógica bajo test?
- ¿Se respetan los límites de Discord y la unicidad de `customId`?
- ¿Hay `.only`, `.skip`, `test.failing`, `console.*` o snapshots?
- ¿El test fallaría de verdad si se rompiera el comportamiento? Evita assertions débiles.
- ¿Se ha ejecutado `npm test` y, si aplica, `npm run check`?

Tienes una versión imprimible en `references/checklist.md`.

## Anti-patrones

- `it(...)` o nombres en inglés.
- `.only`, `.skip`, `test.failing` commiteados.
- `console.log` para depurar.
- `setTimeout(..., 100)` para “esperar a que pase algo”.
- Depender de `Date.now()` real o de `Math.random()` sin control.
- Compartir estado mutable entre tests sin limpiarlo.
- Mockear el módulo bajo test y luego assertar el mock.
- Comprobar solo que se llamó a una función, sin mirar el efecto.
- Tests que pasan porque no assertan nada.
- Dejar timers fake o mocks activos después del test.
- Usar `data/banco.db` o rutas reales.
- Escribir un test para cada línea en vez de para cada comportamiento.

## Plantilla

Usa `templates/test-base.template.js` como punto de partida. Cópiala a `tests/<área>.test.js`, adáptala al área y no la dejes con nombres genéricos.

## Definition of Done

Un cambio de tests está terminado cuando:

- [ ] El archivo está en `tests/` con el nombre correcto.
- [ ] El comentario de cabecera explica qué cubre y qué se mockea.
- [ ] Usa `test`, nombres en español y `describe` por área/issue.
- [ ] Cubre camino feliz, límites y errores/rollback relevantes.
- [ ] Asserta estado y efectos, no solo mensajes.
- [ ] No toca red, Discord, BD real ni APIs reales.
- [ ] Restaura mocks, timers, env, fetch y temporales.
- [ ] No tiene `.only`, `.skip`, `test.failing` ni `console.*`.
- [ ] `npm test` pasa.
- [ ] Si tocó código, `npm run check` pasa.
- [ ] La documentación asociada está actualizada.
