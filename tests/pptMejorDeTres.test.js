// #457: piedra, papel o tijera al mejor de tres contra el Duende. La apuesta se cobra una sola vez al empezar y es fija; gana quien
// gana dos manos (o quien lleva más tras la tercera; con las mismas, empate); se paga como una victoria suelta (×2) y una serie
// abandonada se cierra devolviendo la apuesta.
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const activeGames = require("../src/systems/activeGames");
const serieSistema = require("../src/systems/casino/pptSerie");
const ppt = require("../src/juegos/casino/ppt");
const pptSerie = require("../src/juegos/casino/pptSerie");
const casino = require("../src/paneles/casino");

let n = 0;
const jugador = (efectivo = 1000) => {
    const id = `ppt3-${++n}`;
    dinero.asegurarCuenta(id);
    db.prepare("UPDATE banco SET enMano = ? WHERE userId = ?").run(efectivo, id);
    return id;
};
const saldo = (id) => dinero.efectivo(id);
// El Duende elige (0 → piedra, 0.4 → papel, 0.7 → tijera).
const DUENDE = { piedra: 0.1, papel: 0.4, tijera: 0.7 };
let azar = null;
const duendeSaca = (...jugadas) => {
    azar = jest.spyOn(Math, "random");
    for (const j of jugadas) azar.mockReturnValueOnce(DUENDE[j]);
};
// Sin series a medias de un test al siguiente (si alguna queda abierta, se cierra devolviendo su apuesta).
beforeEach(() => serieSistema.limpiarAbandonadas(Date.now() + activeGames.ABANDON_MS + 1000));
afterEach(() => {
    azar?.mockRestore();
    azar = null;
});

const boton = (userId, customId, { dueno = userId } = {}) => ({
    customId,
    guildId: null,
    user: { id: userId, username: userId, tag: `${userId}#0` },
    message: { interaction: { user: { id: dueno } } },
    update: jest.fn(async () => {}),
    reply: jest.fn(async () => {}),
});
const pulsar = async (i) => {
    await pptSerie.handleButton(null, i);
    return i;
};
const ultimo = (i) => i.update.mock.calls.at(-1)[0];
const ids = (payload) => payload.components.flatMap((f) => f.toJSON().components.map((c) => c.custom_id));
const partidasPpt = (id) => db.prepare("SELECT resultado, detalle FROM casino WHERE userId = ? AND juego = 'ppt'").all(id);
const enCurso = (id) => db.prepare("SELECT apuesta FROM casino_partidas_activas WHERE userId = ?").all(id);

describe("las reglas", () => {
    const serie = (...tipos) => ({ manos: tipos.map((tipo) => ({ tipo })) });
    const V = "victoria";
    const D = "derrota";
    const E = "empate";

    test("gana quien llega a dos manos, o quien lleva más tras la tercera, y con las mismas es empate", () => {
        expect(serieSistema.resultadoFinal(serie(V))).toBeNull();
        expect(serieSistema.resultadoFinal(serie(V, E))).toBeNull();
        expect(serieSistema.resultadoFinal(serie(V, V))).toBe("victoria");
        expect(serieSistema.resultadoFinal(serie(D, D))).toBe("derrota");
        expect(serieSistema.resultadoFinal(serie(V, D))).toBeNull();
        expect(serieSistema.resultadoFinal(serie(V, D, V))).toBe("victoria");
        expect(serieSistema.resultadoFinal(serie(V, D, D))).toBe("derrota");
        expect(serieSistema.resultadoFinal(serie(V, D, E))).toBe("empate");
        expect(serieSistema.resultadoFinal(serie(E, E, E))).toBe("empate");
        expect(serieSistema.resultadoFinal(serie(V, E, E))).toBe("victoria");
        expect(serieSistema.resultadoFinal(serie(E, D, E))).toBe("derrota");
    });
});

