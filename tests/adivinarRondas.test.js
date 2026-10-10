// Adivinar (#241): cada ronda con acierto y con fallo, el retiro en la ronda 3 y en la 4, la partida que ya está en
// curso, el aviso sin partida, y la partida abandonada. El mazo es fijo: con Math.random casi 1 el barajado no cambia
// nada, así que la carta de cada ronda es siempre la misma (A♦, K♦, Q♦, J♦).
const db = require("../src/core/db");
const guildSettings = require("../src/systems/guildSettings");
const adivinar = require("../src/juegos/casino/adivinar");

const G = "g-adivinar-rondas";
guildSettings.setSetting(G, "casino.global_cooldown_sec", 0);
guildSettings.setSetting(G, "casino.daily_limit", 0);

let n = 0;
function jugador() {
    const id = `adv-${++n}`;
    db.prepare("INSERT INTO banco (userId, saldo, enMano) VALUES (?, 0, ?)").run(id, 100000);
    return id;
}
const resultadoDe = (id) =>
    db.prepare("SELECT resultado FROM casino WHERE userId = ? AND juego = 'adivinar' ORDER BY id DESC LIMIT 1").get(id)?.resultado;

function interaccion(userId, { customId = null, apuesta = 100 } = {}) {
    return {
        customId,
        guildId: G,
        guild: { id: G },
        user: { id: userId, username: userId, tag: userId },
        options: { getInteger: () => apuesta, getString: () => null },
        reply: jest.fn(async () => {}),
        update: jest.fn(async () => {}),
        isButton: () => true,
    };
}
const textoDe = (embed) => JSON.stringify(embed.data ?? embed);
const ultimoEmbed = (mock) => mock.mock.calls.at(-1)[0].embeds[0];

beforeEach(() => {
    jest.spyOn(Math, "random").mockReturnValue(0.999999);
});
afterEach(() => {
    jest.restoreAllMocks();
});

async function empezar(id, apuesta = 100) {
    const i = interaccion(id, { apuesta });
    await adivinar.run(null, i);
    return i;
}
async function pulsar(id, customId) {
    const i = interaccion(id, { customId });
    await adivinar.handleButton(null, i);
    return i;
}

describe("rondas", () => {
    test("acertar las cuatro y elegir un palo acertado paga, y la partida se cierra", async () => {
        const u = jugador();
        await empezar(u);
        const r1 = await pulsar(u, "adivinar_color_rojo");
        expect(textoDe(ultimoEmbed(r1.update))).toContain("`200` monedas"); // x2 de la apuesta de 100
        const r2 = await pulsar(u, "adivinar_menor");
        expect(textoDe(ultimoEmbed(r2.update))).toContain("Ronda 3/4");
        expect(textoDe(ultimoEmbed(r2.update))).toContain("300"); // x1,5 en total
        const r3 = await pulsar(u, "adivinar_fuera");
        expect(textoDe(ultimoEmbed(r3.update))).toContain("Ronda 4/4");
        expect(textoDe(ultimoEmbed(r3.update))).toContain("399"); // x1,33 en total
        const r4 = await pulsar(u, "adivinar_palo_♦");
        expect(textoDe(ultimoEmbed(r4.update))).toContain("Victoria");
        expect(resultadoDe(u)).toBeGreaterThan(0);
    });

    test("fallar en la ronda 2 pierde la apuesta y cierra la partida", async () => {
        const u = jugador();
        await empezar(u);
        await pulsar(u, "adivinar_color_rojo");
        const f = await pulsar(u, "adivinar_mayor");
        expect(textoDe(ultimoEmbed(f.update))).toContain("Fin del juego");
        expect(resultadoDe(u)).toBe(-100);
    });

    test("fallar en la ronda 3 pierde la apuesta", async () => {
        const u = jugador();
        await empezar(u);
        await pulsar(u, "adivinar_color_rojo");
        await pulsar(u, "adivinar_menor");
        const f = await pulsar(u, "adivinar_dentro");
        expect(textoDe(ultimoEmbed(f.update))).toContain("Fin del juego");
        expect(resultadoDe(u)).toBe(-100);
    });

    test("fallar el palo en la ronda 4 pierde la apuesta", async () => {
        const u = jugador();
        await empezar(u);
        await pulsar(u, "adivinar_color_rojo");
        await pulsar(u, "adivinar_menor");
        await pulsar(u, "adivinar_fuera");
        const f = await pulsar(u, "adivinar_palo_♠");
        expect(textoDe(ultimoEmbed(f.update))).toContain("Fin del juego");
        expect(resultadoDe(u)).toBe(-100);
    });

    test("fallar el color en la ronda 1 pierde la apuesta", async () => {
        const u = jugador();
        await empezar(u);
        const f = await pulsar(u, "adivinar_color_negro");
        expect(textoDe(ultimoEmbed(f.update))).toContain("Fin del juego");
        expect(resultadoDe(u)).toBe(-100);
    });
});

