// Fase 6 (niveles, XP y logros): logros de racha y de XP en un día (#336, #383), mejor racha y ranking (#339), DM de racha
// perdida (#342), días de gracia (#346), tope diario (#352), XP por reacciones (#358), roles sin XP (#362), multiplicador por
// canal (#369), anuncios de nivel off (#373) y recordatorio de logros sin reclamar (#378). El reloj es simulado; la BD, la de setupEnv.js.
const db = require("../src/core/db");
const xp = require("../src/systems/xpSystem");
const rachas = require("../src/systems/xp/rachas");
const diaria = require("../src/systems/xp/diaria");
const achievements = require("../src/systems/achievementsSystem");
const { ensureUser } = require("../src/systems/xp/config");
const { handleMessageXp, handleReactionXp } = require("../src/systems/xp/actividad");
const { runLogrosPendientesJob } = require("../src/discord/envios/logros");
const rankings = require("../src/paneles/perfil/rankings");
const avisosDm = require("../src/systems/avisosDm");
const rachasEnvios = require("../src/discord/envios/rachas");
const xpEnvios = require("../src/discord/envios/xp");

let n = 0;
const nuevoServidor = () => `g-f6-${++n}`;
const dia = (iso) => jest.setSystemTime(new Date(iso));

const enviados = [];
function cliente(guilds = []) {
    const enviar = async (payload) => {
        enviados.push(payload);
    };
    return {
        guilds: { cache: new Map(guilds.map((g) => [g.id, g])) },
        users: { fetch: async (id) => ({ id, send: (p) => enviar({ ...p, para: id }) }) },
    };
}
function servidor(id, extra = {}) {
    return { id, name: `Servidor ${id}`, client: cliente(), channels: { cache: new Map() }, roles: { cache: new Map() }, ...extra };
}
const miembro = (id, roles = []) => ({ id, roles: { cache: new Map(roles.map((r) => [r, { id: r }])) } });

function fijarRacha(g, u, dias, ultimoDia, extra = {}) {
    ensureUser(g, u);
    db.prepare("UPDATE xp_users SET streak_dias = ?, streak_last_day = ?, streak_max = ? WHERE guildId = ? AND userId = ?").run(
        dias,
        ultimoDia,
        extra.max ?? dias,
        g,
        u,
    );
}
const progresoLogro = (g, u, id) =>
    db
        .prepare("SELECT progress, completedAt FROM achievements_progress WHERE guildId = ? AND userId = ? AND achievementId = ?")
        .get(g, u, id);

beforeEach(() => {
    jest.useFakeTimers({ now: new Date("2026-10-10T12:00:00Z") });
    enviados.length = 0;
});
afterEach(() => {
    jest.useRealTimers();
});

describe("logros de racha (#336) y de XP en un día (#383)", () => {
    test("al llegar a 3 días de racha se completa «Constante»", async () => {
        const g = nuevoServidor();
        fijarRacha(g, "u", 2, "2026-10-09");
        await xp.addXp(servidor(g), miembro("u"), 10);
        expect(progresoLogro(g, "u", "racha_3").completedAt).not.toBeNull();
        expect(progresoLogro(g, "u", "racha_7").completedAt).toBeNull();
    });

    test("con la racha desactivada no se completa ninguno", async () => {
        const g = nuevoServidor();
        xp.setConfig(g, "streak_enabled", "0");
        fijarRacha(g, "u", 2, "2026-10-09");
        await xp.addXp(servidor(g), miembro("u"), 10);
        expect(progresoLogro(g, "u", "racha_3")).toBeUndefined();
    });

    test("1.000 XP en un día completan «Tarde intensa» y al día siguiente el contador empieza de cero", async () => {
        const g = nuevoServidor();
        xp.setConfig(g, "streak_enabled", "0");
        await xp.addXp(servidor(g), miembro("u"), 600);
        expect(progresoLogro(g, "u", "xp_dia_1000").completedAt).toBeNull();
        await xp.addXp(servidor(g), miembro("u"), 600);
        expect(progresoLogro(g, "u", "xp_dia_1000").completedAt).not.toBeNull();
        expect(diaria.xpDeHoy(g, "u", "2026-10-10")).toBe(1200);
        dia("2026-10-11T12:00:00Z");
        expect(diaria.xpDeHoy(g, "u", "2026-10-11")).toBe(0);
    });

    test("un ajuste manual de un admin no cuenta como XP del día", async () => {
        const g = nuevoServidor();
        xp.setConfig(g, "streak_enabled", "0");
        xp.setConfig(g, "xp_daily_cap", "100");
        await xp.adjustUserXp(servidor(g, { members: { cache: new Map(), fetch: async () => null } }), "u", 5000);
        expect(diaria.xpDeHoy(g, "u", "2026-10-10")).toBe(0);
        expect(ensureUser(g, "u").xp_total).toBe(5000);
    });

    test("la XP diaria de hace más de una semana se borra", () => {
        diaria.sumar("g", "u", "2026-09-20", 5);
        diaria.sumar("g", "u", "2026-10-09", 5);
        diaria.limpiar("2026-10-10");
        expect(diaria.xpDeHoy("g", "u", "2026-09-20")).toBe(0);
        expect(diaria.xpDeHoy("g", "u", "2026-10-09")).toBe(5);
    });
});

