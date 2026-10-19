# Datos, mocks, tiempo y azar — El Duende

Cómo preparar la BD en memoria, dónde mockear y cómo controlar el reloj y el azar.

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

## Tiempo y azar

- Prefiere APIs que acepten `ahora` o `rng` como parámetro. Es la forma más limpia y no requiere mocks.
- Si no existe, usa `jest.spyOn(Date, "now").mockReturnValue(...)` y restaura.
- Para fechas completas, `jest.useFakeTimers({ now, toFake: ["Date"] })`; vuelve a `jest.useRealTimers()` en `afterEach` o al inicio del siguiente test.
- Si el código usa I/O real en segundo plano, no falsees `setImmediate`/`nextTick` sin necesidad; espera de forma determinista.
- Para dejar correr promesas fire-and-forget, usa `await new Promise((r) => setImmediate(r))`. No uses `setTimeout` arbitrarios.
- Para el azar, fija valores concretos y explica en un comentario qué carta, tirada o elección produce cada valor.