describe("una serie completa", () => {
    test("se cobra una sola vez al empezar, la victoria paga lo mismo que una victoria suelta y queda como una partida", async () => {
        const u = jugador();
        duendeSaca("tijera", "tijera"); // piedra gana, piedra gana
        const i1 = await pulsar(boton(u, "casino_ppt3_ini_100_piedra"));
        expect(saldo(u)).toBe(900);
        expect(enCurso(u)).toEqual([{ apuesta: 100 }]);
        expect(ultimo(i1).embeds[0].toJSON().title).toBe("✂️ PPT al mejor de 3 · mano 2");
        expect(ultimo(i1).embeds[0].toJSON().description).toContain("Marcador:** tú 1 – 0 Duende");
        expect(ids(ultimo(i1))).toEqual(["casino_ppt3_sig_piedra", "casino_ppt3_sig_papel", "casino_ppt3_sig_tijera"]);
        expect(partidasPpt(u)).toEqual([]); // hasta el final no se registra nada

        const i2 = await pulsar(boton(u, "casino_ppt3_sig_piedra"));
        const fin = ultimo(i2);
        expect(fin.embeds[0].toJSON().title).toBe("🎉 ¡Ganaste la serie!");
        expect(fin.embeds[0].toJSON().description).toContain("Ganaste **100** monedas");
        expect(saldo(u)).toBe(1100);
        expect(enCurso(u)).toEqual([]);
        expect(serieSistema.de(u)).toBeNull();
        const filas = partidasPpt(u);
        expect(filas).toHaveLength(1);
        expect(filas[0].resultado).toBe(100);
        expect(JSON.parse(filas[0].detalle)).toMatchObject({ modo: "mejor_de_3" });
        expect(JSON.parse(filas[0].detalle).manos).toHaveLength(2);
        // Lo mismo que paga una victoria suelta.
        const v = jugador();
        duendeSaca("tijera", "azar");
        const suelta = {
            user: { id: v, username: v, tag: v },
            guildId: null,
            options: { getString: () => "piedra", getInteger: () => 100 },
            reply: jest.fn(),
        };
        await ppt.run(null, suelta);
        expect(partidasPpt(v)[0].resultado).toBe(100);
        expect(ids(fin)).toEqual(expect.arrayContaining(["casino_play_ppt_100", "casino_stats_ppt", "casino_home"]));
    });

    test("perder dos manos pierde la apuesta, una sola vez", async () => {
        const u = jugador();
        duendeSaca("papel", "papel");
        await pulsar(boton(u, "casino_ppt3_ini_100_piedra"));
        const fin = ultimo(await pulsar(boton(u, "casino_ppt3_sig_piedra")));
        expect(fin.embeds[0].toJSON().title).toBe("💀 Perdiste la serie");
        expect(fin.embeds[0].toJSON().description).toContain("Perdiste **100** monedas");
        expect(saldo(u)).toBe(900);
        expect(partidasPpt(u).map((p) => p.resultado)).toEqual([-100]);
    });

    test("tres manos: 1–1 y un empate devuelve la apuesta; 2–1 la paga", async () => {
        const empate = jugador();
        duendeSaca("tijera", "papel", "piedra"); // gana, pierde, empata
        await pulsar(boton(empate, "casino_ppt3_ini_100_piedra"));
        await pulsar(boton(empate, "casino_ppt3_sig_piedra"));
        const fin = ultimo(await pulsar(boton(empate, "casino_ppt3_sig_piedra")));
        expect(fin.embeds[0].toJSON().title).toBe("🤝 Serie empatada");
        expect(fin.embeds[0].toJSON().description).toContain("Recuperas tu apuesta");
        expect(saldo(empate)).toBe(1000);
        expect(partidasPpt(empate).map((p) => p.resultado)).toEqual([0]);

        const tres = jugador();
        duendeSaca("tijera", "papel", "tijera"); // gana, pierde, gana
        await pulsar(boton(tres, "casino_ppt3_ini_200_piedra"));
        await pulsar(boton(tres, "casino_ppt3_sig_piedra"));
        const ganada = ultimo(await pulsar(boton(tres, "casino_ppt3_sig_piedra")));
        expect(ganada.embeds[0].toJSON().title).toBe("🎉 ¡Ganaste la serie!");
        expect(saldo(tres)).toBe(1200);
    });

    test("la apuesta no cambia entre manos: las manos siguientes no cobran nada", async () => {
        const u = jugador();
        duendeSaca("piedra", "piedra"); // empates: la serie sigue
        await pulsar(boton(u, "casino_ppt3_ini_300_piedra"));
        await pulsar(boton(u, "casino_ppt3_sig_papel".replace("papel", "piedra")));
        expect(saldo(u)).toBe(700);
        expect(serieSistema.de(u).apuesta).toBe(300);
    });
});

