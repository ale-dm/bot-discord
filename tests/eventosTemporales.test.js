// 🎉 Eventos temporales (F-EC-02, issue #34): ⚡ happy hour de XP y 🎰 fin de semana del casino, en hora de Madrid, con
// la XP que se gana de verdad (addXp), los premios del casino (applyRtp, encima del RTP), lo que ve la gente y el panel.
const guildSettings = require("../src/systems/guildSettings");
const eventos = require("../src/systems/eventos");
const xp = require("../src/systems/xpSystem");
const tx = require("../src/systems/casinoTransactions");
const casino = require("../src/paneles/casino");
const paneladmin = require("../src/commands/admin/paneladmin");

const G = "g-eventos";
// Miércoles 14 de octubre de 2026: 20:30 y 19:30 en Madrid. Sábado 17 a mediodía. Viernes 16 a las 23:30 en Madrid.
// Domingo 18 a las 23:30 y lunes 19 a las 00:30 en Madrid.
const MIERCOLES_2030 = Date.UTC(2026, 9, 14, 18, 30);
const MIERCOLES_1930 = Date.UTC(2026, 9, 14, 17, 30);
const SABADO = Date.UTC(2026, 9, 17, 10);
const VIERNES_NOCHE = Date.UTC(2026, 9, 16, 21, 30);
const DOMINGO_NOCHE = Date.UTC(2026, 9, 18, 21, 30);
const LUNES_MADRUGADA = Date.UTC(2026, 9, 18, 22, 30);

afterEach(() => jest.restoreAllMocks());

test("las horas de la happy hour, también pasando la medianoche", () => {
    expect([19, 20, 21, 22].map((h) => eventos.dentroDeHoras(h, 20, 22))).toEqual([false, true, true, false]);
    expect([21, 22, 23, 0, 1, 2].map((h) => eventos.dentroDeHoras(h, 22, 2))).toEqual([false, true, true, true, true, false]);
    expect(eventos.dentroDeHoras(5, 5, 5)).toBe(false);
});

test("vienen desactivados: nada cambia hasta que un admin los active", () => {
    expect(eventos.multiplicadorXp(G, MIERCOLES_2030)).toBe(1);
    expect(eventos.porcentajeCasino(G, SABADO)).toBe(100);
    expect(eventos.lineaXp(G, MIERCOLES_2030)).toBeNull();
});

test("⚡ happy hour: solo en sus horas de Madrid", () => {
    guildSettings.setManySettings(G, { "eventos.xp_activo": 1, "eventos.xp_mult": 2, "eventos.xp_desde": 20, "eventos.xp_hasta": 22 });
    expect(eventos.multiplicadorXp(G, MIERCOLES_2030)).toBe(2);
    expect(eventos.multiplicadorXp(G, MIERCOLES_1930)).toBe(1);
    expect(eventos.lineaXp(G, MIERCOLES_2030)).toBe("⚡ **Happy hour**: XP ×2 hasta las 22:00");
    // Otro servidor no tiene la suya.
    expect(eventos.multiplicadorXp("otro", MIERCOLES_2030)).toBe(1);
});

test("🎰 fin de semana: sábado y domingo en hora de Madrid", () => {
    guildSettings.setManySettings(G, { "eventos.casino_activo": 1, "eventos.casino_pct": 150 });
    expect(eventos.porcentajeCasino(G, SABADO)).toBe(150);
    expect(eventos.porcentajeCasino(G, DOMINGO_NOCHE)).toBe(150);
    expect(eventos.porcentajeCasino(G, VIERNES_NOCHE)).toBe(100);
    expect(eventos.porcentajeCasino(G, LUNES_MADRUGADA)).toBe(100);
    expect(eventos.lineaCasino(G, SABADO)).toBe("🎉 **Fin de semana del casino**: premios ×1,5 hasta el lunes");
});

