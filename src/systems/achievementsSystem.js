const db = require("../core/db");
const guildSettings = require("./guildSettings");
const { createLogger } = require("../core/logger");

const log = createLogger("Logros");

const CATALOG = [
    {
        id: "primer_mensaje",
        name: "Hola Mundo",
        desc: "Envía tu primer mensaje válido",
        category: "social",
        event: "message_count",
        metric: "sum",
        target: 1,
        rewardCoins: 100,
    },
    {
        id: "charlatan_100",
        name: "Charlatán",
        desc: "Envía 100 mensajes válidos",
        category: "social",
        event: "message_count",
        metric: "sum",
        target: 100,
        rewardCoins: 400,
    },
    {
        id: "veterano_1000",
        name: "Veterano",
        desc: "Envía 1000 mensajes válidos",
        category: "social",
        event: "message_count",
        metric: "sum",
        target: 1000,
        rewardCoins: 1500,
    },
    {
        id: "cronista_2500",
        name: "Cronista",
        desc: "Envía 2500 mensajes válidos",
        category: "social",
        event: "message_count",
        metric: "sum",
        target: 2500,
        rewardCoins: 2500,
    },
    {
        id: "leyenda_chat_5000",
        name: "Leyenda del Chat",
        desc: "Envía 5000 mensajes válidos",
        category: "social",
        event: "message_count",
        metric: "sum",
        target: 5000,
        rewardCoins: 5000,
    },
    {
        id: "voz_60",
        name: "Locutor",
        desc: "Acumula 60 minutos en voz",
        category: "xp",
        event: "voice_minutes",
        metric: "sum",
        target: 60,
        rewardCoins: 300,
    },
    {
        id: "voz_300",
        name: "Podcaster",
        desc: "Acumula 300 minutos en voz",
        category: "xp",
        event: "voice_minutes",
        metric: "sum",
        target: 300,
        rewardCoins: 1200,
    },
    {
        id: "voz_1000",
        name: "Radio Duende",
        desc: "Acumula 1000 minutos en voz",
        category: "xp",
        event: "voice_minutes",
        metric: "sum",
        target: 1000,
        rewardCoins: 3500,
    },
    {
        id: "xp_1000",
        name: "Aprendiz",
        desc: "Gana 1000 XP total",
        category: "xp",
        event: "xp_gain",
        metric: "sum",
        target: 1000,
        rewardCoins: 300,
    },
    {
        id: "xp_5000",
        name: "Erudito",
        desc: "Gana 5000 XP total",
        category: "xp",
        event: "xp_gain",
        metric: "sum",
        target: 5000,
        rewardCoins: 1500,
    },
    {
        id: "xp_20000",
        name: "Sabio",
        desc: "Gana 20.000 XP total",
        category: "xp",
        event: "xp_gain",
        metric: "sum",
        target: 20000,
        rewardCoins: 5000,
    },
    {
        id: "nivel_10",
        name: "Subiendo",
        desc: "Alcanza nivel 10",
        category: "xp",
        event: "xp_level",
        metric: "max",
        target: 10,
        rewardCoins: 500,
    },
    {
        id: "nivel_25",
        name: "Experimentado",
        desc: "Alcanza nivel 25",
        category: "xp",
        event: "xp_level",
        metric: "max",
        target: 25,
        rewardCoins: 1500,
    },
    {
        id: "nivel_40",
        name: "Avanzado",
        desc: "Alcanza nivel 40",
        category: "xp",
        event: "xp_level",
        metric: "max",
        target: 40,
        rewardCoins: 3500,
    },
    {
        id: "nivel_60",
        name: "Elite",
        desc: "Alcanza nivel 60",
        category: "xp",
        event: "xp_level",
        metric: "max",
        target: 60,
        rewardCoins: 7000,
    },
    {
        id: "casino_primera",
        name: "Primera Apuesta",
        desc: "Realiza tu primera apuesta",
        category: "casino",
        event: "casino_bet",
        metric: "sum",
        target: 1,
        rewardCoins: 150,
    },
    {
        id: "casino_10000",
        name: "High Roller",
        desc: "Apuesta 10.000 monedas acumuladas",
        category: "casino",
        event: "casino_bet",
        metric: "sum",
        target: 10000,
        rewardCoins: 800,
    },
    {
        id: "casino_50000",
        name: "Mesa VIP",
        desc: "Apuesta 50.000 monedas acumuladas",
        category: "casino",
        event: "casino_bet",
        metric: "sum",
        target: 50000,
        rewardCoins: 3500,
    },
    {
        id: "casino_wins_25",
        name: "Golpe de Suerte",
        desc: "Consigue 25 victorias en casino",
        category: "casino",
        event: "casino_win_count",
        metric: "sum",
        target: 25,
        rewardCoins: 1200,
    },
    {
        id: "casino_wins_100",
        name: "Imparable",
        desc: "Consigue 100 victorias en casino",
        category: "casino",
        event: "casino_win_count",
        metric: "sum",
        target: 100,
        rewardCoins: 4500,
    },
    {
        id: "casino_profit_5000",
        name: "Con Beneficios",
        desc: "Gana 5.000 monedas netas en casino",
        category: "casino",
        event: "casino_net_profit",
        metric: "sum",
        target: 5000,
        rewardCoins: 2000,
    },
    {
        id: "casino_profit_20000",
        name: "Magnate del Azar",
        desc: "Gana 20.000 monedas netas en casino",
        category: "casino",
        event: "casino_net_profit",
        metric: "sum",
        target: 20000,
        rewardCoins: 7500,
    },
    {
        id: "casino_losses_50",
        name: "Cabezota",
        desc: "Pierde 50 partidas en casino",
        category: "casino",
        event: "casino_loss_count",
        metric: "sum",
        target: 50,
        rewardCoins: 1800,
        hidden: true,
    },
    {
        id: "cripto_primera",
        name: "Inversor Novato",
        desc: "Haz tu primera compra cripto",
        category: "cripto",
        event: "cripto_buy_count",
        metric: "sum",
        target: 1,
        rewardCoins: 150,
    },
    {
        id: "cripto_10_ops",
        name: "Trader Activo",
        desc: "Completa 10 operaciones cripto",
        category: "cripto",
        event: "cripto_ops_count",
        metric: "sum",
        target: 10,
        rewardCoins: 900,
    },
    {
        id: "cripto_50_ops",
        name: "Trader Pro",
        desc: "Completa 50 operaciones cripto",
        category: "cripto",
        event: "cripto_ops_count",
        metric: "sum",
        target: 50,
        rewardCoins: 4000,
    },
    {
        id: "cripto_vol_20000",
        name: "Volumen Alto",
        desc: "Mueve 20.000 monedas en cripto",
        category: "cripto",
        event: "cripto_volume",
        metric: "sum",
        target: 20000,
        rewardCoins: 1500,
    },
    {
        id: "cripto_vol_100000",
        name: "Ballena de Mercado",
        desc: "Mueve 100.000 monedas en cripto",
        category: "cripto",
        event: "cripto_volume",
        metric: "sum",
        target: 100000,
        rewardCoins: 7000,
    },
    {
        id: "cripto_sell_25",
        name: "Tomador de Ganancias",
        desc: "Realiza 25 ventas cripto",
        category: "cripto",
        event: "cripto_sell_count",
        metric: "sum",
        target: 25,
        rewardCoins: 2500,
    },
    {
        id: "ttcl_holder_500",
        name: "Ballena TTCL",
        desc: "Mantén 500 TTCL",
        category: "cripto",
        event: "ttcl_hold_max",
        metric: "max",
        target: 500,
        rewardCoins: 1800,
        hidden: true,
    },
    {
        id: "ttcl_holder_2000",
        name: "Titán TTCL",
        desc: "Mantén 2000 TTCL",
        category: "cripto",
        event: "ttcl_hold_max",
        metric: "max",
        target: 2000,
        rewardCoins: 9000,
        hidden: true,
    },
    {
        id: "tienda_primera",
        name: "Cliente",
        desc: "Compra tu primer objeto",
        category: "tienda",
        event: "tienda_buy_count",
        metric: "sum",
        target: 1,
        rewardCoins: 120,
    },
    {
        id: "tienda_20",
        name: "Comprador Compulsivo",
        desc: "Realiza 20 compras",
        category: "tienda",
        event: "tienda_buy_count",
        metric: "sum",
        target: 20,
        rewardCoins: 1100,
    },
    {
        id: "tienda_50",
        name: "Coleccionista",
        desc: "Realiza 50 compras",
        category: "tienda",
        event: "tienda_buy_count",
        metric: "sum",
        target: 50,
        rewardCoins: 3200,
    },
    {
        id: "tienda_5000",
        name: "Mecenas",
        desc: "Gasta 5.000 en tienda",
        category: "tienda",
        event: "tienda_spent",
        metric: "sum",
        target: 5000,
        rewardCoins: 1300,
    },
    {
        id: "tienda_20000",
        name: "Patrocinador",
        desc: "Gasta 20.000 en tienda",
        category: "tienda",
        event: "tienda_spent",
        metric: "sum",
        target: 20000,
        rewardCoins: 6000,
    },
    // 🍿 Plex: se calculan con el historial de Tautulli de quien tiene la cuenta vinculada (systems/plexHistorial).
    // Todos son "max": el evento trae el total actual (horas, películas...), no lo que se suma.
    ...[
        ["plex_horas_10", "Palomitas en mano", "Ve 10 horas en Plex", "plex_horas", 10, 300],
        ["plex_horas_100", "Cinéfilo", "Ve 100 horas en Plex", "plex_horas", 100, 1500],
        ["plex_horas_500", "Okupa del sofá", "Ve 500 horas en Plex", "plex_horas", 500, 5000],
        ["plex_horas_1000", "Leyenda del sofá", "Ve 1.000 horas en Plex", "plex_horas", 1000, 10000],
        ["plex_pelis_1", "Se apagan las luces", "Ve tu primera película entera", "plex_peliculas", 1, 100],
        ["plex_pelis_25", "Socio del videoclub", "Ve 25 películas distintas", "plex_peliculas", 25, 1200],
        ["plex_pelis_100", "Filmoteca andante", "Ve 100 películas distintas", "plex_peliculas", 100, 4000],
        ["plex_eps_50", "Enganchado", "Ve 50 episodios distintos", "plex_episodios", 50, 800],
        ["plex_eps_250", "Seriéfilo", "Ve 250 episodios distintos", "plex_episodios", 250, 3000],
        ["plex_eps_1000", "Previously on...", "Ve 1.000 episodios distintos", "plex_episodios", 1000, 9000],
        ["plex_series_10", "Picoteo de series", "Ve episodios de 10 series distintas", "plex_series", 10, 1000],
        ["plex_series_30", "Zapping infinito", "Ve episodios de 30 series distintas", "plex_series", 30, 3500],
        ["plex_maraton_6", "Maratón", "Ve 6 horas en un mismo día", "plex_maraton", 6, 800],
        ["plex_maraton_10", "Sin pestañear", "Ve 10 horas en un mismo día", "plex_maraton", 10, 2000, true],
        ["plex_atracon_5", "Atracón", "Ve 5 episodios de la misma serie en un día", "plex_atracon", 5, 700],
        ["plex_atracon_10", "Temporada de una sentada", "Ve 10 episodios de la misma serie en un día", "plex_atracon", 10, 1800, true],
        ["plex_noche_5", "Noctámbulo", "Ve algo de madrugada (entre las 3 y las 6) en 5 noches distintas", "plex_noctambulo", 5, 900, true],
    ].map(([id, name, desc, event, target, rewardCoins, hidden]) => ({
        id,
        name,
        desc,
        category: "plex",
        event,
        metric: "max",
        target,
        rewardCoins,
        ...(hidden ? { hidden: true } : {}),
    })),
];

