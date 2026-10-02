// Parte 9 del plan de paneles: /ayuda abre los paneles de cada sección y, de momento, todo es público (D5): solo
// los avisos de error se quedan en privado.
const db = require("../src/core/db");
const guildSettings = require("../src/systems/guildSettings");
const ayuda = require("../src/commands/general/ayuda");
const juegos = require("../src/commands/juegos/juegos");
const tienda = require("../src/commands/economia/tienda");
const paneladmin = require("../src/commands/admin/paneladmin");

const G = "guild-p9";
db.prepare("INSERT INTO banco (userId, saldo, enMano) VALUES ('p9', 0, 1000)").run();
db.prepare("INSERT INTO objeto (id, nombre, descripcion, tipo) VALUES (90, 'Trofeo', 'brilla', 'otro')").run();
db.prepare("INSERT INTO tienda (id, objetoId, precio, stock) VALUES (90, 90, 50, NULL)").run();

const client = {
    slashCommands: new Map([
        ["juegos", juegos],
        ["tienda", tienda],
        ["paneladmin", paneladmin],
    ]),
};
const interaccion = (customId, { admin = false } = {}) => ({
    customId,
    guildId: G,
    guild: { id: G, roles: { cache: new Map() } },
    user: { id: "p9", username: "p9", tag: "p9" },
    member: { permissions: { has: () => admin }, roles: { cache: new Map() } },
    memberPermissions: { has: () => admin },
    isButton: () => true,
    reply: jest.fn(async () => {}),
    update: jest.fn(async () => {}),
});
const ids = (payload) => payload.components.flatMap((r) => r.components.map((b) => b.data.custom_id));

afterEach(() => jest.restoreAllMocks());

test("/ayuda es pública y cada sección trae los botones de sus paneles, sin ids repetidos", async () => {
    const i = interaccion();
    await ayuda.run(client, i);
    expect(i.reply.mock.calls[0][0].flags).toBeUndefined();

    for (const [seccion, esperado] of [
        ["progresion", ["ayuda_abrir_perfil_perfil", "ayuda_abrir_perfil_logros", "ayuda_abrir_perfil_rankings"]],
        ["economia", ["ayuda_abrir_perfil_eco", "ayuda_abrir_tienda_ver", "ayuda_abrir_tienda_inventario"]],
        ["casino", ["ayuda_abrir_juegos_casino", "ayuda_abrir_juegos_stats"]],
        ["apuestas", ["ayuda_abrir_juegos_apuestas", "ayuda_abrir_juegos_retos", "ayuda_abrir_juegos_jugadas"]],
        ["cripto", ["ayuda_abrir_cripto_"]],
    ]) {
        const b = interaccion(`ayuda_${seccion}`);
        await ayuda.handleButton(client, b);
        const payload = b.update.mock.calls[0][0];
        expect(ids(payload)).toEqual(expect.arrayContaining(esperado));
        expect(new Set(ids(payload)).size).toBe(ids(payload).length);
        expect(payload.components.length).toBeLessThanOrEqual(5);
    }
});

test("abrir el casino desde la ayuda responde con un panel nuevo y público", async () => {
    const i = interaccion("ayuda_abrir_juegos_casino");
    await ayuda.handleButton(client, i);
    expect(i.update).not.toHaveBeenCalled();
    const payload = i.reply.mock.calls[0][0];
    expect(payload.flags).toBeUndefined();
    expect(ids(payload)).toContain("casino_blackjack");
});

test("abrir la tienda usa el subcomando y es pública", async () => {
    const i = interaccion("ayuda_abrir_tienda_ver");
    await ayuda.handleButton(client, i);
    const payload = i.reply.mock.calls[0][0];
    expect(payload.flags).toBeUndefined();
    expect(payload.embeds[0].data.title).toMatch(/Tienda/);
});

test("respeta los permisos de cada comando", async () => {
    jest.spyOn(guildSettings, "isCommandAllowed").mockReturnValue({ ok: false, message: "⛔ No aquí." });
    const i = interaccion("ayuda_abrir_juegos_casino");
    await ayuda.handleButton(client, i);
    expect(i.reply).toHaveBeenCalledWith({ content: "⛔ No aquí.", flags: expect.any(Number) });
});

test("el panel admin solo se abre siendo admin, y sigue siendo privado", async () => {
    const noAdmin = interaccion("ayuda_abrir_paneladmin_");
    await ayuda.handleButton(client, noAdmin);
    expect(noAdmin.reply.mock.calls[0][0].content).toMatch(/no está disponible/);

    const admin = interaccion("ayuda_abrir_paneladmin_", { admin: true });
    admin.client = { user: { displayAvatarURL: () => null } };
    await ayuda.handleButton({ ...client, user: admin.client.user }, admin);
    expect(admin.reply.mock.calls[0][0].embeds[0].data.title).toBe("🛠️ Panel Admin");
    expect(admin.reply.mock.calls[0][0].flags).toBeDefined();
});

test("un botón inventado no abre nada", async () => {
    const i = interaccion("ayuda_abrir_ping_");
    await ayuda.handleButton(client, i);
    expect(i.reply.mock.calls[0][0].content).toMatch(/no está disponible/);
});
