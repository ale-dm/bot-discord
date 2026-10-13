// #474: las reglas de apostar una quiniela, sin Discord ni formularios: pronósticos, cantidad, efectivo, apuesta repetida y cierre
// de la jornada. El formulario de /juegos solo traduce el resultado a un mensaje.
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const reglas = require("../src/systems/apuestas/quinielaReglas");

let n = 0;
const persona = (efectivo = 1000) => {
    const id = `qr-${++n}`;
    dinero.asegurarCuenta(id);
    db.prepare("UPDATE banco SET enMano = ? WHERE userId = ?").run(efectivo, id);
    return id;
};
const base = (extra = {}) => ({
    userId: persona(),
    guildId: "g-qr",
    quinielaId: 987654,
    partidos: 3,
    pronosticos: "1X2",
    cantidad: 100,
    ...extra,
});

describe("avisoDeApuesta", () => {
    test("una apuesta correcta no tiene aviso", () => {
        expect(reglas.avisoDeApuesta(base())).toBeNull();
    });

    test("pronósticos incompletos, de otro tamaño o con símbolos que no son 1, X o 2", () => {
        for (const pronosticos of ["1X", "1X22", "1X3", "1x2", ""]) {
            expect(reglas.avisoDeApuesta(base({ pronosticos }))).toMatch(/incompletos o inválidos/);
        }
        expect(reglas.avisoDeApuesta(base({ pronosticosCompletos: false }))).toMatch(/incompletos o inválidos/);
        expect(reglas.pronosticosValidos("12X", 3)).toBe(true);
        expect(reglas.pronosticosValidos("12", 3)).toBe(false);
    });

    test("la cantidad tiene que estar entre el mínimo y el máximo", () => {
        for (const cantidad of [NaN, reglas.MIN_BET_AMOUNT - 1, reglas.MAX_BET_AMOUNT + 1]) {
            expect(reglas.avisoDeApuesta(base({ cantidad }))).toMatch(/Cantidad inválida/);
        }
        expect(reglas.avisoDeApuesta(base({ cantidad: reglas.MIN_BET_AMOUNT }))).toBeNull();
        expect(reglas.avisoDeApuesta(base({ cantidad: reglas.MAX_BET_AMOUNT }))).toBeNull();
    });

    test("sin efectivo, avisa de sacar del banco", () => {
        expect(reglas.avisoDeApuesta(base({ userId: persona(50) }))).toBe(reglas.SIN_EFECTIVO);
    });

    test("quien ya ha apostado esa quiniela no puede apostarla otra vez", () => {
        const userId = persona();
        const quinielaId = db
            .prepare("INSERT INTO quinielas (deporte, jornada, estado, creador_id, creada_en) VALUES ('laliga', 'J1', 'abierta', 'x', ?)")
            .run(new Date().toISOString()).lastInsertRowid;
        db.prepare(
            "INSERT INTO quiniela_apuestas (quiniela_id, user_id, predicciones, cantidad, creada_en) VALUES (?, ?, '1X2', 50, ?)",
        ).run(quinielaId, userId, new Date().toISOString());
        expect(reglas.avisoDeApuesta(base({ userId, quinielaId }))).toMatch(/Ya has apostado/);
    });
});

describe("cierreDeLaJornada", () => {
    test("devuelve el primer partido si ya cerró por tiempo, y null si aún se puede apostar", () => {
        const lejos = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();
        const cerca = new Date(Date.now() + 5 * 60 * 1000).toISOString();
        expect(reglas.cierreDeLaJornada([{ start_time: lejos }, { start_time: lejos }])).toBeNull();
        expect(reglas.cierreDeLaJornada([{ start_time: lejos }, { start_time: cerca }])).toBe(cerca);
        expect(reglas.cierreDeLaJornada([])).toBeNull();
    });
});
