// #434: 🔔 Avisarme en los cooldowns de /trabajar y /robar. El botón aparece solo con el cooldown activo; al pulsarlo se apunta el
// aviso (una sola vez) y pasa a «Te avisaré»; al vencer llega un DM, también si el bot se reinició entre medias.
const db = require("../src/core/db");
const avisosCooldown = require("../src/systems/avisosCooldown");
const avisosDm = require("../src/systems/avisosDm");
const panel = require("../src/paneles/avisoCooldown");
const trabajar = require("../src/commands/economia/trabajar");
const robar = require("../src/commands/economia/robar");
const dinero = require("../src/systems/dinero");
const guildSettings = require("../src/systems/guildSettings");

const T0 = 1_800_000_000_000;
let n = 0;
const persona = () => `cd-user-${++n}`;
beforeEach(() => db.prepare("DELETE FROM avisos_cooldown").run());
const filas = (userId) => db.prepare("SELECT * FROM avisos_cooldown WHERE userId = ?").all(userId);
const cliente = ({ cerrados = false } = {}) => {
    const dms = [];
    return {
        dms,
        guilds: { cache: new Map([["g-cd", { name: "Servidor CD" }]]) },
        users: {
            fetch: async (id) => ({
                send: async (t) => {
                    if (cerrados) throw Object.assign(new Error("cerrados"), { code: 50007 });
                    dms.push({ id, t });
                },
            }),
        },
    };
};

describe("el momento del aviso", () => {
    test("es el instante actual más los segundos que faltan, redondeados hacia arriba al segundo", () => {
        expect(avisosCooldown.momentoDeAviso(60, T0)).toBe(T0 + 60_000);
        expect(avisosCooldown.momentoDeAviso(59.2, T0)).toBe(T0 + 60_000);
        expect(avisosCooldown.momentoDeAviso(0, T0)).toBe(T0);
        expect(avisosCooldown.momentoDeAviso("x", T0)).toBe(T0);
    });
});

describe("programar", () => {
    test("pulsar dos veces no crea dos avisos, y cada comando tiene el suyo", () => {
        const u = persona();
        expect(avisosCooldown.programar(u, "trabajar", "g-cd", T0 + 1000, T0)).toEqual({ ok: true, nuevo: true, cuando: T0 + 1000 });
        expect(avisosCooldown.programar(u, "trabajar", "g-cd", T0 + 1000, T0)).toMatchObject({ ok: true, nuevo: false });
        expect(filas(u)).toHaveLength(1);
        expect(avisosCooldown.programar(u, "robar", "g-cd", T0 + 5000, T0)).toMatchObject({ nuevo: true });
        expect(filas(u)).toHaveLength(2);
    });

    test("el cooldown de /robar es global (sin servidor) y el de /trabajar es por servidor", () => {
        const u = persona();
        avisosCooldown.programar(u, "robar", "g-cd", T0 + 1000, T0);
        avisosCooldown.programar(u, "robar", "otro-servidor", T0 + 1000, T0);
        expect(filas(u).filter((f) => f.comando === "robar")).toHaveLength(1);
        expect(filas(u).find((f) => f.comando === "robar").guildId).toBe("");
        avisosCooldown.programar(u, "trabajar", "g-cd", T0 + 1000, T0);
        avisosCooldown.programar(u, "trabajar", "otro-servidor", T0 + 1000, T0);
        expect(filas(u).filter((f) => f.comando === "trabajar")).toHaveLength(2);
    });

    test("un comando sin avisos o un cooldown que ya ha acabado no se apuntan", () => {
        const u = persona();
        expect(avisosCooldown.programar(u, "tienda", "g-cd", T0 + 1000, T0).ok).toBe(false);
        const ya = avisosCooldown.programar(u, "trabajar", "g-cd", T0 - 1, T0);
        expect(ya.ok).toBe(false);
        expect(ya.mensaje).toMatch(/Ya puedes volver a usar \/trabajar/);
        expect(filas(u)).toEqual([]);
    });
});

describe("enviar los avisos vencidos", () => {
    test("al vencer llega un DM, una sola vez, y los que aún no vencen se quedan", async () => {
        const a = persona();
        const b = persona();
        avisosCooldown.programar(a, "trabajar", "g-cd", T0 + 1000, T0);
        avisosCooldown.programar(b, "robar", "", T0 + 60_000, T0);
        const c = cliente();
        expect(await avisosCooldown.enviarVencidos(c, T0 + 500)).toBe(0);
        expect(await avisosCooldown.enviarVencidos(c, T0 + 1000)).toBe(1);
        expect(c.dms).toEqual([{ id: a, t: "🔔 Ya puedes volver a usar **/trabajar** en Servidor CD." }]);
        expect(await avisosCooldown.enviarVencidos(c, T0 + 2000)).toBe(0);
        expect(filas(a)).toEqual([]);
        expect(filas(b)).toHaveLength(1);
        expect(await avisosCooldown.enviarVencidos(c, T0 + 60_000)).toBe(1);
        expect(c.dms.at(-1)).toEqual({ id: b, t: "🔔 Ya puedes volver a usar **/robar**." });
    });

    test("si el bot se reinicia antes, el aviso sigue ahí y se envía al arrancar", async () => {
        const u = persona();
        avisosCooldown.programar(u, "robar", "", T0 + 1000, T0);
        // «Reinicio»: lo apuntado está en la base de datos, no en memoria; al arrancar, ya ha vencido.
        expect(avisosCooldown.vencidos(T0 + 3600 * 1000).map((f) => f.userId)).toContain(u);
        const c = cliente();
        await avisosCooldown.enviarVencidos(c, T0 + 3600 * 1000);
        expect(c.dms.map((d) => d.id)).toEqual([u]);
    });

    test("con los DM cerrados o el aviso apagado no se manda, pero el aviso se gasta igual: no insiste", async () => {
        const cerrado = persona();
        const apagado = persona();
        avisosCooldown.programar(cerrado, "robar", "", T0 + 1000, T0);
        avisosCooldown.programar(apagado, "robar", "", T0 + 1000, T0);
        avisosDm.fijar(apagado, "cooldown", false);
        const c = cliente({ cerrados: true });
        await expect(avisosCooldown.enviarVencidos(c, T0 + 2000)).resolves.toBe(0);
        expect(filas(cerrado)).toEqual([]);
        expect(filas(apagado)).toEqual([]);
        avisosDm.fijar(apagado, "cooldown", true);
    });
});

