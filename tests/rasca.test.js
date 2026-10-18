// BD en memoria (ver tests/setupEnv.js) con el esquema de las migraciones: cada fichero de test empieza vacío.
const db = require("../src/core/db");
const guildSettings = require("../src/systems/guildSettings");
const impuestos = require("../src/systems/impuestos");
const rasca = require("../src/systems/casino/rasca");

const GUILD = "guild-rasca";
// Sin impuesto de casino en este servidor de pruebas: el saldo esperado es el del propio juego.
impuestos.anadirRegla(GUILD, { base: "ingreso", porcentaje: 0, destino: "sumidero" });
let n = 0;
// Un usuario nuevo por test para que los saldos y los cupos no se pisen entre tests.
function nuevoUsuario(saldo = 1000) {
    const id = `rasca-user-${++n}`;
    db.prepare("INSERT INTO banco (userId, saldo, enMano) VALUES (?, 0, ?)").run(id, saldo);
    return id;
}
const saldo = (id) => db.prepare("SELECT enMano AS saldo FROM banco WHERE userId = ?").get(id).saldo;
const partidas = (id) => db.prepare("SELECT * FROM casino WHERE userId = ? ORDER BY id").all(id);

// `rng` que devuelve los valores indicados y, cuando se acaban, 0.5.
function rngFijo(...valores) {
    let i = 0;
    return () => valores[i++] ?? 0.5;
}

afterEach(() => {
    guildSettings.setSetting(GUILD, "casino.daily_limit", 0);
    guildSettings.setSetting(GUILD, "casino.global_cooldown_sec", 0);
    guildSettings.setSetting(GUILD, "casino.rtp_rasca", 100);
});

describe("tabla de premios", () => {
    test("los pesos suman 100000 y el RTP base es el 90,5 %", () => {
        expect(rasca.PESO_TOTAL).toBe(100000);
        const esperado = rasca.PREMIOS.reduce((suma, p) => suma + p.peso * p.multiplicador, 0) / rasca.PESO_TOTAL;
        expect(esperado).toBeCloseTo(0.905, 4);
    });

    test("elegirResultado respeta los tramos de la tabla", () => {
        expect(rasca.elegirResultado(() => 0)).toBeNull();
        expect(rasca.elegirResultado(() => 0.74499)).toBeNull();
        expect(rasca.elegirResultado(() => 0.745)).toMatchObject({ simbolo: "🍒", multiplicador: 2 });
        expect(rasca.elegirResultado(() => 0.8)).toMatchObject({ simbolo: "🍒", multiplicador: 2 });
        expect(rasca.elegirResultado(() => 0.992)).toMatchObject({ simbolo: "🔔", multiplicador: 15 });
        expect(rasca.elegirResultado(() => 0.997)).toMatchObject({ simbolo: "💎", multiplicador: 30 });
        expect(rasca.elegirResultado(() => 0.9995)).toMatchObject({ simbolo: "⭐", multiplicador: 50 });
    });
});

describe("generarCarton", () => {
    test("con premio salen tres del símbolo ganador y ningún otro trío", () => {
        const premio = rasca.PREMIOS[3];
        const carton = rasca.generarCarton(premio, rngFijo(0.5));
        const cuenta = rasca.contarSimbolos(carton);

        expect(carton).toHaveLength(9);
        expect(cuenta[premio.simbolo]).toBe(3);
        expect(Object.values(cuenta).filter((veces) => veces >= 3)).toHaveLength(1);
        expect(carton.every((simbolo) => simbolo !== null)).toBe(true);
    });

    test("sin premio nunca hay tres iguales", () => {
        const carton = rasca.generarCarton(null, rngFijo(0.5));
        const cuenta = rasca.contarSimbolos(carton);

        expect(carton).toHaveLength(9);
        expect(Object.values(cuenta).every((veces) => veces < 3)).toBe(true);
        expect(Object.values(cuenta).reduce((suma, veces) => suma + veces, 0)).toBe(9);
    });
});

describe("jugar", () => {
    test("una victoria paga el multiplicador y deja el neto en el historial", () => {
        const userId = nuevoUsuario(1000);
        // 0.75 cae en la cereza (×2); el resto del rng solo baraja el cartón.
        const partida = rasca.jugar(userId, GUILD, 100, { rng: rngFijo(0.75) });

        expect(partida).toMatchObject({ exito: true, apuesta: 100, gananciaTotal: 200, neto: 100, saldo: 1100 });
        expect(partida.resultado).toMatchObject({ simbolo: "🍒", multiplicador: 2 });
        expect(saldo(userId)).toBe(1100);

        const [fila] = partidas(userId);
        expect(fila).toMatchObject({ juego: "rasca", apuesta: 100, resultado: 100 });
        expect(JSON.parse(fila.detalle).carton).toEqual(partida.carton);
    });

    test("una derrota pierde solo la apuesta", () => {
        const userId = nuevoUsuario(1000);
        const partida = rasca.jugar(userId, GUILD, 100, { rng: rngFijo(0) });

        expect(partida).toMatchObject({ exito: true, resultado: null, gananciaTotal: 0, neto: -100, saldo: 900 });
        expect(saldo(userId)).toBe(900);
        expect(partidas(userId)[0]).toMatchObject({ juego: "rasca", apuesta: 100, resultado: -100 });
    });

    test("el RTP del servidor escala el premio neto, no la apuesta devuelta", () => {
        const userId = nuevoUsuario(1000);
        guildSettings.setSetting(GUILD, "casino.rtp_rasca", 50);

        const partida = rasca.jugar(userId, GUILD, 100, { rng: rngFijo(0.75) });

        expect(partida).toMatchObject({ gananciaTotal: 150, neto: 50, saldo: 1050 });
        expect(saldo(userId)).toBe(1050);
    });

    test("sin saldo suficiente no se registra la partida", () => {
        const userId = nuevoUsuario(50);
        const partida = rasca.jugar(userId, GUILD, 100, { rng: rngFijo(0.75) });

        expect(partida.exito).toBe(false);
        expect(typeof partida.mensaje).toBe("string");
        expect(partidas(userId)).toHaveLength(0);
        expect(saldo(userId)).toBe(50);
    });

    test("respeta el límite diario del servidor", () => {
        const userId = nuevoUsuario(1000);
        guildSettings.setSetting(GUILD, "casino.daily_limit", 1);

        expect(rasca.jugar(userId, GUILD, 100, { rng: rngFijo(0) }).exito).toBe(true);
        const segunda = rasca.jugar(userId, GUILD, 100, { rng: rngFijo(0) });

        expect(segunda.exito).toBe(false);
        expect(partidas(userId)).toHaveLength(1);
    });
});
