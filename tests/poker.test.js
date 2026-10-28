// 🃏 Póker Texas hold'em (#531): ciegas y orden de los turnos (también a dos), acciones válidas según el turno y la apuesta,
// una mano entera hasta el showdown, botes laterales con all-in, bote dividido, retirarse por tiempo, y las mesas con el
// dinero: sentarse y levantarse una sola vez, fichas y estadísticas al acabar la mano, tres tiempos agotados, mesas que cortó
// un reinicio, y la mano en juego en Discord (botones, turno por tiempo y siguiente mano).
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const mano = require("../src/systems/poker/mano");
const mesas = require("../src/systems/poker/mesas");
const juego = require("../src/discord/envios/poker");
const pokerCmd = require("../src/commands/juegos/poker");
const { mensajeMesa } = require("../src/paneles/poker");

const PALO = { s: "♠️", h: "♥️", d: "♦️", c: "♣️" };
const RANGO = { T: 10, J: 11, Q: 12, K: 13, A: 14 };
const carta = (t) => ({ rango: RANGO[t[0]] || Number(t[0]), palo: PALO[t[1]], texto: t });
/**
 * Una baraja que reparte en este orden (con rng = 0 siempre sale la primera): primera carta de cada jugador, segunda de cada
 * uno, flop, turn y river.
 */
const baraja = (texto) => texto.split(" ").map(carta);
const rng = () => 0;
const nueva = (asientos, cartas, extra = {}) =>
    mano.nuevaMano({ asientos: asientos.map(([userId, fichas]) => ({ userId, fichas })), baraja: baraja(cartas), rng, ...extra });
const fichas = (m) => Object.fromEntries(m.jugadores.map((j) => [j.userId, j.fichas]));
const turno = (m) => m.jugadores[m.turno]?.userId;

