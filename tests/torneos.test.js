// 🏆 Torneos de casino (#525): crear (validaciones y uno a la vez), inscribirse (cobro único al bote, solo antes de empezar),
// la clasificación con solo las partidas del juego y de la ventana, el reparto 50/30/20 con empates y con menos de tres,
// cancelar con devolución (a mano o por falta de gente), terminar pagando una sola vez, el cron y el panel admin.
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const torneos = require("../src/systems/torneos");
const envios = require("../src/discord/envios/torneos");
const torneoCmd = require("../src/commands/juegos/torneo");
const paneladmin = require("../src/commands/admin/paneladmin");
const { mensajeTorneo } = require("../src/paneles/torneo");

const G = "g-torneo";
const AHORA = 1_800_000_000_000;
const MIN = 60 * 1000;
const HORA = 60 * MIN;

const efectivo = (u) => dinero.cuenta(u).efectivo;
const crear = (extra = {}) =>
    torneos.crear({ guildId: G, porId: "admin", juego: "tragaperras", inscripcion: 100, empiezaEnMin: 10, horas: 1, ...extra }, AHORA);
/** Una partida del casino de `userId` en `ms` con ese resultado neto. */
const partida = (userId, juego, resultado, ms) =>
    db
        .prepare("INSERT INTO casino (userId, juego, fecha, apuesta, resultado, detalle) VALUES (?, ?, ?, 10, ?, '{}')")
        .run(userId, juego, new Date(ms).toISOString(), resultado);

beforeEach(() => {
    db.prepare("DELETE FROM torneo_inscritos").run();
    db.prepare("DELETE FROM torneos").run();
    db.prepare("DELETE FROM casino WHERE userId LIKE 'tor-%'").run();
    db.prepare("DELETE FROM banco WHERE userId LIKE 'tor-%'").run();
    db.prepare("DELETE FROM historial WHERE userId LIKE 'tor-%'").run();
});

describe("crear e inscribirse", () => {
    test("valida el juego, la inscripción, cuándo empieza y la duración, y solo hay uno a la vez", () => {
        expect(crear({ juego: "parchis" }).motivo).toMatch(/no es del casino/);
        expect(crear({ inscripcion: 0 }).motivo).toMatch(/inscripción/);
        expect(crear({ empiezaEnMin: 0 }).motivo).toMatch(/empezar/);
        expect(crear({ horas: 73 }).motivo).toMatch(/1 a 72/);
        expect(crear().torneo).toMatchObject({ estado: "inscripcion", empieza: AHORA + 10 * MIN, termina: AHORA + 10 * MIN + HORA });
        expect(crear().motivo).toMatch(/Ya hay un torneo/);
    });

    test("inscribirse cobra una vez del efectivo y suma al bote; cerrado al empezar", () => {
        const t = crear().torneo;
        expect(torneos.inscribir(t.id, "tor-ana", AHORA).torneo.bote).toBe(100);
        expect(torneos.inscribir(t.id, "tor-ana", AHORA).motivo).toMatch(/Ya estás inscrito/);
        expect(efectivo("tor-ana")).toBe(900);
        expect(torneos.inscribir(t.id, "tor-luis", t.empieza).motivo).toMatch(/cerrada/);
        dinero.cobrar("tor-eva", 1000);
        expect(torneos.inscribir(t.id, "tor-eva", AHORA).motivo).toMatch(/efectivo/);
    });
});

describe("clasificación y reparto", () => {
    test("solo cuentan las partidas del juego del torneo y dentro de su horario", () => {
        const t = crear().torneo;
        ["tor-ana", "tor-luis"].forEach((u) => torneos.inscribir(t.id, u, AHORA));
        partida("tor-ana", "tragaperras", 500, t.empieza - MIN);
        partida("tor-ana", "tragaperras", 200, t.empieza + MIN);
        partida("tor-ana", "blackjack", 900, t.empieza + MIN);
        partida("tor-luis", "tragaperras", -50, t.empieza + 2 * MIN);
        partida("tor-luis", "tragaperras", 999, t.termina + MIN);
        expect(torneos.clasificacion(t).map((f) => [f.userId, f.neto])).toEqual([
            ["tor-ana", 200],
            ["tor-luis", -50],
        ]);
        expect(torneos.clasificacion({ ...t, juego: "todos" })[0].neto).toBe(1100);
    });

    test("50/30/20 entre los tres primeros; los empates suman sus premios y las siguientes plazas se corren", () => {
        const tabla = [
            { userId: "a", neto: 100 },
            { userId: "b", neto: 100 },
            { userId: "c", neto: 50 },
            { userId: "d", neto: 10 },
        ];
        expect(torneos.repartir(tabla, 1000).map((r) => [r.userId, r.puesto, r.premio])).toEqual([
            ["a", 1, 400],
            ["b", 1, 400],
            ["c", 3, 200],
            ["d", 4, 0],
        ]);
    });

    test("con dos jugadores, el 50 y el 30 se reparten en proporción y nada se queda sin repartir", () => {
        const r = torneos.repartir(
            [
                { userId: "a", neto: 5 },
                { userId: "b", neto: 1 },
            ],
            801,
        );
        expect(r.map((x) => x.premio)).toEqual([501, 300]);
    });
});