function getLogrosSettings(guildId) {
    const settings = guildSettings.getSettings(guildId);
    const logros = settings.logros || {};
    return {
        enabled: typeof logros.enabled === "boolean" ? logros.enabled : true,
        reward_multiplier: Math.max(0, Number(logros.reward_multiplier || 1)),
        notify_channel_id: String(logros.notify_channel_id || ""),
        disabled_categories: String(logros.disabled_categories || ""),
    };
}

function getCategorySet(disabledCategories) {
    return new Set(
        String(disabledCategories || "")
            .split(",")
            .map((v) => v.trim().toLowerCase())
            .filter(Boolean),
    );
}

function getCatalog(guildId) {
    const cfg = getLogrosSettings(guildId);
    const disabled = getCategorySet(cfg.disabled_categories);
    return CATALOG.filter((a) => !disabled.has(String(a.category || "").toLowerCase()));
}

function getById(id) {
    return CATALOG.find((a) => a.id === id) || null;
}

function listUserAchievements(guildId, userId, opts = {}) {
    const includeHidden = Boolean(opts.includeHidden);
    const catalog = getCatalog(guildId);
    const rows = db
        .prepare("SELECT achievementId, progress, completedAt, claimedAt FROM achievements_progress WHERE guildId = ? AND userId = ?")
        .all(guildId, userId);
    const byId = new Map(rows.map((r) => [r.achievementId, r]));

    const list = [];
    for (const ach of catalog) {
        const row = byId.get(ach.id);
        const progress = Number(row?.progress || 0);
        const completedAt = row?.completedAt || null;
        const claimedAt = row?.claimedAt || null;
        const completed = !!completedAt;

        if (ach.hidden && !completed && !includeHidden) continue;

        list.push({
            ...ach,
            progress,
            completed,
            completedAt,
            claimedAt,
            claimable: completed && !claimedAt,
        });
    }

    return list.sort((a, b) => Number(Boolean(b.completed)) - Number(Boolean(a.completed)) || a.target - b.target);
}

