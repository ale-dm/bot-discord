// 🧠 Recuerdos automáticos del Duende (#15): cada RONDA mensajes con texto de verdad se pide a Gemini si hay algo que
// recordar; la propuesta llega a los admins por DM; solo un admin la guarda (o la descarta), una sola vez, y lo guardado
// va al perfil de la persona. Gemini se simula: no se hace ninguna petición real.
const db = require("../src/core/db");
const guildSettings = require("../src/systems/guildSettings");
const perfiles = require("../src/systems/duende/perfiles");
const recuerdos = require("../src/systems/duende/recuerdosAuto");

const G = "g-recuerdos";
const ADMIN = "admin-rec";
const LARGO = "Esta semana me he apuntado a clases de escalada los martes, que es lo que más me ilusiona ahora mismo.";
let n = 0;

function mensaje(userId, texto = LARGO, { canal = "c1", bot = false } = {}) {
    return {
        guildId: G,
        channelId: canal,
        content: texto,
        author: { id: userId, username: `u${userId}`, bot },
        member: { displayName: `Nombre ${userId}` },
        client: { users: { fetch: jest.fn(async () => ({ send: jest.fn(async () => {}) })) } },
    };
}

beforeEach(() => {
    recuerdos.reiniciar();
    db.prepare("DELETE FROM duende_recuerdos_propuestos").run();
    guildSettings.setSetting(G, "alertas.admin_ids", ADMIN);
    delete process.env.DUENDE_RECUERDOS_AUTO;
});

describe("cuándo mira", () => {
    test("solo textos de 60 caracteres o más, sin bots, y cada RONDA mensajes", async () => {
        const gemini = jest.fn(async () => '{"recuerdo": null}');
        const u = `r-${++n}`;
        for (let i = 0; i < recuerdos.RONDA - 1; i++) recuerdos.observar(mensaje(u), { gemini });
        recuerdos.observar(mensaje(u, "hola"), { gemini }); // corto: no cuenta
        recuerdos.observar(mensaje(u, LARGO, { bot: true }), { gemini }); // bot: no cuenta
        expect(gemini).not.toHaveBeenCalled();
        recuerdos.observar(mensaje(u), { gemini }); // la décima
        await new Promise((r) => setImmediate(r));
        expect(gemini).toHaveBeenCalledTimes(1);
    });

    test("en el canal del Duende, si hay uno configurado, solo ahí", async () => {
        guildSettings.setSetting(G, "duende.allowed_channel_id", "canal-duende");
        const gemini = jest.fn(async () => '{"recuerdo": null}');
        const u = `r-${++n}`;
        for (let i = 0; i < recuerdos.RONDA; i++) recuerdos.observar(mensaje(u, LARGO, { canal: "otro" }), { gemini });
        await new Promise((r) => setImmediate(r));
        expect(gemini).not.toHaveBeenCalled();
        guildSettings.setSetting(G, "duende.allowed_channel_id", "");
    });

    test("con DUENDE_RECUERDOS_AUTO=0 no mira nada", async () => {
        process.env.DUENDE_RECUERDOS_AUTO = "0";
        const gemini = jest.fn(async () => '{"recuerdo": null}');
        const u = `r-${++n}`;
        for (let i = 0; i < recuerdos.RONDA; i++) recuerdos.observar(mensaje(u), { gemini });
        await new Promise((r) => setImmediate(r));
        expect(gemini).not.toHaveBeenCalled();
    });
});

