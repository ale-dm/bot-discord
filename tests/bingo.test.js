// 🎱 Bingo de sala (#528): cartones válidos y distintos, abrir y entrar (entrada al bote, sala llena, una sala a la vez, cupo
// diario, autoexclusión), empezar (quien la abrió, con gente; sin gente se cancela y devuelve), la bola del bingo decidida al
// empezar, reparto entre varios ganadores, pago único, partidas huérfanas tras un reinicio, el canto y el cartón privado.
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const impuestos = require("../src/systems/impuestos");
const guildSettings = require("../src/systems/guildSettings");
const bingo = require("../src/systems/bingo");
const envios = require("../src/discord/envios/bingo");
const bingoCmd = require("../src/commands/juegos/bingo");
const { mensajeSala, cartonTexto } = require("../src/paneles/bingo");

const G = "g-bingo";
const AHORA = 1_800_000_000_000;

let semilla = 1;
/** Un azar repetible (para cartones y bolas). */
const azar = () => {
    semilla = (semilla * 16807) % 2147483647;
    return (semilla - 1) / 2147483646;
};
const efectivo = (u) => dinero.cuenta(u).efectivo;
const impuestoDe = (premio) => impuestos.calcularImpuesto(G, "casino", premio)?.impuesto || 0;
const abrir = (userId = "bin-ana", ahora = AHORA) => bingo.abrir({ guildId: G, channelId: "c-bin", userId }, { azar, ahora });

beforeEach(() => {
    semilla = 1;
    db.prepare("DELETE FROM bingo_jugadores").run();
    db.prepare("DELETE FROM bingo_partidas").run();
    db.prepare("DELETE FROM banco WHERE userId LIKE 'bin-%'").run();
    db.prepare("DELETE FROM historial WHERE userId LIKE 'bin-%'").run();
    db.prepare("DELETE FROM guild_settings WHERE guildId = ?").run(G);
    guildSettings.invalidarAjustes(G);
});

describe("cartones", () => {
    test("cada columna tiene 5 números de su rango, sin repetir, y el centro es libre", () => {
        const c = bingo.carton(azar);
        c.forEach((col, i) => {
            const nums = col.filter((n) => n !== bingo.LIBRE);
            expect(new Set(nums).size).toBe(nums.length);
            nums.forEach((n) => expect(n > i * 15 && n <= (i + 1) * 15).toBe(true));
        });
        expect(c[2][2]).toBe(bingo.LIBRE);
        expect(c.flat().filter((n) => n === bingo.LIBRE)).toHaveLength(1);
    });

    test("hacen falta las bolas hasta la última de las 24 del cartón", () => {
        const c = bingo.carton(azar);
        const orden = Array.from({ length: 75 }, (_, i) => i + 1);
        expect(bingo.bolasParaCompletar(c, orden)).toBe(Math.max(...c.flat()));
    });
});

describe("sala", () => {
    test("abrir mete a quien la abre pagando la entrada, y solo hay una sala a la vez", () => {
        guildSettings.setSetting(G, "bingo.entrada", 50);
        const p = abrir().partida;
        expect(p).toMatchObject({ estado: "esperando", entrada: 50, bote: 50 });
        expect(efectivo("bin-ana")).toBe(950);
        expect(abrir("bin-luis").motivo).toMatch(/Ya hay una sala/);
    });

    test("se entra una vez, hasta 6, y con la sala llena lo avisa", () => {
        const p = abrir().partida;
        expect(bingo.entrar(p.id, "bin-ana", { azar }).motivo).toMatch(/Ya estás dentro/);
        let r;
        for (let i = 1; i < bingo.MAX_JUGADORES; i++) r = bingo.entrar(p.id, `bin-j${i}`, { azar, ahora: AHORA });
        expect(r.llena).toBe(true);
        expect(bingo.entrar(p.id, "bin-tarde", { azar }).motivo).toMatch(/llena/);
        expect(bingo.obtener(p.id).bote).toBe(600);
    });

    test("hay un cupo de partidas al día por persona", () => {
        for (let i = 0; i < bingo.CUPO_DIARIO; i++) {
            const { lastInsertRowid } = db
                .prepare(
                    "INSERT INTO bingo_partidas (guildId, abierta_por, estado, entrada, creada, cierra_espera) VALUES (?, 'x', 'terminada', 1, ?, ?)",
                )
                .run(`${G}-viejo`, AHORA, AHORA);
            db.prepare("INSERT INTO bingo_jugadores (partida_id, userId, carton, entro_en) VALUES (?, 'bin-ana', '[]', ?)").run(
                lastInsertRowid,
                AHORA,
            );
        }
        expect(abrir("bin-ana").motivo).toMatch(/Ya has jugado 10 partidas/);
    });

    test("solo quien la abrió la empieza antes, y con al menos 2", () => {
        const p = abrir().partida;
        expect(bingo.empezar(p.id, { porId: "bin-ana", azar }).motivo).toMatch(/al menos 2/);
        bingo.entrar(p.id, "bin-luis", { azar, ahora: AHORA });
        expect(bingo.empezar(p.id, { porId: "bin-luis", azar }).motivo).toMatch(/Solo quien abrió/);
        expect(bingo.empezar(p.id, { porId: "bin-ana", azar }).partida.estado).toBe("jugando");
    });

    test("si se acaba la espera sin gente, se cancela y se devuelve la entrada", () => {
        const p = abrir().partida;
        expect(bingo.esperasVencidas(p.cierra_espera)).toEqual([p.id]);
        expect(bingo.empezar(p.id, { azar, ahora: p.cierra_espera })).toMatchObject({ cancelada: true });
        expect(efectivo("bin-ana")).toBe(1000);
    });
});