describe("mejor racha y ranking de rachas (#339)", () => {
    test("la mejor racha no baja al perder la actual, y la migración la rellena", async () => {
        const g = nuevoServidor();
        fijarRacha(g, "u", 5, "2026-10-09");
        rachas.updateStreak(g, "u");
        expect(ensureUser(g, "u").streak_max).toBe(6);
        dia("2026-10-20T12:00:00Z");
        rachas.updateStreak(g, "u"); // perdió la racha: vuelve a 1
        const fila = ensureUser(g, "u");
        expect(fila.streak_dias).toBe(1);
        expect(fila.streak_max).toBe(6);
    });

    test("getTopRachas ordena por mejor racha y enseña la actual; puestoRacha da el puesto", () => {
        const g = nuevoServidor();
        fijarRacha(g, "a", 3, "2026-10-10");
        fijarRacha(g, "b", 0, null, { max: 9 });
        fijarRacha(g, "c", 0, null, { max: 0 });
        expect(xp.getTopRachas(g)).toEqual([
            { userId: "b", mejor: 9, actual: 0 },
            { userId: "a", mejor: 3, actual: 3 },
        ]);
        expect(xp.puestoRacha(g, "a")).toEqual({ puesto: 2, mejor: 3 });
        expect(xp.puestoRacha(g, "c")).toBeNull();
    });

    test("🏆 Rankings → 🔥 Rachas muestra el top y el puesto de quien lo mira", async () => {
        const g = nuevoServidor();
        for (let i = 0; i < 11; i++) fijarRacha(g, `u${i}`, 20 - i, "2026-10-10");
        const guild = servidor(g);
        const vista = await rankings.buildRankings(guild, "u10", "u10", "rachas");
        const d = vista.embeds[0].data.description;
        expect(d).toContain("<@u0>");
        expect(d).toContain("Tu puesto: **#11**");
    });
});

describe("DM al perder una racha larga (#342)", () => {
    test("avisa una sola vez a quien tenía 3 días o más, el día que la pierde", async () => {
        const g = nuevoServidor();
        fijarRacha(g, "perdida-a", 12, "2026-10-08"); // la perdió: ayer fue 9 y no ganó
        fijarRacha(g, "perdida-b", 2, "2026-10-08"); // racha corta
        fijarRacha(g, "perdida-c", 5, "2026-10-09"); // sigue viva
        fijarRacha(g, "perdida-d", 5, "2026-10-07"); // ya se avisó otro día
        const client = cliente([servidor(g)]);
        await rachasEnvios.runStreakLostJob(client);
        expect(enviados.map((e) => e.para)).toEqual(["perdida-a"]);
        expect(enviados[0].embeds[0].data.description).toContain("**12 días seguidos**");
    });

    test("respeta /avisos y la racha desactivada", async () => {
        const g = nuevoServidor();
        const g2 = nuevoServidor();
        fijarRacha(g, "silenciado", 4, "2026-10-08");
        fijarRacha(g2, "sin-racha", 4, "2026-10-08");
        avisosDm.fijar("silenciado", "racha_perdida", false);
        xp.setConfig(g2, "streak_enabled", "0");
        await rachasEnvios.runStreakLostJob(cliente([servidor(g), servidor(g2)]));
        expect(enviados).toHaveLength(0);
    });

    test("con un día de gracia disponible la pérdida se avisa un día más tarde", async () => {
        const g = nuevoServidor();
        xp.setConfig(g, "streak_grace_per_month", "1");
        fijarRacha(g, "con-gracia", 6, "2026-10-08");
        await rachasEnvios.runStreakLostJob(cliente([servidor(g)]));
        expect(enviados).toHaveLength(0); // aún puede salvarla volviendo hoy
        dia("2026-10-11T12:00:00Z");
        await rachasEnvios.runStreakLostJob(cliente([servidor(g)]));
        expect(enviados.map((e) => e.para)).toEqual(["con-gracia"]);
    });

    test("también limpia la XP diaria vieja", async () => {
        diaria.sumar("g-limpieza", "u", "2026-09-01", 5);
        await rachasEnvios.runStreakLostJob(cliente());
        expect(diaria.xpDeHoy("g-limpieza", "u", "2026-09-01")).toBe(0);
    });
});

