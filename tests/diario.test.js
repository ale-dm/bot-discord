// Recompensa diaria: 🎁 Diario en /perfil → 💰 Economía, una vez al día (hora de Madrid), crece con la racha de XP.
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const diario = require("../src/systems/diario");
const guildSettings = require("../src/systems/guildSettings");
const { madridDateStr } = require("../src/systems/xp/rachas");
const economia = require("../src/paneles/economia");
const dineroBotones = require("../src/perfil/dinero");
const paneladmin = require("../src/commands/admin/paneladmin");

const G = "guild-diario";
const ids = (payload) => payload.components.flatMap((r) => (r.toJSON ? r.toJSON() : r).components.map((c) => c.custom_id));
const boton = (payload, id) => payload.components.flatMap((r) => (r.toJSON ? r.toJSON() : r).components).find((c) => c.custom_id === id);

function racha(userId, dias) {
    diario.estado(G, userId); // crea su fila de XP
    db.prepare("UPDATE xp_users SET streak_dias = ?, streak_last_day = ? WHERE guildId = ? AND userId = ?").run(
        dias,
        madridDateStr(),
        G,
        userId,
    );
}

test("se cobra una vez al día, al efectivo, y queda en Movimientos como 🎁 Diario", () => {
    expect(diario.estado(G, "u1")).toMatchObject({ activo: true, disponible: true, cantidad: 100, racha: 0 });
    const r = diario.cobrar(G, "u1");
    expect(r).toMatchObject({ ok: true, cantidad: 100 });
    const impuesto = Math.floor(100 * 0.05); // 5% de impuesto por defecto
    expect(dinero.cuenta("u1")).toMatchObject({ efectivo: dinero.INICIAL + 100 - impuesto, banco: 0 });
    expect(dinero.movimientos("u1", { tipo: "diario" }).filas).toEqual([
        expect.objectContaining({ cantidad: 100, descripcion: expect.stringMatching(/Recompensa diaria/) }),
    ]);

    const otra = diario.cobrar(G, "u1");
    expect(otra.ok).toBe(false);
    expect(otra.mensaje).toMatch(/Ya has cobrado/);
    expect(dinero.efectivo("u1")).toBe(dinero.INICIAL + 100 - impuesto);
    expect(diario.estado(G, "u1")).toMatchObject({ disponible: false, veces: 1, total: 100 });
});

test("al día siguiente se puede volver a cobrar", () => {
    diario.cobrar(G, "u2");
    db.prepare("UPDATE recompensa_diaria SET ultimo_dia = '2000-01-01' WHERE userId = 'u2'").run();
    expect(diario.cobrar(G, "u2").ok).toBe(true);
    expect(diario.estado(G, "u2")).toMatchObject({ veces: 2, total: 200 });
});

test("crece con la racha de XP hasta el tope", () => {
    racha("u3", 10);
    expect(diario.estado(G, "u3")).toMatchObject({ racha: 10, cantidad: 100 + 20 * 10 });
    racha("u3", 40);
    expect(diario.estado(G, "u3").cantidad).toBe(500);
    expect(diario.cantidadPara({ base: 50, por_dia_racha: 10, tope: 20 }, 3)).toBe(50); // tope por debajo de la base
});

test("desactivada en el servidor: ni botón ni cobro", async () => {
    const G2 = "guild-diario-off";
    guildSettings.setSetting(G2, "diario.enabled", false);
    expect(diario.cobrar(G2, "u4").ok).toBe(false);
    const payload = await economia.buildEconomia({ viewerId: "u4", nombre: "u4", guildId: G2 });
    expect(ids(payload)).not.toContain("dinero_diario");
});

test("el botón sale solo en tu Economía y se desactiva al cobrar", async () => {
    const propia = await economia.buildEconomia({ viewerId: "u5", nombre: "u5", guildId: G });
    expect(boton(propia, "dinero_diario")).toMatchObject({ disabled: false });
    expect(propia.embeds[0].data.fields.find((f) => f.name === "🎁 Recompensa diaria").value).toMatch(/Disponible: \*\*100\*\*/);
    const ajena = await economia.buildEconomia({ viewerId: "otro", targetId: "u5", nombre: "u5", guildId: G });
    expect(ids(ajena)).not.toContain("dinero_diario");

    const interaccion = (extra) => ({
        customId: "dinero_diario",
        guildId: G,
        user: { id: "u5", username: "u5", tag: "u5" },
        message: { interaction: { user: { id: "u5" } } },
        reply: jest.fn(async () => {}),
        update: jest.fn(async () => {}),
        ...extra,
    });
    const i = interaccion();
    await dineroBotones.handleButton(null, i);
    const tras = i.update.mock.calls[0][0];
    expect(tras.embeds[0].data.description).toMatch(/Has cobrado \*\*100\*\*/);
    expect(boton(tras, "dinero_diario")).toMatchObject({ disabled: true, label: "🎁 Mañana" });

    const otra = interaccion();
    await dineroBotones.handleButton(null, otra);
    expect(otra.reply.mock.calls[0][0].content).toMatch(/Ya has cobrado/);

    // Solo quien abrió el panel.
    const intruso = interaccion({ user: { id: "intruso" } });
    await dineroBotones.handleButton(null, intruso);
    expect(intruso.reply.mock.calls[0][0].content).toMatch(/Solo quien abrió/);
    expect(dinero.efectivo("intruso")).toBe(dinero.INICIAL);
});

test("/paneladmin → Config Global → 🎁 Diario guarda la configuración y rechaza números raros", async () => {
    const formulario = async (campos) => {
        const i = {
            customId: "paneladmin_cfg_diario_modal",
            guildId: G,
            user: { id: "admin", tag: "admin" },
            member: { permissions: { has: () => true } },
            fields: { getTextInputValue: (k) => campos[k] ?? "" },
            isFromMessage: () => true,
            reply: jest.fn(async () => {}),
            update: jest.fn(async () => {}),
        };
        await paneladmin.handleModal(null, i);
        return i;
    };
    const mal = await formulario({ enabled: "1", base: "-5", porDia: "10", tope: "300" });
    expect(mal.reply.mock.calls[0][0].content).toMatch(/números enteros/);
    expect(guildSettings.getSettings(G).diario.base).toBe(100);

    const bien = await formulario({ enabled: "1", base: "50", porDia: "10", tope: "300" });
    expect(guildSettings.getSettings(G).diario).toMatchObject({ enabled: true, base: 50, por_dia_racha: 10, tope: 300 });
    expect(bien.update.mock.calls[0][0].embeds[0].data.title).toMatch(/Recompensa diaria/);
    guildSettings.setManySettings(G, { "diario.base": 100, "diario.por_dia_racha": 20, "diario.tope": 500 });
});
