// #474: las reglas de apostar una quiniela, sin Discord ni base de datos: pronósticos, cantidad, efectivo, apuesta
// repetida, tope diario y cierre de la jornada. El formulario de /juegos solo traduce el resultado a un mensaje. Las
// consultas (efectivo, apuesta repetida, límite) se pasan como dobles; en producción llevan las reales por defecto.
const reglas = require("../src/systems/apuestas/quinielaReglas");

const dobles = (extra = {}) => ({ saldoGastable: () => 1000, yaAposto: () => false, comprobarLimite: () => null, ...extra });
const base = (extra = {}) => ({
    userId: "qr-u",
    guildId: "g-qr",
    quinielaId: 987654,
    partidos: 3,
    pronosticos: "1X2",
    cantidad: 100,
    ...extra,
});

describe("avisoDeApuesta", () => {
    test("una apuesta correcta no tiene aviso", () => {
        expect(reglas.avisoDeApuesta(base(), dobles())).toBeNull();
    });

    test("pronósticos incompletos, de otro tamaño o con símbolos que no son 1, X o 2", () => {
        for (const pronosticos of ["1X", "1X22", "1X3", "1x2", ""]) {
            expect(reglas.avisoDeApuesta(base({ pronosticos }), dobles())).toMatch(/incompletos o inválidos/);
        }
        expect(reglas.avisoDeApuesta(base({ pronosticosCompletos: false }), dobles())).toMatch(/incompletos o inválidos/);
        expect(reglas.pronosticosValidos("12X", 3)).toBe(true);
        expect(reglas.pronosticosValidos("12", 3)).toBe(false);
    });

    test("la cantidad tiene que estar entre el mínimo y el máximo", () => {
        for (const cantidad of [NaN, reglas.MIN_BET_AMOUNT - 1, reglas.MAX_BET_AMOUNT + 1]) {
            expect(reglas.avisoDeApuesta(base({ cantidad }), dobles())).toMatch(/Cantidad inválida/);
        }
        expect(reglas.avisoDeApuesta(base({ cantidad: reglas.MIN_BET_AMOUNT }), dobles())).toBeNull();
        expect(reglas.avisoDeApuesta(base({ cantidad: reglas.MAX_BET_AMOUNT }), dobles())).toBeNull();
    });

    test("sin efectivo, avisa de sacar del banco", () => {
        expect(reglas.avisoDeApuesta(base(), dobles({ saldoGastable: () => 50 }))).toBe(reglas.SIN_EFECTIVO);
    });

    test("quien ya ha apostado esa quiniela no puede apostarla otra vez", () => {
        expect(
            reglas.avisoDeApuesta(base(), dobles({ yaAposto: (quinielaId, userId) => quinielaId === 987654 && userId === "qr-u" })),
        ).toMatch(/Ya has apostado/);
    });

    test("si se pasa el tope diario del servidor, avisa con el motivo", () => {
        const aviso = reglas.avisoDeApuesta(base(), dobles({ comprobarLimite: () => "Tu límite de pérdidas diario no lo permite." }));
        expect(aviso).toMatch(/^🚦 Tu límite de pérdidas/);
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