describe("día de gracia para no perder la racha (#346)", () => {
    test("con 1 día de gracia, faltar un día mantiene la racha y al volver suma", () => {
        const g = nuevoServidor();
        xp.setConfig(g, "streak_grace_per_month", "1");
        fijarRacha(g, "u", 5, "2026-10-08");
        expect(rachas.getEffectiveStreak(g, "u")).toBe(5);
        expect(rachas.updateStreak(g, "u")).toEqual({ streakDias: 6, incremented: true });
    });

    test("un segundo día sin XP en el mismo mes reinicia la racha", () => {
        const g = nuevoServidor();
        xp.setConfig(g, "streak_grace_per_month", "1");
        fijarRacha(g, "u", 5, "2026-10-08");
        rachas.updateStreak(g, "u"); // gasta la gracia del mes
        dia("2026-10-11T12:00:00Z");
        expect(rachas.updateStreak(g, "u")).toEqual({ streakDias: 7, incremented: true }); // jugó ayer: sigue
        dia("2026-10-13T12:00:00Z"); // faltó el 12 y ya no queda gracia este mes
        expect(rachas.getEffectiveStreak(g, "u")).toBe(0);
        expect(rachas.updateStreak(g, "u").streakDias).toBe(1);
    });

    test("el contador se reinicia el día 1 de cada mes natural", () => {
        const g = nuevoServidor();
        xp.setConfig(g, "streak_grace_per_month", "1");
        fijarRacha(g, "u", 5, "2026-10-29");
        dia("2026-10-31T12:00:00Z");
        expect(rachas.updateStreak(g, "u").streakDias).toBe(6); // gasta la de octubre
        dia("2026-11-02T12:00:00Z");
        expect(rachas.updateStreak(g, "u").streakDias).toBe(7); // noviembre: otra
    });

    test("con 0 días de gracia no cambia nada", () => {
        const g = nuevoServidor();
        fijarRacha(g, "u", 5, "2026-10-08");
        expect(rachas.getEffectiveStreak(g, "u")).toBe(0);
        expect(rachas.updateStreak(g, "u").streakDias).toBe(1);
    });
});

describe("tope diario de XP (#352)", () => {
    test("al llegar al tope no gana más ese día, y mañana vuelve a ganar", async () => {
        const g = nuevoServidor();
        xp.setConfig(g, "streak_enabled", "0");
        xp.setConfig(g, "xp_daily_cap", "500");
        expect((await xp.addXp(servidor(g), miembro("u"), 400)).gain).toBe(400);
        expect((await xp.addXp(servidor(g), miembro("u"), 400)).gain).toBe(100); // solo lo que quedaba
        expect((await xp.addXp(servidor(g), miembro("u"), 400)).gain).toBe(0);
        expect(ensureUser(g, "u").xp_total).toBe(500);
        dia("2026-10-11T12:00:00Z");
        expect((await xp.addXp(servidor(g), miembro("u"), 50)).gain).toBe(50);
    });

    test("el tope se aplica a la ganancia final, con racha y multiplicador, y los logros ven la XP recortada", async () => {
        const g = nuevoServidor();
        xp.setConfig(g, "xp_multiplier", "2");
        xp.setConfig(g, "xp_daily_cap", "1500");
        const r = await xp.addXp(servidor(g), miembro("u"), 1000); // 2000 sin tope
        expect(r.gain).toBeLessThanOrEqual(1500);
        expect(diaria.xpDeHoy(g, "u", "2026-10-10")).toBe(r.gain);
        expect(progresoLogro(g, "u", "xp_dia_3000")?.completedAt ?? null).toBeNull();
    });

    test("con tope 0 no hay límite", async () => {
        const g = nuevoServidor();
        xp.setConfig(g, "streak_enabled", "0");
        expect((await xp.addXp(servidor(g), miembro("u"), 100000)).gain).toBe(100000);
    });
});