describe("la respuesta de Gemini", () => {
    test("un recuerdo válido se guarda como propuesta y avisa a los admins por DM", async () => {
        const u = `r-${++n}`;
        const usuario = { id: u, nombre: "Ana" };
        const client = { users: { fetch: jest.fn(async () => ({ send: jest.fn(async () => {}) })) } };
        const gemini = jest.fn(async () => 'Claro: {"recuerdo": "Ana hace escalada los martes"}');
        const p = await recuerdos.analizar(client, G, usuario, [LARGO], { gemini });
        expect(p).toMatchObject({ guildId: G, userId: u, nombre: "Ana", texto: "Ana hace escalada los martes" });
        expect(client.users.fetch).toHaveBeenCalledWith(ADMIN);
        expect(db.prepare("SELECT estado FROM duende_recuerdos_propuestos WHERE id = ?").get(p.id).estado).toBe("pendiente");
    });

    test("sin nada que recordar, o con una respuesta que no es JSON, no se propone nada", async () => {
        const client = { users: { fetch: jest.fn() } };
        expect(
            await recuerdos.analizar(client, G, { id: "x", nombre: "X" }, [LARGO], { gemini: async () => '{"recuerdo": null}' }),
        ).toBeNull();
        expect(await recuerdos.analizar(client, G, { id: "x", nombre: "X" }, [LARGO], { gemini: async () => "no sé" })).toBeNull();
        expect(db.prepare("SELECT COUNT(*) AS n FROM duende_recuerdos_propuestos").get().n).toBe(0);
    });

    test("leerRecuerdo ignora lo que no es un texto", () => {
        expect(recuerdos.leerRecuerdo('{"recuerdo": 42}')).toBeNull();
        expect(recuerdos.leerRecuerdo('{"recuerdo": "Ana"}')).toBe("Ana");
        expect(recuerdos.leerRecuerdo("{roto")).toBeNull();
    });

    test("el tope diario de llamadas a Gemini se respeta", async () => {
        const gemini = jest.fn(async () => '{"recuerdo": null}');
        const u = `r-${++n}`;
        for (let i = 0; i < recuerdos.MAX_LLAMADAS_DIA + 5; i++) {
            for (let j = 0; j < recuerdos.RONDA; j++) recuerdos.observar(mensaje(u), { gemini });
        }
        await new Promise((r) => setImmediate(r));
        expect(gemini.mock.calls.length).toBeLessThanOrEqual(recuerdos.MAX_LLAMADAS_DIA);
    });
});

describe("la decisión de un admin", () => {
    async function propuesta(userId = `r-${++n}`) {
        const client = { users: { fetch: jest.fn(async () => ({ send: jest.fn(async () => {}) })) } };
        return recuerdos.analizar(client, G, { id: userId, nombre: "Ana" }, [LARGO], {
            gemini: async () => '{"recuerdo": "Ana hace escalada"}',
        });
    }

    test("un admin lo guarda: pasa a ser una nota del perfil", async () => {
        const p = await propuesta(`r-${++n}`);
        const r = recuerdos.resolver(p.id, ADMIN, true);
        expect(r.ok).toBe(true);
        expect(db.prepare("SELECT estado, resuelta_por FROM duende_recuerdos_propuestos WHERE id = ?").get(p.id)).toEqual({
            estado: "aprobado",
            resuelta_por: ADMIN,
        });
        expect(perfiles.perfilPorDiscordId(p.userId).notas).toEqual(["Ana hace escalada"]);
    });

    test("quien no es admin no decide; y una propuesta se decide una sola vez", async () => {
        const p = await propuesta(`r-${++n}`);
        expect(recuerdos.resolver(p.id, "cualquiera", true).ok).toBe(false);
        expect(recuerdos.resolver(p.id, ADMIN, false).ok).toBe(true);
        const otra = recuerdos.resolver(p.id, ADMIN, true);
        expect(otra.ok).toBe(false);
        expect(otra.mensaje).toMatch(/descartado/);
    });

    test("descartar no guarda nada", async () => {
        const u = `r-${++n}`;
        const p = await propuesta(u);
        expect(recuerdos.resolver(p.id, ADMIN, false)).toMatchObject({ ok: true });
        expect(perfiles.perfilPorDiscordId(u)?.notas || []).toEqual([]);
    });
});
