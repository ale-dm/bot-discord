# Escritura de tests — El Duende

Cómo se organiza, nombra y estructura un test, y qué debe cubrir.

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