describe("multiplicador de XP por canal (#369)", () => {
    test("x2 da el doble que un canal normal, también por voz (addXp)", async () => {
        const g = nuevoServidor();
        xp.setConfig(g, "streak_enabled", "0");
        const normal = await xp.addXp(servidor(g), miembro("a"), 15);
        const doble = await xp.addXp(servidor(g), miembro("b"), 15, { multiplicadorCanal: 2 });
        expect(doble.gain).toBe(normal.gain * 2);
    });

    test("un mensaje en un canal x0 no da XP ni gasta el cooldown; en x1 se guarda como nada", async () => {
        const g = nuevoServidor();
        const guild = { id: g, name: "x", client: cliente(), members: { fetch: async () => null } };
        xp.setMultiplicadorCanal(g, "memes", 0);
        const msg = (canal) => ({ content: "hola mundo", channelId: canal, author: { id: "u", bot: false }, member: miembro("u"), guild });
        await handleMessageXp(msg("memes"));
        expect(ensureUser(g, "u").xp_total).toBe(0);
        await handleMessageXp(msg("general"));
        expect(ensureUser(g, "u").xp_total).toBeGreaterThan(0);
        xp.setMultiplicadorCanal(g, "memes", 1);
        expect(xp.getMultiplicadoresCanal(g)).toEqual([]);
    });

    test("un mensaje en un canal x2 da el doble que en uno sin multiplicador", async () => {
        const g = nuevoServidor();
        xp.setConfig(g, "streak_enabled", "0");
        xp.setMultiplicadorCanal(g, "quedadas", 2);
        const guild = { id: g, name: "x", client: cliente(), members: { fetch: async () => null } };
        const msg = (u, canal) => ({ content: "hola", channelId: canal, author: { id: u, bot: false }, member: miembro(u), guild });
        await handleMessageXp(msg("a", "general"));
        await handleMessageXp(msg("b", "quedadas"));
        expect(ensureUser(g, "b").xp_total).toBe(ensureUser(g, "a").xp_total * 2);
    });
});

describe("roles sin XP (#362)", () => {
    test("quien tiene el rol no gana XP por mensajes; al quitárselo vuelve a ganar", async () => {
        const g = nuevoServidor();
        xp.addIgnoredRole(g, "invitado", "Invitado");
        const guild = { id: g, name: "x", client: cliente(), members: { fetch: async () => null } };
        const msg = (u, member) => ({ content: "hola", channelId: "c", author: { id: u, bot: false }, member, guild });
        await handleMessageXp(msg("a", miembro("a", ["invitado"])));
        expect(ensureUser(g, "a").xp_total).toBe(0);
        await handleMessageXp(msg("b", miembro("b", ["otro"])));
        expect(ensureUser(g, "b").xp_total).toBeGreaterThan(0);
        expect(xp.removeIgnoredRole(g, "invitado")).toBe(true);
        expect(xp.removeIgnoredRole(g, "invitado")).toBe(false);
        await handleMessageXp(msg("a", miembro("a", ["invitado"])));
        expect(ensureUser(g, "a").xp_total).toBeGreaterThan(0);
    });
});

describe("XP por reacciones recibidas (#358)", () => {
    const reaccion = (g, { autor = "autor", canal = "c", bot = false, member } = {}) => ({
        message: {
            guild: { id: g, name: "x", client: cliente(), members: { fetch: async () => null } },
            channelId: canal,
            author: { id: autor, bot },
            member: member ?? miembro(autor),
        },
    });

    test("da XP al autor, como mucho una vez cada N segundos por autor", async () => {
        const g = nuevoServidor();
        xp.setConfig(g, "streak_enabled", "0");
        await handleReactionXp(reaccion(g), { id: "otro", bot: false });
        expect(ensureUser(g, "autor").xp_total).toBe(3);
        await handleReactionXp(reaccion(g), { id: "otro", bot: false });
        expect(ensureUser(g, "autor").xp_total).toBe(3); // cooldown
        dia("2026-10-10T12:02:00Z");
        await handleReactionXp(reaccion(g), { id: "otro", bot: false });
        expect(ensureUser(g, "autor").xp_total).toBe(6);
        expect(ensureUser(g, "otro").xp_total).toBe(0); // quien reacciona no gana
    });

    test("no cuentan: la propia, de bots, a bots, en canales ignorados o con rol sin XP; con base 0 está apagado", async () => {
        const g = nuevoServidor();
        xp.setConfig(g, "streak_enabled", "0");
        await handleReactionXp(reaccion(g), { id: "autor", bot: false });
        await handleReactionXp(reaccion(g), { id: "robot", bot: true });
        await handleReactionXp(reaccion(g, { autor: "bot", bot: true }), { id: "otro", bot: false });
        xp.addIgnoredChannel(g, "ignorado", "x");
        await handleReactionXp(reaccion(g, { canal: "ignorado" }), { id: "otro", bot: false });
        xp.addIgnoredRole(g, "mudo", "Mudo");
        await handleReactionXp(reaccion(g, { member: miembro("autor", ["mudo"]) }), { id: "otro", bot: false });
        xp.setConfig(g, "xp_reaction_base", "0");
        await handleReactionXp(reaccion(g), { id: "otro", bot: false });
        expect(ensureUser(g, "autor").xp_total).toBe(0);
    });
});

