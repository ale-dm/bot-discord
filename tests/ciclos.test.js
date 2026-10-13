// #479: los ciclos de dependencias entre módulos de src/. Un ciclo nuevo hace fallar este test (y `npm run ciclos`); un ciclo
// que ya no existe también, para que la lista de excepciones (docs/planificacion/ciclos-permitidos.json) solo pueda bajar.
const path = require("path");
const { normalizar, comparar, ciclosActuales, ciclosPermitidos } = require("../scripts/ciclos");

describe("normalizar y comparar", () => {
    test("el mismo ciclo sale igual por donde se empiece a recorrer, y con barras de cualquier sistema", () => {
        expect(normalizar(["b.js", "c.js", "a.js"])).toBe("a.js > b.js > c.js");
        expect(normalizar(["a.js", "b.js", "c.js"])).toBe("a.js > b.js > c.js");
        expect(normalizar(["c.js", "a.js", "b.js"])).toBe("a.js > b.js > c.js");
        expect(normalizar(["systems" + path.sep + "x.js", "systems/y.js"])).toBe("systems/x.js > systems/y.js");
    });

    test("distingue los ciclos nuevos de los que ya no existen", () => {
        expect(comparar(["a > b", "c > d"], ["a > b", "c > d"])).toEqual({ nuevos: [], resueltos: [] });
        expect(comparar(["a > b", "x > y"], ["a > b"])).toEqual({ nuevos: ["x > y"], resueltos: [] });
        expect(comparar(["a > b"], ["a > b", "c > d"])).toEqual({ nuevos: [], resueltos: ["c > d"] });
        expect(comparar([], [])).toEqual({ nuevos: [], resueltos: [] });
    });
});

test("los ciclos de src/ son exactamente los de la lista de excepciones: no hay ninguno nuevo y no sobra ninguno", async () => {
    const { nuevos, resueltos } = comparar(await ciclosActuales(), ciclosPermitidos());
    expect(nuevos).toEqual([]);
    expect(resueltos).toEqual([]);
}, 60_000);
