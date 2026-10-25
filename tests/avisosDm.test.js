// #431: /avisos. Cada DM del bot pasa por avisosDm: con el tipo apagado (o "no molestar") no sale ni falla, y se anota en el
// log; encendido, sale igual que antes. Las alertas de administración se mandan con sendDm y no se pueden apagar.
const fs = require("fs");
const path = require("path");
const db = require("../src/core/db");
const avisosDm = require("../src/systems/avisosDm");
const avisosCmd = require("../src/commands/general/avisos");
const { buildAvisos } = require("../src/paneles/avisos");
const rachas = require("../src/systems/xp/rachas");
const rachasEnvios = require("../src/discord/envios/rachas");

const U = "u-avisos";
const clienteCon = (send) => ({ users: { fetch: jest.fn(async () => ({ send })) } });

beforeEach(() => db.prepare("DELETE FROM preferencias_dm").run());

describe("preferencias", () => {
    test("sin preferencias guardadas todo está encendido", () => {
        for (const t of avisosDm.TIPOS) expect(avisosDm.activo(U, t.id)).toBe(true);
        expect(avisosDm.noMolestar(U)).toBe(false);
    });

    test("apagar un tipo no toca a los demás ni a otras personas, y se puede volver a encender", () => {
        avisosDm.fijar(U, "wrapped", false);
        expect(avisosDm.activo(U, "wrapped")).toBe(false);
        expect(avisosDm.activo(U, "robo")).toBe(true);
        expect(avisosDm.activo("otra", "wrapped")).toBe(true);
        avisosDm.fijar(U, "wrapped", true);
        expect(avisosDm.activo(U, "wrapped")).toBe(true);
    });

    test("no molestar apaga todos los tipos y conserva los interruptores individuales", () => {
        avisosDm.fijar(U, "robo", false);
        avisosDm.fijarNoMolestar(U, true);
        expect(avisosDm.activo(U, "wrapped")).toBe(false);
        const e = avisosDm.estado(U);
        expect(e.noMolestar).toBe(true);
        expect(e.tipos.find((t) => t.id === "wrapped").activo).toBe(true);
        expect(e.tipos.find((t) => t.id === "robo").activo).toBe(false);
        avisosDm.fijarNoMolestar(U, false);
        expect(avisosDm.activo(U, "wrapped")).toBe(true);
        expect(avisosDm.activo(U, "robo")).toBe(false);
    });

    test("un tipo desconocido es un error del código, no se acepta en silencio", () => {
        expect(() => avisosDm.fijar(U, "inventado", false)).toThrow(/desconocido/);
        expect(() => avisosDm.activo(U, "inventado")).toThrow(/desconocido/);
    });
});

describe("enviarAviso", () => {
    test("encendido, el DM sale", async () => {
        const send = jest.fn(async () => {});
        await expect(avisosDm.enviarAviso(clienteCon(send), U, "wrapped", { content: "hola" })).resolves.toBe(true);
        expect(send).toHaveBeenCalledWith({ content: "hola" });
    });

    test("apagado, no se manda nada, ni se pide el usuario a Discord, y no lanza", async () => {
        avisosDm.fijar(U, "wrapped", false);
        const send = jest.fn(async () => {});
        const client = clienteCon(send);
        await expect(avisosDm.enviarAviso(client, U, "wrapped", { content: "hola" })).resolves.toBe(false);
        expect(send).not.toHaveBeenCalled();
        expect(client.users.fetch).not.toHaveBeenCalled();
    });

    test("con no molestar no sale ningún tipo", async () => {
        avisosDm.fijarNoMolestar(U, true);
        const send = jest.fn(async () => {});
        for (const t of avisosDm.TIPOS) await avisosDm.enviarAviso(clienteCon(send), U, t.id, "x");
        expect(send).not.toHaveBeenCalled();
    });

    test("con un User ya cargado lo usa, y los DM cerrados devuelven false sin lanzar", async () => {
        const send = jest.fn(async () => {
            throw Object.assign(new Error("cerrados"), { code: 50007 });
        });
        await expect(avisosDm.enviarAviso({}, U, "robo", "x", { usuario: { send } })).resolves.toBe(false);
        expect(send).toHaveBeenCalledTimes(1);
    });

    test("sendDm (alertas de administración) no mira las preferencias", async () => {
        avisosDm.fijarNoMolestar(U, true);
        const send = jest.fn(async () => {});
        await expect(avisosDm.sendDm(clienteCon(send), U, { content: "alerta" })).resolves.toBe(true);
        expect(send).toHaveBeenCalledTimes(1);
    });
});

