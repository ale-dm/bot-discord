// #462: doble o nada tras ganar. El botón sale con la ganancia como importe y solo se puede usar una vez por victoria; perder la
// segunda ronda descuenta solo la ganancia en juego (el saldo de antes de la partida no se toca); ganarla la duplica, y el
// casino lo apunta como una partida distinta.
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const casinoTx = require("../src/systems/casinoTransactions");
const dobleSistema = require("../src/systems/casino/dobleONada");
const dobleJuego = require("../src/juegos/casino/dobleONada");
const ppt = require("../src/juegos/casino/ppt");
const casino = require("../src/paneles/casino");
const autoexclusion = require("../src/systems/casinoAutoexclusion");

let n = 0;
const jugador = (efectivo = 1000) => {
    const id = `doble-${++n}`;
    dinero.asegurarCuenta(id);
    db.prepare("UPDATE banco SET enMano = ? WHERE userId = ?").run(efectivo, id);
    return id;
};
const saldo = (id) => dinero.efectivo(id);
const filas = (id, juego) =>
    db.prepare("SELECT resultado, apuesta, detalle FROM casino WHERE userId = ? AND juego = ? ORDER BY id").all(id, juego);
const ids = (payload) => payload.components.flatMap((f) => f.toJSON().components.map((c) => c.custom_id));
const etiquetas = (payload) => payload.components.flatMap((f) => f.toJSON().components.map((c) => c.label));

let azar = null;
/** Las siguientes llamadas a Math.random (la primera suele ser la jugada del Duende; las demás, la tirada del doble). */
const random = (...valores) => {
    azar = jest.spyOn(Math, "random");
    for (const v of valores) azar.mockReturnValueOnce(v);
};
afterEach(() => {
    azar?.mockRestore();
    azar = null;
});

/** Gana una partida suelta de ppt (jugador con `efectivo`, apuesta `cantidad`) y devuelve lo que se le muestra. */
async function ganarPpt(u, cantidad = 100) {
    random(0.7, 0); // el Duende saca tijera: piedra gana
    const reply = jest.fn();
    await ppt.run(null, {
        user: { id: u, username: u, tag: u },
        guildId: null,
        options: { getString: () => "piedra", getInteger: () => cantidad },
        reply,
    });
    azar.mockRestore();
    return reply.mock.calls[0][0];
}
const boton = (userId, customId, { dueno = userId } = {}) => ({
    customId,
    guildId: null,
    user: { id: userId },
    message: { interaction: { user: { id: dueno } } },
    update: jest.fn(async () => {}),
    reply: jest.fn(async () => {}),
});