function getSummary(guildId, userId) {
    const all = listUserAchievements(guildId, userId, { includeHidden: true });
    const visible = all.filter((a) => !a.hidden || a.completed);
    const completed = visible.filter((a) => a.completed).length;
    const claimable = visible.filter((a) => a.claimable).length;
    return {
        total: visible.length,
        completed,
        claimable,
        completionPct: visible.length ? Math.round((completed / visible.length) * 100) : 0,
    };
}

function upsertProgress(guildId, userId, achievementId, progress, completedAt) {
    db.prepare(
        `
        INSERT INTO achievements_progress (guildId, userId, achievementId, progress, completedAt)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(guildId, userId, achievementId) DO UPDATE SET
            progress = excluded.progress,
            completedAt = COALESCE(achievements_progress.completedAt, excluded.completedAt)
    `,
    ).run(guildId, userId, achievementId, progress, completedAt || null);
}

async function maybeNotifyUnlocked(guild, userId, unlocked) {
    if (!guild || !unlocked || !unlocked.length) return;
    const cfg = getLogrosSettings(guild.id);
    const channelId = cfg.notify_channel_id;
    if (!channelId) return;

    const channel = guild.channels.cache.get(channelId) || (await guild.channels.fetch(channelId).catch(() => null));
    if (!channel || !channel.isTextBased()) {
        log.warn(`Canal de avisos de logros ${channelId} no encontrado o no es de texto en ${guild.name}`);
        return;
    }

    const names = unlocked.map((a) => `🏅 **${a.name}**`).join("\n");
    try {
        await channel.send(`🎉 <@${userId}> desbloqueó logros:\n${names}\nReclámalos en /perfil → 🏅 Logros.`);
    } catch (e) {
        log.warn(`No se pudo anunciar logros desbloqueados en #${channel.name}:`, e.message);
    }
}