describe("una mano", () => {
    test("con tres, ciega pequeña y grande tras el botón y habla el siguiente; a dos, el botón pone la pequeña y habla primero", () => {
        const m = nueva(
            [
                ["a", 1000],
                ["b", 1000],
                ["c", 1000],
            ],
            "2s 3s 4s 5s 6s 7s 8s 9s Ts Js Qs",
        );
        expect(m.jugadores.map((j) => j.apostadoCalle)).toEqual([0, 50, 100]);
        expect(turno(m)).toBe("a");
        const d = nueva(
            [
                ["a", 1000],
                ["b", 1000],
            ],
            "2s 3s 4s 5s 6s 7s 8s 9s Ts",
        );
        expect(d.jugadores.map((j) => j.apostadoCalle)).toEqual([50, 100]);
        expect(turno(d)).toBe("a");
        mano.actuar(d, "a", { tipo: "igualar" });
        mano.actuar(d, "b", { tipo: "pasar" });
        expect([d.calle, turno(d)]).toEqual(["flop", "b"]);
    });

    test("solo se actúa en tu turno y con acciones válidas", () => {
        const m = nueva(
            [
                ["a", 1000],
                ["b", 1000],
                ["c", 1000],
            ],
            "2s 3s 4s 5s 6s 7s 8s 9s Ts Js Qs",
        );
        expect(mano.actuar(m, "b", { tipo: "igualar" }).motivo).toMatch(/No es tu turno/);
        expect(mano.actuar(m, "a", { tipo: "pasar" }).motivo).toMatch(/hay una apuesta/);
        expect(mano.actuar(m, "a", { tipo: "subir", total: 150 }).motivo).toMatch(/de 200 a 1000/);
        expect(mano.acciones(m)).toMatchObject({ igualar: 100, subirMin: 200, subirMax: 1000, puedeSubir: true });
    });

    test("si todos se retiran, la ciega grande se lleva el bote sin enseñar cartas", () => {
        const m = nueva(
            [
                ["a", 1000],
                ["b", 1000],
                ["c", 1000],
            ],
            "2s 3s 4s 5s 6s 7s 8s 9s Ts Js Qs",
        );
        mano.actuar(m, "a", { tipo: "retirarse" });
        mano.actuar(m, "b", { tipo: "retirarse" });
        expect(m.fin).toBe(true);
        expect(m.resultado.showdown).toBe(false);
        expect(fichas(m)).toEqual({ a: 1000, b: 950, c: 1050 });
    });

    test("una subida obliga a hablar otra vez a quien ya había igualado", () => {
        const m = nueva(
            [
                ["a", 1000],
                ["b", 1000],
                ["c", 1000],
            ],
            "2s 3s 4s 5s 6s 7s 8s 9s Ts Js Qs",
        );
        mano.actuar(m, "a", { tipo: "igualar" });
        mano.actuar(m, "b", { tipo: "igualar" });
        mano.actuar(m, "c", { tipo: "subir", total: 300 });
        expect(turno(m)).toBe("a");
        expect(m.calle).toBe("preflop");
    });

    test("hasta el showdown gana la mejor mano y las fichas no se crean ni se pierden", () => {
        // a: A A · b: K K · mesa: 2 7 9 J 4 (sin color ni escalera).
        const m = nueva(
            [
                ["a", 1000],
                ["b", 1000],
            ],
            "Ah Kh As Ks 2d 7c 9s Jd 4c",
        );
        mano.actuar(m, "a", { tipo: "igualar" });
        mano.actuar(m, "b", { tipo: "pasar" });
        for (let i = 0; i < 3; i++) {
            mano.actuar(m, "b", { tipo: "pasar" });
            mano.actuar(m, "a", { tipo: "pasar" });
        }
        expect(m.fin).toBe(true);
        expect(m.resultado.manos.get("a").nombre).toBe("Pareja");
        expect(fichas(m)).toEqual({ a: 1100, b: 900 });
    });

    test("con un all-in corto hay bote principal y lateral, cada uno para su mejor mano", () => {
        // a (botón, 100 fichas): A A · b (ciega pequeña): K K · c (ciega grande): Q Q · mesa sin nada para nadie.
        const m = nueva(
            [
                ["a", 100],
                ["b", 500],
                ["c", 500],
            ],
            "Ah Kh Qh As Ks Qs 2d 7c 9s Jd 4c",
        );
        mano.actuar(m, "a", { tipo: "allin" });
        mano.actuar(m, "b", { tipo: "igualar" });
        mano.actuar(m, "c", { tipo: "pasar" });
        expect(m.calle).toBe("flop");
        mano.actuar(m, "b", { tipo: "subir", total: 200 });
        mano.actuar(m, "c", { tipo: "igualar" });
        for (let i = 0; i < 2; i++) {
            mano.actuar(m, "b", { tipo: "pasar" });
            mano.actuar(m, "c", { tipo: "pasar" });
        }
        expect(fichas(m)).toEqual({ a: 300, b: 600, c: 200 });
    });

    test("un empate divide el bote y la ficha que sobra va al primero tras el botón", () => {
        // a y c juegan la escalera de la mesa (b se retira): empatan y se reparten el bote.
        const m = nueva(
            [
                ["a", 1000],
                ["b", 1000],
                ["c", 1000],
            ],
            "2h 2d 2s 3h 3d 3s 5c 6d 7h 8s 9c",
        );
        mano.actuar(m, "a", { tipo: "igualar" });
        mano.actuar(m, "b", { tipo: "retirarse" });
        mano.actuar(m, "c", { tipo: "pasar" });
        for (let i = 0; i < 3; i++) {
            mano.actuar(m, "c", { tipo: "pasar" });
            mano.actuar(m, "a", { tipo: "pasar" });
        }
        // Bote: a 100 + b 50 + c 100 = 250, entre a y c: 125 cada uno.
        expect(fichas(m)).toEqual({ a: 1025, b: 950, c: 1025 });
    });

    test("si se agota el tiempo, pasa si puede y, si hay que igualar, se retira", () => {
        const m = nueva(
            [
                ["a", 1000],
                ["b", 1000],
            ],
            "Ah Kh As Ks 2d 7c 9s Jd 4c",
        );
        expect(mano.actuarPorTiempo(m)).toBe("retirarse");
        expect(m.fin).toBe(true);
        const p = nueva(
            [
                ["a", 1000],
                ["b", 1000],
            ],
            "Ah Kh As Ks 2d 7c 9s Jd 4c",
        );
        mano.actuar(p, "a", { tipo: "igualar" });
        expect(mano.actuarPorTiempo(p)).toBe("pasar");
    });
});