describe("el botón 🔔 Avisarme", () => {
    const boton = (customId, userId, dueno = userId) => ({
        customId,
        guildId: "g-cd",
        user: { id: userId },
        message: { interaction: { user: { id: dueno } } },
        update: jest.fn(async () => {}),
        reply: jest.fn(async () => {}),
    });

    test("el customId lleva el comando y el segundo en que acaba el cooldown", () => {
        const fila = panel.filaAvisar("trabajar", 600, T0).toJSON().components[0];
        expect(fila.custom_id).toBe(`cooldown_avisar_trabajar_${Math.floor((T0 + 600_000) / 1000)}`);
        expect(fila.label).toBe("🔔 Avisarme");
        expect(fila.disabled).toBeFalsy();
    });

    test("al pulsarlo se guarda el aviso y pasa a «Te avisaré», desactivado; pulsar de nuevo (mensaje viejo) no duplica", async () => {
        const u = persona();
        const cuando = Math.floor((Date.now() + 600_000) / 1000);
        const id = `cooldown_avisar_trabajar_${cuando}`;
        const i = boton(id, u);
        await panel.handleButton(null, i);
        const nuevo = i.update.mock.calls[0][0].components[0].toJSON().components[0];
        expect(nuevo).toMatchObject({ label: "🔔 Te avisaré", disabled: true });
        expect(filas(u)).toEqual([{ userId: u, comando: "trabajar", guildId: "g-cd", cuando: cuando * 1000 }]);
        await panel.handleButton(null, boton(id, u));
        expect(filas(u)).toHaveLength(1);
    });

    test("solo avisa a quien usó el comando, y un cooldown que ya acabó lo dice", async () => {
        const u = persona();
        const cuando = Math.floor((Date.now() + 600_000) / 1000);
        const ajeno = boton(`cooldown_avisar_trabajar_${cuando}`, u, "otra-persona");
        await panel.handleButton(null, ajeno);
        expect(ajeno.reply.mock.calls[0][0].content).toMatch(/quien usó el comando/);
        expect(filas(u)).toEqual([]);
        const viejo = boton(`cooldown_avisar_robar_${Math.floor(Date.now() / 1000) - 10}`, u);
        await panel.handleButton(null, viejo);
        expect(viejo.reply.mock.calls[0][0].content).toMatch(/Ya puedes volver a usar \/robar/);
        const raro = boton(`cooldown_avisar_tienda_${cuando}`, u);
        await panel.handleButton(null, raro);
        expect(raro.reply.mock.calls[0][0].content).toMatch(/no tiene avisos/);
        expect(filas(u)).toEqual([]);
    });
});

describe("los comandos", () => {
    test("/robar con cooldown activo trae el botón; sin cooldown (aquí, por una víctima sin efectivo) no", async () => {
        const ladron = persona();
        const victima = { id: persona(), username: "víctima", bot: false, tag: "v#1", send: jest.fn(async () => {}) };
        const interaccion = (userId) => ({
            guildId: "g-cd",
            user: { id: userId },
            options: { getUser: () => victima },
            reply: jest.fn(async () => {}),
        });
        db.prepare("INSERT INTO robos_cooldown (userId, lastTs) VALUES (?, ?)").run(ladron, Date.now());
        const i = interaccion(ladron);
        await robar.run(null, i);
        const r = i.reply.mock.calls[0][0];
        expect(r.content).toMatch(/Espera \d+ min más/);
        expect(r.components[0].toJSON().components[0].custom_id).toMatch(/^cooldown_avisar_robar_\d+$/);

        dinero.asegurarCuenta(victima.id);
        dinero.ingresar(victima.id, 1000); // sin efectivo: no merece la pena robarle
        const sinCooldown = interaccion(persona());
        await robar.run(null, sinCooldown);
        expect(sinCooldown.reply.mock.calls[0][0].content).toMatch(/no merece la pena/);
        expect(sinCooldown.reply.mock.calls[0][0].components).toBeUndefined();
    });

    test("/trabajar con cooldown activo trae el botón", async () => {
        const userId = persona();
        guildSettings.checkAndConsumeLimit("g-cd", "trabajar", userId, { cooldownSec: 1800 });
        const i = {
            guildId: "g-cd",
            channelId: "c",
            user: { id: userId, tag: "t#1" },
            deferReply: jest.fn(async () => {}),
            editReply: jest.fn(async () => {}),
            reply: jest.fn(async () => {}),
        };
        await trabajar.run(null, i);
        const r = i.editReply.mock.calls[0][0];
        expect(r.content).toMatch(/Espera \d+ min más/);
        expect(r.components[0].toJSON().components[0].custom_id).toMatch(/^cooldown_avisar_trabajar_\d+$/);
    });
});
