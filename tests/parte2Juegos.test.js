// Parte 2 del plan de paneles: todos los juegos empiezan en el selector del casino y acaban con la misma
// fila (🔄 Repetir · 🎲 Otra apuesta · 📊 Stats · ◀ Casino). Se juega desde los botones de /juegos → Casino.
const db = require("../src/core/db");
const guildSettings = require("../src/systems/guildSettings");
const juegos = require("../src/commands/juegos/juegos");

const G = "guild-parte2";
guildSettings.setSetting(G, "casino.global_cooldown_sec", 0);
guildSettings.setSetting(G, "casino.daily_limit", 0);

let n = 0;
function jugador(saldo) {
    const id = `p2-${++n}`;
    db.prepare("INSERT INTO banco (userId, saldo, enMano) VALUES (?, 0, ?)").run(id, saldo);
    return id;
}
const saldo = (id) => db.prepare("SELECT enMano AS saldo FROM banco WHERE userId = ?").get(id).saldo;

function boton(userId, customId) {
    return {
        customId,
        guildId: G,
        guild: { id: G },
        user: { id: userId, username: userId, tag: userId },
        message: { interaction: { user: { id: userId } } },
        update: jest.fn(async () => {}),
        reply: jest.fn(async () => {}),
        followUp: jest.fn(async () => {}),
        deferUpdate: jest.fn(async () => {}),
        editReply: jest.fn(async () => {}),
        showModal: jest.fn(async () => {}),
    };
}
const pulsar = async (userId, customId) => {
    const i = boton(userId, customId);
    // Como el router: casino_* lo atiende /juegos; los botones de dentro de cada partida, su juego.
    const modulo = customId.startsWith("adivinar_")
        ? require("../src/juegos/casino/adivinar")
        : customId.startsWith("bj_")
          ? require("../src/juegos/casino/blackjack")
          : juegos;
    await modulo.handleButton(null, i);
    return i;
};
const idsFila = (payload) => payload.components.at(-1).components.map((b) => b.data.custom_id);

test("el casino tiene botón de PPT y adivinar pasa por el selector de importes", async () => {
    const u = jugador(1000);
    const home = (await pulsar(u, "casino_home")).update.mock.calls[0][0];
    const ids = home.components[0].components.map((b) => b.data.custom_id);
    expect(ids).toEqual(expect.arrayContaining(["casino_pick_adivinar", "casino_pick_ppt"]));
    const pick = (await pulsar(u, "casino_pick_adivinar")).update.mock.calls[0][0];
    expect(pick.components[0].components[0].data.custom_id).toBe("casino_play_adivinar_50");
});