describe("desactivar mis anuncios de subida de nivel (#373)", () => {
    test("con la preferencia activa no se publica nada, pero se dan los roles; por defecto sí se anuncia", async () => {
        const g = nuevoServidor();
        xp.setConfig(g, "xp_announce_channel_id", "anuncios");
        xp.setConfig(g, "streak_enabled", "0");
        const send = jest.fn(async () => {});
        const canal = { id: "anuncios", name: "anuncios", isTextBased: () => true, send };
        const guild = servidor(g, { channels: { cache: new Map([["anuncios", canal]]) } });
        const miembroConToString = (id) => ({ ...miembro(id), toString: () => `<@${id}>`, user: { id } });

        const ra = await xp.addXp(guild, miembroConToString("a"), 100000);
        await xpEnvios.procesarResultadoXp(guild, miembroConToString("a"), ra);
        expect(send).toHaveBeenCalledTimes(1);

        xp.setAnunciosOff(g, "b", true);
        expect(xp.anunciosOff(g, "b")).toBe(true);
        const rb = await xp.addXp(guild, miembroConToString("b"), 100000);
        await xpEnvios.procesarResultadoXp(guild, miembroConToString("b"), rb);
        expect(send).toHaveBeenCalledTimes(1);
        expect(ensureUser(g, "b").nivel).toBeGreaterThan(0);

        xp.setAnunciosOff(g, "b", false);
        expect(xp.anunciosOff(g, "b")).toBe(false);
    });
});

describe("recordatorio semanal de logros sin reclamar (#378)", () => {
    function logroCompletado(g, u, id = "primer_mensaje") {
        db.prepare(
            "INSERT OR REPLACE INTO achievements_progress (guildId, userId, achievementId, progress, completedAt) VALUES (?, ?, ?, 1, ?)",
        ).run(g, u, id, Date.now());
    }

    test("solo avisa a quien tiene logros sin reclamar, con su número, y como mucho una vez cada 7 días", async () => {
        const g = nuevoServidor();
        logroCompletado(g, "a");
        logroCompletado(g, "a", "charlatan_100");
        logroCompletado(g, "b");
        db.prepare("UPDATE achievements_progress SET claimedAt = ? WHERE guildId = ? AND userId = 'b'").run(Date.now(), g);
        const client = cliente([servidor(g)]);
        await runLogrosPendientesJob(client);
        expect(enviados.map((e) => e.para)).toEqual(["a"]);
        expect(enviados[0].embeds[0].data.description).toContain("**2** logros completados");

        await runLogrosPendientesJob(client);
        expect(enviados).toHaveLength(1); // aún no ha pasado una semana
        dia("2026-10-17T12:00:00Z");
        await runLogrosPendientesJob(client);
        expect(enviados).toHaveLength(2);
    });

    test("no cuenta las categorías desactivadas ni avisa con los logros apagados o el aviso silenciado", async () => {
        const g = nuevoServidor();
        logroCompletado(g, "a"); // social
        logroCompletado(g, "c");
        avisosDm.fijar("c", "logros_pendientes", false);
        const guildSettings = require("../src/systems/guildSettings");
        guildSettings.setSetting(g, "logros.disabled_categories", "social");
        await runLogrosPendientesJob(cliente([servidor(g)]));
        expect(enviados).toHaveLength(0);
        expect(achievements.getSummary(g, "a").claimable).toBe(0);
    });

    test("si los DMs están cerrados no se apunta el aviso y no falla", async () => {
        const g = nuevoServidor();
        logroCompletado(g, "a");
        const client = cliente([servidor(g)]);
        client.users.fetch = async () => {
            throw Object.assign(new Error("closed"), { code: 50007 });
        };
        await expect(runLogrosPendientesJob(client)).resolves.toBeUndefined();
        expect(db.prepare("SELECT ultimo_recordatorio_logros AS u FROM xp_users WHERE guildId = ? AND userId = 'a'").get(g).u).toBeNull();
    });
});
