// Cada logro desbloqueado se anuncia en el canal de logros mencionando a quien lo consigue, también cuando quien lo
// calcula solo tiene el id del servidor (casino, cripto). Y la migración 014 pone el canal de los niveles como canal
// de logros.
const db = require("../src/core/db");
const guildSettings = require("../src/systems/guildSettings");
const achievements = require("../src/systems/achievementsSystem");
const migracion014 = require("../src/core/migrations/014_canal_logros");

const G = "guild-avisos-logros";
const canal = { name: "logros", isTextBased: () => true, send: jest.fn(async () => {}) };
const guild = { id: G, name: G, channels: { cache: new Map([["canal-logros", canal]]), fetch: async () => null } };

beforeAll(() => {
    guildSettings.setSetting(G, "logros.notify_channel_id", "canal-logros");
    achievements.setClient({ guilds: { cache: new Map([[G, guild]]) } });
});
afterAll(() => achievements.setClient(null));
beforeEach(() => canal.send.mockClear());

test("con solo el id del servidor (como hace el casino) el logro también se anuncia, con mención", async () => {
    const desbloqueados = await achievements.applyEvent(G, "jugador-1", "casino_bet", 50);
    expect(desbloqueados.map((a) => a.id)).toContain("casino_primera");
    expect(canal.send).toHaveBeenCalledTimes(1);
    expect(canal.send.mock.calls[0][0]).toEqual({
        content: expect.stringMatching(/^🎉 <@jugador-1> desbloqueó logros:\n🏅 \*\*/),
        allowedMentions: { users: ["jugador-1"] },
    });
});

test("con anunciar: false no se anuncia (quien lo pide lo anuncia después, todo junto)", async () => {
    const desbloqueados = await achievements.applyEvent(G, "jugador-2", "casino_bet", 50, { anunciar: false });
    expect(desbloqueados).not.toHaveLength(0);
    expect(canal.send).not.toHaveBeenCalled();
});

test("sin canal de logros configurado no se anuncia nada", async () => {
    guildSettings.setSetting(G, "logros.notify_channel_id", "");
    await achievements.applyEvent(G, "jugador-3", "casino_bet", 50);
    expect(canal.send).not.toHaveBeenCalled();
    guildSettings.setSetting(G, "logros.notify_channel_id", "canal-logros");
});

test("la migración 014 pone 874776941000020018 como canal de logros donde se usa para los niveles", () => {
    db.prepare(
        "INSERT INTO xp_config (guildId, clave, valor) VALUES ('guild-con-niveles', 'xp_announce_channel_id', '874776941000020018')",
    ).run();
    db.prepare("INSERT INTO xp_config (guildId, clave, valor) VALUES ('guild-otro', 'xp_announce_channel_id', '123')").run();
    guildSettings.setSetting("guild-con-niveles", "logros.notify_channel_id", "viejo");
    migracion014.up(db, { log: { info: () => {}, warn: () => {} } });
    expect(guildSettings.getSettings("guild-con-niveles").logros.notify_channel_id).toBe("874776941000020018");
    expect(guildSettings.getSettings("guild-otro").logros.notify_channel_id).toBe("");
});
