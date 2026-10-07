// /blackjack de principio a fin (BD en memoria): lo que se cobra y se paga en cada jugada.
const db = require("../src/core/db");
const guildSettings = require("../src/systems/guildSettings");
const bj = require("../src/systems/blackjack");
const blackjack = require("../src/juegos/casino/blackjack");

const GUILD = "guild-bj";
guildSettings.setSetting(GUILD, "casino.global_cooldown_sec", 0);
guildSettings.setSetting(GUILD, "casino.daily_limit", 0);
guildSettings.setSetting(GUILD, "casino.rtp_blackjack", 100);

const c = (value) => ({ value, suit: "♠️", display: String(value) });
// Las cartas salen en el orden dado: jugador, jugador, crupier, crupier, y luego las que se pidan.
function conBaraja(valores) {
    const real = jest.requireActual("../src/systems/blackjack").nuevaPartida;
    jest.spyOn(bj, "nuevaPartida").mockImplementationOnce((o) => real({ ...o, baraja: valores.map(c), rng: () => 0 }));
}

let n = 0;
function jugador(saldo = 1000) {
    const id = `bj-${++n}`;
    db.prepare("INSERT INTO banco (userId, saldo, enMano) VALUES (?, 0, ?)").run(id, saldo);
    return id;
}
const saldo = (id) => db.prepare("SELECT enMano AS saldo FROM banco WHERE userId = ?").get(id).saldo;

function interaccion(userId, extra = {}) {
    const i = {
        user: { id: userId, username: userId, tag: userId },
        guildId: GUILD,
        respuestas: [],
        reply: jest.fn(async (p) => i.respuestas.push(p)),
        update: jest.fn(async (p) => i.respuestas.push(p)),
        options: { getInteger: () => 100 },
        ...extra,
    };
    return i;
}
const boton = (userId, customId) => blackjack.handleButton(null, interaccion(userId, { customId }));
const titulo = (i) => i.respuestas.at(-1).embeds?.[0]?.data.title;

test("doblar y ganar: cobra la segunda apuesta y paga el doble de las dos", async () => {
    const u = jugador();
    conBaraja([5, 6, 10, 6, 10, 10]); // jugador 11 + 10 = 21; crupier 16 + 10 = 26
    await blackjack.run(null, interaccion(u));
    expect(saldo(u)).toBe(900);
    const i = interaccion(u, { customId: "bj_double" });
    await blackjack.handleButton(null, i);
    expect(titulo(i)).toBe("🃏 Blackjack - Resultado (Doblar)");
    expect(saldo(u)).toBe(1200 - 10); // -200 apostado, +400 de ganancia total, -10 de impuesto (5% de los 200 netos)
});

test("split: se cobra la segunda apuesta y cada mano se liquida por separado", async () => {
    const u = jugador();
    conBaraja([8, 8, 10, 8, 10, 3]); // manos 18 y 11 · crupier 18
    await blackjack.run(null, interaccion(u));
    await boton(u, "bj_split");
    expect(saldo(u)).toBe(800);
    await boton(u, "bj_stand_split"); // mano 1: 18 (empate)
    const i = interaccion(u, { customId: "bj_stand_split" }); // mano 2: 11 (pierde)
    await blackjack.handleButton(null, i);
    expect(titulo(i)).toBe("🃏 Blackjack - Split");
    expect(saldo(u)).toBe(900); // recupera la apuesta de la mano empatada
});

test("pasarse pidiendo carta pierde la apuesta y cierra la partida", async () => {
    const u = jugador();
    conBaraja([10, 6, 10, 7, 10]);
    await blackjack.run(null, interaccion(u));
    const i = interaccion(u, { customId: "bj_hit" });
    await blackjack.handleButton(null, i);
    expect(titulo(i)).toBe("🃏 Blackjack - ¡Te pasaste!");
    expect(saldo(u)).toBe(900);
    // Ya no hay partida: se puede empezar otra.
    conBaraja([10, 7, 10, 8]);
    const otra = interaccion(u);
    await blackjack.run(null, otra);
    expect(titulo(otra)).toBe("🃏 Blackjack");
});