describe("la oferta", () => {
    test("tras una victoria sale el botón con la ganancia como importe; tras una derrota o un empate, no", async () => {
        const u = jugador();
        const victoria = await ganarPpt(u, 100);
        expect(ids(victoria)).toContain("casino_doble_ppt");
        expect(etiquetas(victoria)).toContain("🎲 Doble o nada (100)");
        expect(dobleSistema.oferta(u, "ppt").ganancia).toBe(100);

        const v = jugador();
        random(0.1, 0); // piedra contra piedra: empate
        const empate = { reply: jest.fn() };
        await ppt.run(null, {
            user: { id: v, username: v, tag: v },
            guildId: null,
            options: { getString: () => "piedra", getInteger: () => 100 },
            ...empate,
        });
        azar.mockRestore();
        expect(ids(empate.reply.mock.calls[0][0])).not.toContain("casino_doble_ppt");

        const w = jugador();
        random(0.4, 0); // papel gana a piedra: derrota
        const derrota = { reply: jest.fn() };
        await ppt.run(null, {
            user: { id: w, username: w, tag: w },
            guildId: null,
            options: { getString: () => "piedra", getInteger: () => 100 },
            ...derrota,
        });
        azar.mockRestore();
        expect(ids(derrota.reply.mock.calls[0][0])).not.toContain("casino_doble_ppt");
        expect(dobleSistema.oferta(w, "ppt")).toBeNull();
    });

    test("la oferta caduca a los 10 minutos, es del juego donde se ganó y empezar otra partida la retira", async () => {
        const u = jugador();
        await ganarPpt(u);
        expect(dobleSistema.oferta(u, "blackjack")).toBeNull();
        expect(dobleSistema.oferta(u, "ppt", Date.now() + dobleSistema.TTL_MS - 1000)).not.toBeNull();
        expect(dobleSistema.oferta(u, "ppt", Date.now() + dobleSistema.TTL_MS + 1000)).toBeNull();

        const v = jugador();
        await ganarPpt(v);
        casinoTx.descontarApuesta(v, 50, null, "ruleta");
        expect(dobleSistema.oferta(v, "ppt")).toBeNull();
    });

    test("las ganancias de un mismo juego se suman (las dos manos de un split), y la segunda ronda no ofrece otra", () => {
        const u = jugador();
        dobleSistema.ofrecer(u, "blackjack", 100, { apuesta: 100 });
        dobleSistema.ofrecer(u, "blackjack", 150, { apuesta: 100 });
        expect(dobleSistema.oferta(u, "blackjack").ganancia).toBe(250);
        dobleSistema.ofrecer(u, "ruleta", 40);
        expect(dobleSistema.oferta(u, "ruleta").ganancia).toBe(40); // otro juego: empieza de cero
        expect(dobleSistema.ofrecer(u, dobleSistema.JUEGO, 500)).toBeNull();
        expect(dobleSistema.ofrecer(u, "ppt", 0)).toBeNull();
    });
});