// Nunca lanza: se llama "de paso" (con void) desde el casino, la tienda, el XP... y un fallo
// aquí no debe romper esa acción ni acabar como promesa rechazada sin capturar.
async function applyEvent(guildOrId, userId, event, value = 1) {
    try {
        return await applyEventUnsafe(guildOrId, userId, event, value);
    } catch (e) {
        log.error(`Error aplicando el evento ${event} (${value}) a ${userId}:`, e);
        return [];
    }
}

async function applyEventUnsafe(guildOrId, userId, event, value = 1) {
    const guildId = typeof guildOrId === "string" ? guildOrId : guildOrId?.id;
    const guild = typeof guildOrId === "string" ? null : guildOrId;
    if (!guildId || !userId || !event) return [];

    const cfg = getLogrosSettings(guildId);
    if (!cfg.enabled) return [];

    const catalog = getCatalog(guildId).filter((a) => a.event === event);
    if (!catalog.length) return [];

    const unlocked = [];
    const tx = db.transaction(() => {
        for (const ach of catalog) {
            const row = db
                .prepare("SELECT progress, completedAt FROM achievements_progress WHERE guildId = ? AND userId = ? AND achievementId = ?")
                .get(guildId, userId, ach.id);

            const current = Number(row?.progress || 0);
            const done = !!row?.completedAt;
            const next = ach.metric === "max" ? Math.max(current, Number(value || 0)) : current + Number(value || 0);

            let completedAt = row?.completedAt || null;
            if (!done && next >= Number(ach.target || 1)) {
                completedAt = Date.now();
                unlocked.push(ach);
            }

            upsertProgress(guildId, userId, ach.id, next, completedAt);
        }
    });

    tx();

    if (unlocked.length) {
        log.info(`${userId} desbloqueó en ${guildId}: ${unlocked.map((a) => a.id).join(", ")} (evento ${event})`);
        await maybeNotifyUnlocked(guild, userId, unlocked);
    }
    return unlocked;
}

