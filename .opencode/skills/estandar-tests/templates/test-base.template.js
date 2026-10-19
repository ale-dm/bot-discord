// Área: <qué cubre este archivo>. BD en memoria, sin Discord ni red.
// Mocks: <servicios/SDKs que se simulan>. Reloj: <real | fijo | fake timers>.
const db = require("../src/core/db");
// const modulo = require("../src/systems/modulo");

const G = "g-test-<area>";

// Helpers locales de datos. Mantenerlos pequeños y explícitos.
const crearUsuario = (id, { efectivo = 1000, banco = 0 } = {}) => {
    db.prepare("INSERT INTO banco (userId, saldo, enMano) VALUES (?, ?, ?)").run(id, banco, efectivo);
    return id;
};

const leerSaldo = (id) => db.prepare("SELECT enMano FROM banco WHERE userId = ?").get(id)?.enMano;

beforeEach(() => {
    // Limpiar solo el estado mutable que afecta a este archivo.
    // Ejemplo: db.prepare("DELETE FROM tabla WHERE guildId = ?").run(G);
});

afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
});

describe("<área o feature> (#<issue>)", () => {
    test("<comportamiento esperado en lenguaje natural>", async () => {
        // Arrange
        const usuario = crearUsuario("u-1", { efectivo: 500 });

        // Act
        const resultado = await modulo.hacerAlgo(usuario);

        // Assert
        expect(resultado.ok).toBe(true);
        expect(leerSaldo(usuario)).toBe(400);
        expect(db.prepare("SELECT COUNT(*) AS n FROM historial WHERE userId = ?").get(usuario).n).toBe(1);
    });

    test("<caso límite o error> no deja efectos laterales", async () => {
        // Arrange
        const usuario = crearUsuario("u-2", { efectivo: 0 });

        // Act
        const resultado = await modulo.hacerAlgo(usuario);

        // Assert
        expect(resultado.ok).toBe(false);
        expect(leerSaldo(usuario)).toBe(0);
    });
});