describe("fases", () => {
    test("con menos de 2 inscritos al empezar se cancela y se devuelve la inscripción", () => {
        const t = crear().torneo;
        torneos.inscribir(t.id, "tor-ana", AHORA);
        expect(torneos.avanzar(t.id, t.empieza)).toMatchObject({ paso: "cancelado" });
        expect(efectivo("tor-ana")).toBe(1000);
    });

    test("un admin lo cancela antes de empezar, con devolución; ya empezado, no", () => {
        const t = crear().torneo;
        torneos.inscribir(t.id, "tor-ana", AHORA);
        expect(torneos.cancelar(G, AHORA).ok).toBe(true);
        expect(efectivo("tor-ana")).toBe(1000);
        const otro = crear().torneo;
        ["tor-ana", "tor-luis"].forEach((u) => torneos.inscribir(otro.id, u, AHORA));
        torneos.avanzar(otro.id, otro.empieza);
        expect(torneos.cancelar(G, otro.empieza).motivo).toMatch(/Ya ha empezado/);
    });

    test("al terminar paga los premios una sola vez y guarda puesto y resultado", () => {
        const t = crear().torneo;
        ["tor-ana", "tor-luis", "tor-eva"].forEach((u) => torneos.inscribir(t.id, u, AHORA));
        expect(torneos.avanzar(t.id, t.empieza).paso).toBe("empieza");
        partida("tor-luis", "tragaperras", 300, t.empieza + MIN);
        partida("tor-ana", "tragaperras", 100, t.empieza + MIN);
        expect(torneos.avanzar(t.id, t.termina - 1)).toBeNull();
        const r = torneos.avanzar(t.id, t.termina);
        expect(r.premios.map((p) => [p.userId, p.premio])).toEqual([
            ["tor-luis", 150],
            ["tor-ana", 90],
            ["tor-eva", 60],
        ]);
        expect(torneos.avanzar(t.id, t.termina + 1)).toBeNull();
        expect(dinero.movimientos("tor-luis", { tipo: "premio" }).filas).toHaveLength(1);
        expect(torneos.inscritos(t.id).find((i) => i.userId === "tor-luis")).toMatchObject({ puesto: 1, neto: 300, premio: 150 });
    });
});

describe("Discord", () => {
    test("el cron anuncia el inicio y el final y repinta el mensaje", async () => {
        const t = crear({ channelId: "c-tor" }).torneo;
        torneos.guardarMensaje(t.id, "c-tor", "m-tor");
        ["tor-ana", "tor-luis"].forEach((u) => torneos.inscribir(t.id, u, AHORA));
        const canal = { send: jest.fn(async () => {}), messages: { edit: jest.fn(async () => {}) } };
        const client = { channels: { fetch: jest.fn(async () => canal) } };
        expect(await envios.revisar(client, t.empieza)).toBe(1);
        expect(canal.send.mock.calls[0][0].content).toMatch(/Empieza el torneo/);
        expect(await envios.revisar(client, t.termina)).toBe(1);
        expect(canal.send.mock.calls[1][0].content).toMatch(/Ha terminado/);
        expect(canal.messages.edit).toHaveBeenCalled();
    });

    test("el botón inscribe y el mensaje desactiva la inscripción cuando ya no se puede", async () => {
        const t = crear().torneo;
        const i = { customId: `torneo_inscribir_${t.id}`, user: { id: "tor-ana" }, reply: jest.fn(async () => {}) };
        await torneoCmd.handleButton({ channels: { fetch: jest.fn() } }, i);
        expect(i.reply.mock.calls[0][0].content).toMatch(/Inscrito/);
        torneos.inscribir(t.id, "tor-luis", AHORA);
        torneos.avanzar(t.id, t.empieza);
        const boton = mensajeTorneo(torneos.obtener(t.id)).components[0].toJSON().components[0];
        expect(boton).toMatchObject({ custom_id: `torneo_inscribir_${t.id}`, disabled: true });
    });

    test("desde el panel admin se crea el torneo con su formulario y se publica en el canal", async () => {
        const canal = { id: "c-tor", send: jest.fn(async () => ({ id: "m-1" })) };
        const valores = { inscripcion: "200", empieza: "30", horas: "2" };
        const i = {
            customId: "paneladmin_ecox_torneo_modal",
            guildId: G,
            user: { id: "admin" },
            client: { channels: { fetch: jest.fn(async () => canal) } },
            memberPermissions: { has: () => true },
            isFromMessage: () => true,
            fields: {
                getTextInputValue: (k) => valores[k],
                getStringSelectValues: () => ["blackjack"],
                getSelectedChannels: () => new Map([["c-tor", {}]]),
            },
            update: jest.fn(async () => {}),
        };
        await paneladmin.handleModal(i.client, i);
        expect(torneos.activo(G)).toMatchObject({ juego: "blackjack", inscripcion: 200, channelId: "c-tor", messageId: "m-1" });
        expect(i.update.mock.calls[0][0].embeds[0].toJSON().description).toMatch(/Torneo #\d+ creado/);
    });
});