describe("partida", () => {
    function jugando() {
        const p = abrir().partida;
        bingo.entrar(p.id, "bin-luis", { azar, ahora: AHORA });
        return bingo.empezar(p.id, { azar, ahora: AHORA + 1000 }).partida;
    }

    test("la bola del bingo es la primera con la que alguien completa el cartón, y se paga a ese jugador una vez", () => {
        const p = jugando();
        const lista = bingo.jugadores(p.id);
        const necesarias = lista.map((j) => bingo.bolasParaCompletar(j.carton, p.bolas));
        expect(p.bola_ganadora).toBe(Math.min(...necesarias));
        const r = bingo.terminar(p.id, AHORA + 5000);
        const ganador = lista[necesarias.indexOf(p.bola_ganadora)].userId;
        expect(r.ganadores).toEqual([{ userId: ganador, premio: 200 }]);
        expect(efectivo(ganador)).toBe(900 + 200 - impuestoDe(200));
        expect(bingo.terminar(p.id)).toBeNull();
    });

    test("si dos cantan bingo con la misma bola, el bote se reparte", () => {
        const p = jugando();
        const [a] = bingo.jugadores(p.id);
        db.prepare("UPDATE bingo_jugadores SET carton = ? WHERE partida_id = ?").run(JSON.stringify(a.carton), p.id);
        db.prepare("UPDATE bingo_partidas SET bola_ganadora = ? WHERE id = ?").run(bingo.bolasParaCompletar(a.carton, p.bolas), p.id);
        expect(bingo.terminar(p.id).ganadores.map((g) => g.premio)).toEqual([100, 100]);
    });

    test("el canto edita el mensaje con cada bola y al final paga y lo anuncia", async () => {
        const p = jugando();
        bingo.guardarMensaje(p.id, "m-bin");
        const canal = { send: jest.fn(async () => {}), messages: { edit: jest.fn(async () => {}) } };
        const client = { channels: { fetch: jest.fn(async () => canal) } };
        await envios.cantar(client, p.id, { pausaMs: 0 });
        expect(canal.messages.edit).toHaveBeenCalledTimes(p.bola_ganadora + 1);
        expect(canal.send.mock.calls[0][0].content).toMatch(/¡Bingo!/);
        expect(bingo.obtener(p.id).estado).toBe("terminada");
    });

    test("una partida que se quedó a medias por un reinicio se termina en el cron", async () => {
        const p = jugando();
        const client = { channels: { fetch: jest.fn(async () => ({ send: jest.fn(async () => {}), messages: { edit: jest.fn() } })) } };
        await envios.revisar(client, AHORA + 60 * 1000);
        expect(bingo.obtener(p.id).estado).toBe("jugando");
        await envios.revisar(client, AHORA + 10 * 60 * 1000);
        expect(bingo.obtener(p.id).estado).toBe("terminada");
    });
});

describe("pantallas", () => {
    test("el cartón marca entre corchetes lo cantado y la estrella en el centro", () => {
        const c = bingo.carton(azar);
        const texto = cartonTexto(c, new Set([c[0][0]]));
        expect(texto).toContain(`[${String(c[0][0]).padStart(2, " ")}]`);
        expect(texto).toContain("[★]");
    });

    test("/bingo abre la sala en el canal y Mi cartón solo enseña el tuyo", async () => {
        const i = {
            guildId: G,
            channelId: "c-bin",
            user: { id: "bin-ana" },
            reply: jest.fn(async () => {}),
            fetchReply: jest.fn(async () => ({ id: "m-1" })),
        };
        await bingoCmd.run({}, i);
        const p = bingo.activa(G);
        expect(p.messageId).toBe("m-1");
        expect(
            mensajeSala(p)
                .components[0].toJSON()
                .components.map((b) => b.custom_id),
        ).toEqual([`bingo_entrar_${p.id}`, `bingo_empezar_${p.id}`, `bingo_carton_${p.id}`]);
        const ajeno = { customId: `bingo_carton_${p.id}`, user: { id: "bin-luis" }, reply: jest.fn(async () => {}) };
        await bingoCmd.handleButton({}, ajeno);
        expect(ajeno.reply.mock.calls[0][0].content).toMatch(/No estás en esta sala/);
    });
});