describe("jugar el doble o nada", () => {
    test("ganar duplica la ganancia, y el historial del casino lo registra como una partida distinta", async () => {
        const u = jugador();
        await ganarPpt(u, 100); // 1.000 → 1.100
        expect(saldo(u)).toBe(1100);
        random(0.2); // < 0.5: gana
        const i = boton(u, "casino_doble_ppt");
        await dobleJuego.handleButton(null, i);
        expect(saldo(u)).toBe(1200); // la ganancia de 100 pasa a 200
        const resultado = i.update.mock.calls[0][0];
        expect(resultado.embeds[0].toJSON().title).toContain("¡Doble!");
        expect(resultado.embeds[0].toJSON().description).toContain("Ahora son **200**");
        expect(filas(u, "doble_o_nada")).toHaveLength(1);
        expect(filas(u, "doble_o_nada")[0]).toMatchObject({ resultado: 100, apuesta: 100 });
        expect(JSON.parse(filas(u, "doble_o_nada")[0].detalle)).toMatchObject({ origen: "ppt", ganancia: 100, gana: true });
        expect(filas(u, "ppt")).toHaveLength(1); // la partida original sigue siendo la suya
        expect(db.prepare("SELECT descripcion, cantidad FROM historial WHERE userId = ? ORDER BY id DESC LIMIT 1").get(u).cantidad).toBe(
            100,
        );
    });

    test("perder descuenta solo la ganancia en juego: el saldo de antes de la partida queda intacto", async () => {
        const u = jugador();
        await ganarPpt(u, 100);
        random(0.9); // >= 0.5: pierde
        const i = boton(u, "casino_doble_ppt");
        await dobleJuego.handleButton(null, i);
        expect(saldo(u)).toBe(1000); // el de antes de jugar
        expect(i.update.mock.calls[0][0].embeds[0].toJSON().description).toContain("Lo que tenías antes de la partida sigue intacto");
        expect(filas(u, "doble_o_nada")[0].resultado).toBe(-100);
    });

    test("solo se puede usar una vez por victoria y el resultado no ofrece otro doble o nada", async () => {
        const u = jugador();
        await ganarPpt(u);
        random(0.2);
        const i = boton(u, "casino_doble_ppt");
        await dobleJuego.handleButton(null, i);
        const filaFin = i.update.mock.calls[0][0];
        expect(ids(filaFin)).toEqual(["casino_pick_ppt", "casino_stats_doble_o_nada", "casino_home"]);
        const otra = boton(u, "casino_doble_ppt");
        await dobleJuego.handleButton(null, otra);
        expect(otra.reply.mock.calls[0][0].content).toMatch(/ya no está disponible/);
        expect(saldo(u)).toBe(1200);
        expect(filas(u, "doble_o_nada")).toHaveLength(1);
    });

    test("solo lo juega quien ganó, y sin oferta no hay nada que jugar", async () => {
        const u = jugador();
        await ganarPpt(u);
        const ajeno = boton(u, "casino_doble_ppt", { dueno: "otra-persona" });
        await dobleJuego.handleButton(null, ajeno);
        expect(ajeno.reply.mock.calls[0][0].content).toMatch(/Solo quien usó el comando/);
        expect(dobleSistema.oferta(u, "ppt")).not.toBeNull(); // la oferta sigue ahí
        const sin = boton(jugador(), "casino_doble_ppt");
        await dobleJuego.handleButton(null, sin);
        expect(sin.reply.mock.calls[0][0].content).toMatch(/ya no está disponible/);
    });

    test("si ya no le llega el efectivo para jugarse la ganancia, avisa, no cobra y conserva la oferta", async () => {
        const u = jugador();
        await ganarPpt(u, 100);
        dinero.ingresar(u, saldo(u)); // todo al banco
        const i = boton(u, "casino_doble_ppt");
        await dobleJuego.handleButton(null, i);
        expect(i.reply.mock.calls[0][0].content).toMatch(/No te llega el efectivo/);
        expect(dobleSistema.oferta(u, "ppt").ganancia).toBe(100);
        expect(filas(u, "doble_o_nada")).toEqual([]);
    });

    test("una autoexclusión del casino también bloquea el doble o nada", async () => {
        const u = jugador();
        await ganarPpt(u);
        autoexclusion.activar(u, "dia");
        const i = boton(u, "casino_doble_ppt");
        await dobleJuego.handleButton(null, i);
        expect(i.reply.mock.calls[0][0].content).toMatch(/autoexcluido/);
        expect(saldo(u)).toBe(1100);
    });

    test("el casino sabe nombrar la partida «doble_o_nada» en sus stats", () => {
        const u = jugador();
        const panel = casino.buildStats(u, "x", dobleSistema.JUEGO);
        expect(JSON.stringify(panel.embeds[0].toJSON())).toContain("Doble o nada");
    });
});

describe("en los demás juegos", () => {
    test("una victoria de ruleta, tragaperras, adivinar o blackjack registra la oferta con su ganancia neta", () => {
        for (const juego of ["ruleta", "tragaperras", "adivinar", "blackjack"]) {
            const u = jugador();
            casinoTx.descontarApuesta(u, 100, null, juego);
            expect(casinoTx.procesarGanancia(u, juego, 100, 250, "prueba", { guildId: null })).toBe(true);
            expect(dobleSistema.oferta(u, juego)).toMatchObject({ ganancia: 150, apuesta: 100 });
            // Y su fila de fin de partida la ofrece.
            expect(ids({ components: [casino.filaFinJuego(juego, 100, { userId: u })] })).toContain(`casino_doble_${juego}`);
            expect(ids({ components: [casino.filaFinJuego(juego, 100)] })).not.toContain(`casino_doble_${juego}`);
        }
    });

    test("un empate (se devuelve la apuesta) no ofrece nada", () => {
        const u = jugador();
        casinoTx.descontarApuesta(u, 100, null, "blackjack");
        casinoTx.procesarGanancia(u, "blackjack", 100, 100, "empate", { guildId: null });
        expect(dobleSistema.oferta(u, "blackjack")).toBeNull();
    });
});