function rewardCoinsFor(ach, guildId) {
    const cfg = getLogrosSettings(guildId);
    const base = Number(ach?.rewardCoins || 0);
    return Math.max(0, Math.floor(base * cfg.reward_multiplier));
}

function claimAchievement(guildId, userId, achievementId) {
    const ach = getById(achievementId);
    if (!ach) return { ok: false, msg: "Logro no existe." };

    const row = db
        .prepare(
            "SELECT progress, completedAt, claimedAt FROM achievements_progress WHERE guildId = ? AND userId = ? AND achievementId = ?",
        )
        .get(guildId, userId, achievementId);

    if (!row?.completedAt) return { ok: false, msg: "Ese logro todavía no está completado." };
    if (row.claimedAt) return { ok: false, msg: "Ese logro ya fue reclamado." };

    const reward = rewardCoinsFor(ach, guildId);

    const tx = db.transaction(() => {
        if (reward > 0) {
            // Al 💵 efectivo (systems/dinero); crea la cuenta si no la tenía.
            require("./dinero").pagar(userId, reward);
            try {
                require("./dinero").apuntar(userId, "logro", `Recompensa logro: ${ach.name}`, reward);
            } catch (e) {
                log.warn(`Recompensa de ${ach.id} pagada a ${userId} pero no se pudo apuntar en el historial:`, e.message);
            }
        }

        db.prepare("UPDATE achievements_progress SET claimedAt = ? WHERE guildId = ? AND userId = ? AND achievementId = ?").run(
            Date.now(),
            guildId,
            userId,
            achievementId,
        );
    });

    tx();
    log.info(`${userId} reclamó ${ach.id} en ${guildId}: +${reward} monedas`);
    return { ok: true, reward, achievement: ach };
}

function claimAll(guildId, userId) {
    const rows = db
        .prepare(
            "SELECT achievementId FROM achievements_progress WHERE guildId = ? AND userId = ? AND completedAt IS NOT NULL AND claimedAt IS NULL",
        )
        .all(guildId, userId);

    if (!rows.length) return { ok: false, msg: "No tienes logros pendientes por reclamar.", count: 0, reward: 0 };

    let totalReward = 0;
    let count = 0;
    for (const row of rows) {
        const result = claimAchievement(guildId, userId, row.achievementId);
        if (result.ok) {
            totalReward += Number(result.reward || 0);
            count += 1;
        }
    }

    return { ok: true, count, reward: totalReward };
}

function getTopUsers(guildId, limit = 10) {
    const catalog = getCatalog(guildId);
    if (!catalog.length) return [];
    const ids = catalog.map((a) => a.id);
    const placeholders = ids.map(() => "?").join(",");

    return db
        .prepare(
            `
                SELECT userId,
                             COUNT(*) AS completed,
                             COALESCE(SUM(CASE WHEN claimedAt IS NOT NULL THEN 1 ELSE 0 END), 0) AS claimed
                FROM achievements_progress
                WHERE guildId = ?
                    AND completedAt IS NOT NULL
                    AND achievementId IN (${placeholders})
                GROUP BY userId
                ORDER BY completed DESC, claimed DESC, userId ASC
                LIMIT ?
        `,
        )
        .all(guildId, ...ids, Math.max(1, Math.min(25, Number(limit) || 10)));
}

module.exports = {
    CATALOG,
    getCatalog,
    listUserAchievements,
    getSummary,
    applyEvent,
    claimAchievement,
    rewardCoinsFor,
    claimAll,
    getTopUsers,
};