describe("se nota en lo que se gana de verdad", () => {
    const guild = {
        id: G,
        name: "Servidor",
        channels: { cache: new Map(), fetch: async () => null },
        roles: { cache: new Map() },
        client: { users: { fetch: async () => Promise.reject(new Error("sin DMs")) } },
    };
    const miembro = (id) => ({ id, roles: { add: async () => {} }, toString: () => `<@${id}>` });

    test("la XP de la happy hour se multiplica (y la de fuera no)", async () => {
        xp.setConfig(G, "streak_enabled", "0");
        jest.spyOn(Date, "now").mockReturnValue(MIERCOLES_2030);
        expect((await xp.addXp(guild, miembro("en-hora"), 100)).gain).toBe(200);
        Date.now.mockReturnValue(MIERCOLES_1930);
        expect((await xp.addXp(guild, miembro("fuera"), 100)).gain).toBe(100);
    });

    test("el premio neto del casino sube en fin de semana, encima del RTP de cada juego", () => {
        jest.spyOn(Date, "now").mockReturnValue(SABADO);
        expect(tx.applyRtp(G, "blackjack", 100, 300)).toBe(400); // neto 200 → 300
        expect(tx.applyRtp(G, "blackjack", 100, 100)).toBe(100); // empate: se devuelve lo apostado, sin más
        guildSettings.setSetting(G, "casino.rtp_blackjack", 50);
        expect(tx.applyRtp(G, "blackjack", 100, 300)).toBe(250); // neto 200 × 50 % × 150 % = 150
        guildSettings.setSetting(G, "casino.rtp_blackjack", 100);
        expect(tx.applyRtp(G, "quiniela", 100, 300)).toBe(300); // lo que no es del casino, igual
        Date.now.mockReturnValue(VIERNES_NOCHE);
        expect(tx.applyRtp(G, "blackjack", 100, 300)).toBe(300);
    });

    test("🎰 Casino avisa del evento en marcha", () => {
        jest.spyOn(Date, "now").mockReturnValue(SABADO);
        expect(casino.buildHome("ana", G).embeds[0].data.description).toMatch(/^🎉 \*\*Fin de semana del casino\*\*: premios ×1,5/);
        expect(casino.buildHome("ana", "otro").embeds[0].data.description).not.toMatch(/Fin de semana/);
    });
});

describe("/paneladmin → ⚙️ Config Global → 🎉 Eventos", () => {
    const P = "g-panel-eventos";
    const interaccion = (extra) => ({
        guildId: P,
        guild: { id: P },
        user: { id: "admin", tag: "admin" },
        member: { permissions: { has: () => true } },
        isFromMessage: () => true,
        reply: jest.fn(async () => {}),
        update: jest.fn(async () => {}),
        showModal: jest.fn(async () => {}),
        ...extra,
    });
    const formulario = (customId, campos) => interaccion({ customId, fields: { getTextInputValue: (k) => campos[k] ?? "" } });
    const campos = (payload) => Object.fromEntries(payload.embeds[0].data.fields.map((f) => [f.name, f.value]));

    test("pantalla, formularios y validación", async () => {
        const home = interaccion({ customId: "paneladmin_cfg_home" });
        await paneladmin.handleButton(null, home);
        expect(campos(home.update.mock.calls[0][0])["🎉 Eventos"]).toBe("Ninguno activo");

        const boton = interaccion({ customId: "paneladmin_cfg_eventos_xp" });
        await paneladmin.handleButton(null, boton);
        expect(boton.showModal.mock.calls[0][0].toJSON().components.map((r) => r.components[0].value)).toEqual(["0", "2", "20", "22"]);

        for (const mal of [
            { activo: "1", mult: "9", desde: "20", hasta: "22" },
            { activo: "1", mult: "2", desde: "21", hasta: "21" },
            { activo: "1", mult: "2", desde: "24", hasta: "2" },
        ]) {
            const i = formulario("paneladmin_cfg_eventos_xp_modal", mal);
            await paneladmin.handleModal(null, i);
            expect(i.reply.mock.calls[0][0].content).toMatch(/multiplicador va de 1 a 5/);
        }
        const ok = formulario("paneladmin_cfg_eventos_xp_modal", { activo: "1", mult: "3", desde: "22", hasta: "1" });
        await paneladmin.handleModal(null, ok);
        expect(guildSettings.getSettings(P).eventos.xp).toEqual({ activo: true, mult: 3, desde: 22, hasta: 1 });
        expect(campos(ok.update.mock.calls[0][0])["⚡ Happy hour de XP"]).toMatch(/^Cada día de 22:00 a 01:00: XP \*\*×3\*\*/);

        const casinoMal = formulario("paneladmin_cfg_eventos_casino_modal", { activo: "1", pct: "50" });
        await paneladmin.handleModal(null, casinoMal);
        expect(casinoMal.reply.mock.calls[0][0].content).toMatch(/de 100 a 300/);
        const casinoOk = formulario("paneladmin_cfg_eventos_casino_modal", { activo: "1", pct: "200" });
        await paneladmin.handleModal(null, casinoOk);
        expect(guildSettings.getSettings(P).eventos.casino).toEqual({ activo: true, pct: 200 });

        const home2 = interaccion({ customId: "paneladmin_cfg_home" });
        await paneladmin.handleButton(null, home2);
        expect(campos(home2.update.mock.calls[0][0])["🎉 Eventos"]).toBe("⚡ XP ×3\n🎰 200 %");
    });
});