describe("mesas y dinero", () => {
    const G = "g-poker";
    beforeEach(() => {
        for (const id of [...juego.enJuego.keys()]) juego.limpiar(id);
        db.prepare("DELETE FROM poker_asientos").run();
        db.prepare("DELETE FROM poker_mesas").run();
        db.prepare("DELETE FROM poker_stats WHERE userId LIKE 'pk-%'").run();
        db.prepare("DELETE FROM banco WHERE userId LIKE 'pk-%'").run();
        dinero.pagar("pk-ana", 10_000);
        dinero.pagar("pk-luis", 10_000);
    });
    const abrir = () => mesas.abrir({ guildId: G, channelId: "c-pk", userId: "pk-ana", compra: 2000 }).mesa;
    const efectivo = (u) => dinero.cuenta(u).efectivo;

    test("sentarse cobra las fichas del efectivo una vez y levantarse las paga", () => {
        const m = abrir();
        expect(efectivo("pk-ana")).toBe(9000);
        expect(mesas.sentarse(m.id, "pk-ana", 2000).motivo).toMatch(/Ya estás sentado/);
        expect(mesas.sentarse(m.id, "pk-luis", 500).motivo).toMatch(/1000 a 10\.000/);
        mesas.sentarse(m.id, "pk-luis", 3000);
        expect(mesas.levantarse(m.id, "pk-luis")).toMatchObject({ ok: true, fichas: 3000 });
        expect(efectivo("pk-luis")).toBe(11_000);
    });

    test("al acabar la mano se guardan las fichas y las estadísticas; tres tiempos agotados dejan fuera", () => {
        const m = abrir();
        mesas.sentarse(m.id, "pk-luis", 2000);
        for (let i = 0; i < 3; i++) {
            mesas.guardarMano(m.id, [
                { userId: "pk-ana", fichas: 2100 + i, ganado: 100, agotoTiempo: false },
                { userId: "pk-luis", fichas: 1900 - i, ganado: -100, agotoTiempo: true },
            ]);
        }
        expect(mesas.asiento(m.id, "pk-luis")).toMatchObject({ fichas: 1898, fuera: 1 });
        expect(mesas.jugadoresDeMano(m.id).map((a) => a.userId)).toEqual(["pk-ana"]);
        expect(mesas.stats("pk-ana")).toMatchObject({ manos: 3, ganadas: 3, fichas_ganadas: 300 });
        expect(mesas.volver(m.id, "pk-luis")).toBe(true);
    });

    test("una mesa que cortó un reinicio se cierra devolviendo las fichas de antes de la mano", () => {
        const m = abrir();
        mesas.sentarse(m.id, "pk-luis", 2000);
        mesas.empezarMano(m.id, 2);
        expect(mesas.cerrarHuerfanas()).toBe(1);
        // Cada cuenta empieza con 1.000 de efectivo más los 10.000 del test.
        expect(efectivo("pk-ana")).toBe(11_000);
        expect(efectivo("pk-luis")).toBe(11_000);
        expect(mesas.obtener(m.id).estado).toBe("cerrada");
    });

    test("en Discord: se reparte, se juega con los botones, a los 45 s se actúa solo y se guardan las fichas", async () => {
        jest.useFakeTimers();
        try {
            const m = abrir();
            mesas.sentarse(m.id, "pk-luis", 2000);
            mesas.guardarMensaje(m.id, "m-pk");
            const canal = { messages: { edit: jest.fn(async () => {}) } };
            const client = { channels: { fetch: jest.fn(async () => canal) } };
            expect(await juego.iniciarMano(client, m.id, { seguir: false, turnoMs: 1000 })).toBe(true);
            const enCurso = juego.enJuego.get(m.id).mano;
            const quien = enCurso.jugadores[enCurso.turno].userId;
            const otro = quien === "pk-ana" ? "pk-luis" : "pk-ana";
            const boton = {
                customId: `poker_igualar_${m.id}`,
                user: { id: otro },
                reply: jest.fn(async () => {}),
                deferUpdate: jest.fn(async () => {}),
            };
            await pokerCmd.handleButton(client, boton);
            expect(boton.reply.mock.calls[0][0].content).toMatch(/No es tu turno/);
            const levantarse = { customId: `poker_levantarse_${m.id}`, user: { id: quien }, reply: jest.fn(async () => {}) };
            await pokerCmd.handleButton(client, levantarse);
            expect(levantarse.reply.mock.calls[0][0].content).toMatch(/levántate cuando acabe/);
            await jest.advanceTimersByTimeAsync(1000);
            expect(juego.enJuego.has(m.id)).toBe(false);
            const total = mesas.asientos(m.id).reduce((s, a) => s + a.fichas, 0);
            expect(total).toBe(4000);
            expect(mesas.asiento(m.id, quien)).toMatchObject({ fichas: 1950, tiempos: 1 });
            expect(
                mensajeMesa(mesas.obtener(m.id))
                    .components[0].toJSON()
                    .components.map((b) => b.custom_id),
            ).toContain(`poker_sentarse_${m.id}`);
        } finally {
            jest.useRealTimers();
        }
    });

    test("el cron cierra la mesa que no se llenó al acabar la espera y devuelve las fichas", async () => {
        const client = { channels: { fetch: jest.fn(async () => ({ messages: { edit: jest.fn(async () => {}) } })) } };
        const sola = abrir();
        await juego.revisar(client, sola.cierra_espera, { seguir: false });
        expect(mesas.obtener(sola.id).estado).toBe("cerrada");
        expect(efectivo("pk-ana")).toBe(11_000);
    });
});
