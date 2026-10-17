// 🔊 El registro de quién ocupa el audio de un servidor (#499): cada consumidor se apunta, y /conectar mira la espera.
const ocupacion = require("../src/systems/ocupacion");

test("un ocupante se apunta, dice si el servidor está ocupado y se puede quitar", () => {
    const quitar = ocupacion.registrar("prueba", (g) => g === "s1", 1000);
    expect(ocupacion.ocupado("s1", "prueba")).toBe(true);
    expect(ocupacion.ocupado("s2", "prueba")).toBe(false);
    quitar();
    expect(ocupacion.ocupado("s1", "prueba")).toBe(false);
});

test("la espera es el mayor reintento de quien ocupa el servidor, o 0 si está libre", () => {
    const quitarCorto = ocupacion.registrar("corto", () => true, ocupacion.REINTENTO_CORTO_MS);
    const quitarLargo = ocupacion.registrar("largo", (g) => g === "s1", ocupacion.REINTENTO_LARGO_MS);
    expect(ocupacion.esperaPendiente("s1")).toBe(ocupacion.REINTENTO_LARGO_MS);
    expect(ocupacion.esperaPendiente("s2")).toBe(ocupacion.REINTENTO_CORTO_MS);
    quitarCorto();
    quitarLargo();
    expect(ocupacion.esperaPendiente("s1")).toBe(0);
});

test("quitar un ocupante que ya fue sustituido no quita al nuevo", () => {
    const quitarPrimero = ocupacion.registrar("x", () => true, 1);
    ocupacion.registrar("x", () => true, 2);
    quitarPrimero();
    expect(ocupacion.esperaPendiente("s1")).toBe(2);
});