describe("retirarse", () => {
    test("en la ronda 3 cobra lo acumulado", async () => {
        const u = jugador();
        await empezar(u);
        await pulsar(u, "adivinar_color_rojo");
        await pulsar(u, "adivinar_menor");
        const r = await pulsar(u, "adivinar_retirarse_3");
        expect(textoDe(ultimoEmbed(r.update))).toContain("Te has retirado");
        expect(resultadoDe(u)).toBeGreaterThan(0);
    });

    test("en la ronda 4 cobra lo acumulado", async () => {
        const u = jugador();
        await empezar(u);
        await pulsar(u, "adivinar_color_rojo");
        await pulsar(u, "adivinar_menor");
        await pulsar(u, "adivinar_fuera");
        const r = await pulsar(u, "adivinar_retirarse_4");
        expect(textoDe(ultimoEmbed(r.update))).toContain("Te has retirado");
        expect(resultadoDe(u)).toBeGreaterThan(0);
    });
});

describe("el resto de caminos", () => {
    test("sin importe elegido, se muestra el selector y no empieza ninguna partida", async () => {
        const u = jugador();
        const i = interaccion(u, { apuesta: null });
        i.options.getInteger = () => null;
        await adivinar.run(null, i);
        expect(i.reply).toHaveBeenCalledTimes(1);
        expect(i.reply.mock.calls[0][0].embeds[0].data.title).toContain("Elige tu apuesta");
        const boton = await pulsar(u, "adivinar_color_rojo");
        expect(boton.reply.mock.calls[0][0].content).toContain("No tienes una partida activa");
    });

    test("con una partida en curso, empezar otra avisa y no cobra", async () => {
        const u = jugador();
        await empezar(u);
        const i = await empezar(u);
        expect(i.reply.mock.calls[0][0].content).toContain("Ya tienes una partida de Adivinar en curso");
    });

    test("un botón sin partida activa avisa", async () => {
        const u = jugador();
        const i = await pulsar(u, "adivinar_color_rojo");
        expect(i.reply.mock.calls[0][0].content).toContain("No tienes una partida activa");
    });

    test("los botones de la pantalla antigua vuelven al selector", async () => {
        const u = jugador();
        const i = await pulsar(u, "adivinar_cancelar");
        expect(i.update).toHaveBeenCalledTimes(1);
    });

    test("una partida abandonada (más de 15 min sin tocar) se liquida como perdida al limpiar", async () => {
        const u = jugador();
        const ahora = Date.now();
        const spy = jest.spyOn(Date, "now");
        try {
            spy.mockReturnValue(ahora);
            await empezar(u);
            spy.mockReturnValue(ahora + 16 * 60 * 1000);
            adivinar.limpiarAbandonadas();
            expect(resultadoDe(u)).toBe(-100);
        } finally {
            spy.mockRestore();
        }
    });
});