describe("antes y durante la serie", () => {
    test("sin saldo, avisa en privado y no empieza ninguna serie", async () => {
        const u = jugador(50);
        const i = await pulsar(boton(u, "casino_ppt3_ini_100_piedra"));
        expect(i.reply.mock.calls[0][0].content).toMatch(/No te llega el efectivo/);
        expect(serieSistema.de(u)).toBeNull();
        expect(saldo(u)).toBe(50);
    });

    test("no se puede empezar otra mientras hay una en curso, ni jugar la de otro, ni seguir una que no existe", async () => {
        const u = jugador();
        duendeSaca("piedra");
        await pulsar(boton(u, "casino_ppt3_ini_100_piedra"));
        const otra = await pulsar(boton(u, "casino_ppt3_ini_100_papel"));
        expect(otra.reply.mock.calls[0][0].content).toMatch(/Ya tienes una serie/);
        expect(saldo(u)).toBe(900);
        const ajeno = await pulsar(boton(u, "casino_ppt3_sig_piedra", { dueno: "otra-persona" }));
        expect(ajeno.reply.mock.calls[0][0].content).toMatch(/Solo quien usó el comando/);
        const sinSerie = await pulsar(boton(jugador(), "casino_ppt3_sig_piedra"));
        expect(ultimo(sinSerie).content).toMatch(/ya no está en curso/);
        const invalida = await pulsar(boton(jugador(), "casino_ppt3_ini_100_lagarto"));
        expect(invalida.reply.mock.calls[0][0].content).toMatch(/no es válida/);
    });

    test("el panel ofrece las tres jugadas al mejor de 3 con el importe ya elegido", () => {
        const idsPanel = ids(casino.buildPickJugadaPpt("x", 250));
        expect(idsPanel).toEqual(
            expect.arrayContaining([
                "casino_play_ppt_250_piedra",
                "casino_ppt3_ini_250_piedra",
                "casino_ppt3_ini_250_papel",
                "casino_ppt3_ini_250_tijera",
            ]),
        );
    });
});

describe("una serie sin responder", () => {
    test("se cierra a los 15 minutos y se devuelve la apuesta", async () => {
        const u = jugador();
        duendeSaca("piedra");
        await pulsar(boton(u, "casino_ppt3_ini_100_piedra"));
        expect(saldo(u)).toBe(900);
        expect(serieSistema.limpiarAbandonadas(Date.now() + 10 * 60 * 1000)).toBe(0);
        expect(serieSistema.limpiarAbandonadas(Date.now() + activeGames.ABANDON_MS + 1000)).toBe(1);
        expect(saldo(u)).toBe(1000);
        expect(serieSistema.de(u)).toBeNull();
        expect(enCurso(u)).toEqual([]);
        expect(db.prepare("SELECT descripcion, cantidad FROM historial WHERE userId = ? ORDER BY id DESC LIMIT 1").get(u)).toEqual({
            descripcion: "Reembolso: PPT al mejor de 3 abandonado",
            cantidad: 100,
        });
        expect(partidasPpt(u)).toEqual([]);
    });

    test("empezar otra después de dejarla abandonada devuelve la anterior, y un reinicio del bot también la devuelve", async () => {
        const u = jugador();
        duendeSaca("piedra", "piedra");
        await pulsar(boton(u, "casino_ppt3_ini_100_piedra"));
        serieSistema.de(u).ultimaAccion = Date.now() - activeGames.ABANDON_MS - 1000;
        await pulsar(boton(u, "casino_ppt3_ini_100_papel"));
        expect(saldo(u)).toBe(900); // devuelta la primera (1.000) y cobrada la segunda
        expect(serieSistema.de(u).manos).toHaveLength(1);

        // El bot se reinicia a mitad de partida: lo apostado vuelve y la serie en memoria ya no existe.
        expect(activeGames.reembolsarPendientes()).toBeGreaterThanOrEqual(1);
        expect(saldo(u)).toBe(1000);
        expect(enCurso(u)).toEqual([]);
    });
});