test("PPT desde el panel: importe, jugada y la fila común al acabar", async () => {
    const u = jugador(1000);
    const elegir = (await pulsar(u, "casino_play_ppt_100")).update.mock.calls[0][0];
    expect(elegir.components[0].components.map((b) => b.data.custom_id)).toEqual([
        "casino_play_ppt_100_piedra",
        "casino_play_ppt_100_papel",
        "casino_play_ppt_100_tijera",
    ]);
    const jugada = await pulsar(u, "casino_play_ppt_100_piedra");
    const resultado = jugada.update.mock.calls[0][0];
    expect(idsFila(resultado)).toEqual(["casino_play_ppt_100", "casino_pick_ppt", "casino_stats_ppt", "casino_home"]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM casino WHERE userId = ? AND juego = 'ppt'").get(u).n).toBe(1);
});

test("adivinar: se elige el importe y perder en la ronda 1 cuenta como derrota", async () => {
    const u = jugador(1000);
    // Con Math.random = 0 la baraja sale siempre igual: se calcula la primera carta para fallar a propósito.
    const random = jest.spyOn(Math, "random").mockReturnValue(0);
    const palos = ["♠", "♣", "♥", "♦"];
    const valores = [2, 3, 4, 5, 6, 7, 8, 9, 10, "J", "Q", "K", "A"];
    const baraja = palos.flatMap((palo) => valores.map((valor) => ({ palo, valor })));
    for (let i = baraja.length - 1; i > 0; i--) [baraja[i], baraja[0]] = [baraja[0], baraja[i]];
    const esRoja = ["♥", "♦"].includes(baraja.at(-1).palo);

    const inicio = await pulsar(u, "casino_play_adivinar_200");
    expect(inicio.update.mock.calls[0][0].embeds[0].data.title).toMatch(/Ronda 1\/4/);
    expect(saldo(u)).toBe(800);

    const fallo = await pulsar(u, esRoja ? "adivinar_color_negro" : "adivinar_color_rojo");
    random.mockRestore();
    const fin = fallo.update.mock.calls[0][0];
    expect(fin.embeds[0].data.title).toBe("❌ Fin del juego");
    expect(idsFila(fin)).toEqual(["casino_play_adivinar_200", "casino_pick_adivinar", "casino_stats_adivinar", "casino_home"]);
    // Antes se guardaba con resultado 0 (como un empate) y 0 en el historial.
    expect(db.prepare("SELECT resultado FROM casino WHERE userId = ? AND juego = 'adivinar'").get(u).resultado).toBe(-200);
    expect(db.prepare("SELECT cantidad FROM historial WHERE userId = ?").get(u).cantidad).toBe(-200);
});

test("blackjack acaba con la fila común (Repetir con la apuesta del principio)", async () => {
    const bj = require("../src/systems/blackjack");
    const real = jest.requireActual("../src/systems/blackjack").nuevaPartida;
    const c = (value) => ({ value, suit: "♠️", display: String(value) });
    jest.spyOn(bj, "nuevaPartida").mockImplementationOnce((o) => real({ ...o, baraja: [5, 6, 10, 6, 10, 10].map(c), rng: () => 0 }));
    const u = jugador(1000);
    await pulsar(u, "casino_play_blackjack_100");
    const doblar = await pulsar(u, "bj_double");
    expect(idsFila(doblar.update.mock.calls[0][0])).toEqual([
        "casino_play_blackjack_100",
        "casino_pick_blackjack",
        "casino_stats_blackjack",
        "casino_home",
    ]);
});

test("sin saldo, el aviso sale aparte y el panel no se toca", async () => {
    const u = jugador(10);
    for (const id of [
        "casino_play_tragaperras_500",
        "casino_play_blackjack_500",
        "casino_play_adivinar_500",
        "casino_play_ruleta_500_color_rojo",
    ]) {
        const i = await pulsar(u, id);
        expect(i.update).not.toHaveBeenCalled();
        expect(i.reply).toHaveBeenCalledWith(expect.objectContaining({ flags: expect.any(Number) }));
    }
    expect(saldo(u)).toBe(10);
});

test("las stats de un juego solo cuentan ese juego (la tragaperras incluye las antiguas 'slots')", async () => {
    const u = jugador(0);
    const partida = db.prepare(
        "INSERT INTO casino (userId, juego, fecha, apuesta, resultado, detalle) VALUES (?, ?, '2026-09-01', 100, ?, '{}')",
    );
    partida.run(u, "tragaperras", 50);
    partida.run(u, "slots", -100);
    partida.run(u, "ruleta", 500);
    const stats = (await pulsar(u, "casino_stats_tragaperras")).update.mock.calls[0][0];
    expect(stats.embeds[0].data.title).toMatch(/Tragaperras/);
    expect(stats.embeds[0].data.fields[0].value).toMatch(/Partidas: \*\*2\*\*/);
    expect(stats.components[0].components[0].data.custom_id).toBe("casino_pick_tragaperras");
});

describe("tragaperras y ruleta (con la animación en relojes simulados)", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());
    const jugarCon = async (userId, customId) => {
        const i = boton(userId, customId);
        const partida = juegos.handleButton(null, i);
        await jest.runAllTimersAsync();
        await partida;
        return i;
    };

    test("tragaperras: fila común al acabar", async () => {
        const u = jugador(1000);
        const i = await jugarCon(u, "casino_play_tragaperras_100");
        expect(i.deferUpdate).toHaveBeenCalled();
        expect(idsFila(i.editReply.mock.calls.at(-1)[0])).toEqual([
            "casino_play_tragaperras_100",
            "casino_pick_tragaperras",
            "casino_stats_tragaperras",
            "casino_home",
        ]);
    });

    test("ruleta: Repetir lleva también el tipo de apuesta", async () => {
        const u = jugador(1000);
        const i = await jugarCon(u, "casino_play_ruleta_100_docena_2");
        expect(idsFila(i.editReply.mock.calls.at(-1)[0])).toEqual([
            "casino_play_ruleta_100_docena_2",
            "casino_ruleta",
            "casino_stats_ruleta",
            "casino_home",
        ]);
    });
});