describe("los envíos del bot respetan la preferencia", () => {
    test("el aviso de racha en peligro no llega a quien lo ha apagado, y sí a quien no", async () => {
        const g = "g-avisos-racha";
        db.prepare("DELETE FROM xp_users WHERE guildId = ?").run(g);
        const ayer = rachas.madridDateStr(new Date(Date.now() - 24 * 3600 * 1000));
        for (const id of ["apagado", "encendido"]) {
            db.prepare("INSERT INTO xp_users (guildId, userId, streak_dias, streak_last_day) VALUES (?, ?, 5, ?)").run(g, id, ayer);
        }
        avisosDm.fijar("apagado", "racha_peligro", false);
        const enviados = [];
        const client = {
            guilds: { cache: new Map([[g, { id: g, name: "Servidor" }]]) },
            users: { fetch: jest.fn(async (id) => ({ send: async () => enviados.push(id) })) },
        };
        await rachasEnvios.runStreakWarningJob(client);
        expect(enviados).toEqual(["encendido"]);
    });
});

describe("todos los tipos están registrados y se usan", () => {
    function fuentes(dir) {
        return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) return fuentes(p);
            return e.name.endsWith(".js") ? [fs.readFileSync(p, "utf8")] : [];
        });
    }
    const codigo = fuentes(path.join(__dirname, "../src")).join("\n");
    const usados = new Set([...codigo.matchAll(/(?:enviarAviso|silenciado)\(\s*[^"')]*?"([a-z_]+)"/g)].map((m) => m[1]));

    test("cada tipo que se manda está en TIPOS y cada tipo de TIPOS se manda en algún sitio", () => {
        const registrados = avisosDm.TIPOS.map((t) => t.id);
        expect([...usados].filter((u) => !registrados.includes(u))).toEqual([]);
        expect(registrados.filter((r) => !usados.has(r))).toEqual([]);
    });
});

describe("el panel /avisos", () => {
    const ids = (p) => p.components.flatMap((f) => f.toJSON().components.map((c) => c.custom_id));
    const interaccion = (customId) => ({ customId, user: { id: U }, update: jest.fn(async () => {}), reply: jest.fn(async () => {}) });

    test("muestra los avisos en un desplegable y no molestar, sin pasarse de filas", () => {
        avisosDm.fijar(U, "robo", false);
        const p = buildAvisos(U);
        expect(ids(p)).toEqual(["avisos_sel", "avisos_sel_2", "avisos_nm"]);
        const filas = p.components.map((f) => f.toJSON().components);
        expect(filas[0][0].options).toHaveLength(25);
        expect([...filas[0][0].options, ...filas[1][0].options].map((o) => o.value)).toEqual(avisosDm.TIPOS.map((t) => t.id));
        expect(p.components.every((f) => f.components.length <= 5)).toBe(true);
        expect(p.components.length).toBeLessThanOrEqual(5);
        expect(p.embeds[0].toJSON().description).toContain("⚪ 🥷 **Robos**");
        expect(p.embeds[0].toJSON().description).toContain("🟢 🎞️ **Wrapped mensual**");
    });

    test("elegir un aviso en el desplegable lo cambia y repinta", async () => {
        const i = {
            customId: "avisos_sel",
            values: ["wrapped"],
            user: { id: U },
            update: jest.fn(async () => {}),
            reply: jest.fn(async () => {}),
        };
        await avisosCmd.handleSelect({}, i);
        expect(avisosDm.activo(U, "wrapped")).toBe(false);
        await avisosCmd.handleSelect({}, i);
        expect(avisosDm.activo(U, "wrapped")).toBe(true);
        expect(i.update).toHaveBeenCalledTimes(2);
    });

    test("pulsar un botón cambia la preferencia y repinta; surte efecto en el siguiente envío", async () => {
        const i = interaccion("avisos_t_wrapped");
        await avisosCmd.handleButton({}, i);
        expect(avisosDm.activo(U, "wrapped")).toBe(false);
        expect(i.update).toHaveBeenCalledTimes(1);
        await avisosCmd.handleButton({}, interaccion("avisos_t_wrapped"));
        expect(avisosDm.activo(U, "wrapped")).toBe(true);
    });

    test("no molestar se activa y se quita, y el panel lo dice", async () => {
        await avisosCmd.handleButton({}, interaccion("avisos_nm"));
        expect(avisosDm.noMolestar(U)).toBe(true);
        expect(buildAvisos(U).embeds[0].toJSON().description).toContain("No molestar está activado");
        await avisosCmd.handleButton({}, interaccion("avisos_nm"));
        expect(avisosDm.noMolestar(U)).toBe(false);
    });

    test("un tipo que ya no existe responde con un error y no escribe nada", async () => {
        const i = interaccion("avisos_t_inventado");
        await avisosCmd.handleButton({}, i);
        expect(i.reply).toHaveBeenCalledTimes(1);
        expect(db.prepare("SELECT COUNT(*) AS n FROM preferencias_dm").get().n).toBe(0);
    });

    test("/avisos responde con el panel en privado", async () => {
        const i = { user: { id: U }, reply: jest.fn(async () => {}) };
        await avisosCmd.run({}, i);
        expect(i.reply.mock.calls[0][0].embeds).toHaveLength(1);
        expect(i.reply.mock.calls[0][0].flags).toBeDefined();
    });
});
