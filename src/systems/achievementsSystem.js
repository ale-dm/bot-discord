const db = require("../core/db");
const guildSettings = require("./guildSettings");
const pase = require("./pase/pase");
const { createLogger } = require("../core/logger");

const log = createLogger("Logros");

const { CATALOG } = require("./logros/catalogo");

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

// Los trofeos de Plex de cada servidor (fases 2 y 3) están en la BD, no en el código: se añaden al catálogo fijo.
function catalogoDinamico(guildId) {
    if (!guildId) return [];
    try {
        return require("./plexTrofeos").catalogo(guildId);
    } catch (e) {
        log.warn(`No se pudieron leer los trofeos de Plex de ${guildId}: ${e.message}`);
        return [];
    }
}

/** Si cuentan los logros de una categoría en un servidor (logros activados y la categoría sin desactivar). */
function categoriaActiva(guildId, categoria) {
    const cfg = getLogrosSettings(guildId);
    return cfg.enabled && !getCategorySet(cfg.disabled_categories).has(String(categoria).toLowerCase());
}

function getCatalog(guildId) {
    const cfg = getLogrosSettings(guildId);
    const disabled = getCategorySet(cfg.disabled_categories);
    return [...CATALOG, ...catalogoDinamico(guildId)].filter((a) => !disabled.has(String(a.category || "").toLowerCase()));
}

function getById(id, guildId) {
    return CATALOG.find((a) => a.id === id) || catalogoDinamico(guildId).find((a) => a.id === id) || null;
}

// `excluirCategorias`: para el perfil de alguien que ha ocultado sus logros de Plex a los demás.
// `ocultarPendientes`: categorías de las que solo salen los completados (los de Plex a quien no lo tiene vinculado).
// `visibleHasta` (ms) en un logro: pasado ese momento, solo sale a quien lo completó.
// Los `soloCompletado` (los trofeos de cada serie, saga...) solo salen a quien los tiene, también con los secretos.
function listUserAchievements(guildId, userId, opts = {}) {
    const includeHidden = Boolean(opts.includeHidden);
    const excluir = new Set(opts.excluirCategorias || []);
    const ocultarPendientes = new Set(opts.ocultarPendientes || []);
    const catalog = getCatalog(guildId).filter((a) => !excluir.has(a.category));
    const rows = db
        .prepare(
            "SELECT achievementId, progress, completedAt, claimedAt, importado FROM achievements_progress WHERE guildId = ? AND userId = ?",
        )
        .all(guildId, userId);
    const byId = new Map(rows.map((r) => [r.achievementId, r]));

    const list = [];
    for (const ach of catalog) {
        const row = byId.get(ach.id);
        const progress = Number(row?.progress || 0);
        const completedAt = row?.completedAt || null;
        const claimedAt = row?.claimedAt || null;
        const completed = !!completedAt;

        if (ach.soloCompletado && !completed) continue;
        if (ach.hidden && !completed && !includeHidden) continue;
        if (ocultarPendientes.has(ach.category) && !completed) continue;
        // Con plazo (los trofeos de Plex con fecha): pasado, solo sale a quien lo consiguió.
        if (ach.visibleHasta && !completed && Date.now() >= ach.visibleHasta) continue;

        list.push({
            ...ach,
            progress,
            completed,
            completedAt,
            claimedAt,
            claimable: completed && !claimedAt,
            importado: Boolean(row?.importado),
        });
    }

    return list.sort((a, b) => Number(Boolean(b.completed)) - Number(Boolean(a.completed)) || a.target - b.target);
}

function getSummary(guildId, userId, opts = {}) {
    const all = listUserAchievements(guildId, userId, { ...opts, includeHidden: true });
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

// `importado`: se desbloquea ahora con lo antiguo (la primera importación de Plex): da menos monedas al reclamarlo.
function upsertProgress(guildId, userId, achievementId, progress, completedAt, importado = false) {
    db.prepare(
        `
        INSERT INTO achievements_progress (guildId, userId, achievementId, progress, completedAt, importado)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(guildId, userId, achievementId) DO UPDATE SET
            progress = excluded.progress,
            completedAt = COALESCE(achievements_progress.completedAt, excluded.completedAt),
            importado = CASE WHEN achievements_progress.completedAt IS NULL THEN excluded.importado ELSE achievements_progress.importado END
    `,
    ).run(guildId, userId, achievementId, progress, completedAt || null, importado ? 1 : 0);
}

// El cliente de Discord, para encontrar el servidor cuando solo llega su id (el casino y la cripto llaman con el id:
// sin esto, sus logros nunca se anunciaban). Lo pone index.js al arrancar.
let clienteDiscord = null;
function setClient(client) {
    clienteDiscord = client;
}

/**
 * Anuncia en el canal de logros (Config Global → Logros) que alguien ha desbloqueado logros, mencionándole. Acepta el
 * servidor o su id. Sin canal configurado, no hace nada.
 */
async function maybeNotifyUnlocked(guildOrId, userId, unlocked) {
    if (!guildOrId || !unlocked || !unlocked.length) return;
    const guild = typeof guildOrId === "string" ? clienteDiscord?.guilds?.cache?.get(guildOrId) : guildOrId;
    if (!guild) return;
    const cfg = getLogrosSettings(guild.id);
    const channelId = cfg.notify_channel_id;
    if (!channelId) return;

    const channel = guild.channels.cache.get(channelId) || (await guild.channels.fetch(channelId).catch(() => null));
    if (!channel || !channel.isTextBased()) {
        log.warn(`Canal de avisos de logros ${channelId} no encontrado o no es de texto en ${guild.name}`);
        return;
    }

    // Al importar el historial de Plex pueden salir decenas de golpe: lo que no cabe en un mensaje (2.000 caracteres)
    // se resume en "…y N más".
    const lineas = unlocked.map((a) => `🏅 **${a.name}**${a.detalleAnuncio ? ` — ${a.detalleAnuncio}` : ""}`);
    let names = "";
    let caben = 0;
    for (const l of lineas) {
        if (names.length + l.length + 1 > 1700) break;
        names += (names ? "\n" : "") + l;
        caben++;
    }
    if (caben < lineas.length) names += `\n…y ${lineas.length - caben} más`;
    try {
        await channel.send({
            content: `🎉 <@${userId}> desbloqueó logros:\n${names}\nReclámalos en /perfil → 🏅 Logros.`,
            allowedMentions: { users: [String(userId)] },
        });
    } catch (e) {
        log.warn(`No se pudo anunciar logros desbloqueados en #${channel.name}:`, e.message);
    }
}

// Nunca lanza: se llama "de paso" (con void) desde el casino, la tienda, el XP... y un fallo
// aquí no debe romper esa acción ni acabar como promesa rechazada sin capturar.
// `anunciar: false` para quien junta varios eventos y anuncia una vez al final (los logros de Plex).
// `importado: true` si lo que se desbloquee sale de lo antiguo (la primera importación de Plex, ver plexHistorial).
async function applyEvent(guildOrId, userId, event, value = 1, opciones = {}) {
    try {
        return await applyEventsUnsafe(guildOrId, userId, [{ event, value }], opciones);
    } catch (e) {
        log.error(`Error aplicando el evento ${event} (${value}) a ${userId}:`, e);
        return [];
    }
}

/** Varios eventos de golpe ([{ event, value }]), en una transacción y leyendo el catálogo una vez (los de Plex). */
async function applyEvents(guildOrId, userId, eventos, opciones = {}) {
    try {
        return await applyEventsUnsafe(guildOrId, userId, eventos, opciones);
    } catch (e) {
        log.error(`Error aplicando ${eventos?.length} eventos a ${userId}:`, e);
        return [];
    }
}

async function applyEventsUnsafe(guildOrId, userId, eventos, { anunciar = true, importado = false } = {}) {
    const guildId = typeof guildOrId === "string" ? guildOrId : guildOrId?.id;
    const valores = new Map((eventos || []).filter((e) => e?.event).map((e) => [e.event, e.value ?? 1]));
    if (!guildId || !userId || !valores.size) return [];

    const cfg = getLogrosSettings(guildId);
    if (!cfg.enabled) return [];

    const catalog = getCatalog(guildId).filter((a) => valores.has(a.event));
    if (!catalog.length) return [];

    const unlocked = [];
    const tx = db.transaction(() => {
        for (const ach of catalog) {
            const value = valores.get(ach.event);
            const row = db
                .prepare("SELECT progress, completedAt FROM achievements_progress WHERE guildId = ? AND userId = ? AND achievementId = ?")
                .get(guildId, userId, ach.id);

            const current = Number(row?.progress || 0);
            const done = !!row?.completedAt;
            // Un "max" sin cambios no se vuelve a escribir (los de Plex se repasan enteros cada 30 min).
            if (ach.metric === "max" && row && done && Number(value || 0) <= current) continue;
            const next = ach.metric === "max" ? Math.max(current, Number(value || 0)) : current + Number(value || 0);

            let completedAt = row?.completedAt || null;
            const ahora = !done && next >= Number(ach.target || 1);
            if (ahora) {
                completedAt = Date.now();
                unlocked.push(importado ? { ...ach, importado: true } : ach);
            }

            upsertProgress(guildId, userId, ach.id, next, completedAt, ahora && importado);
        }
    });

    tx();

    // Cada logro nuevo da XP de pase de batalla (no los que se desbloquean al importar el historial de Plex).
    const nuevos = unlocked.filter((a) => !a.importado).length;
    if (nuevos) pase.registrarSeguro(guildId, userId, "logro", nuevos);

    if (unlocked.length) {
        log.info(
            `${userId} desbloqueó en ${guildId}: ${unlocked.map((a) => a.id).join(", ")} (eventos ${[...new Set(unlocked.map((a) => a.event))].join(", ")})`,
        );
        if (anunciar) await maybeNotifyUnlocked(guildOrId, userId, unlocked);
    }
    return unlocked;
}

/** Qué % de las monedas da lo desbloqueado en la primera importación de Plex (Panel admin → Plex → 🏆 Trofeos). */
function porcentajeImportacion(guildId) {
    const pct = Number(guildSettings.getSettings(guildId).plex.importacion_pct);
    return Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 100;
}

/** Las monedas que da un logro al reclamarlo: su recompensa por el multiplicador de logros y, si se desbloqueó en la
 * importación de Plex (`ach.importado`), por el % de la importación. */
function rewardCoinsFor(ach, guildId) {
    const cfg = getLogrosSettings(guildId);
    const base = Number(ach?.rewardCoins || 0);
    const importacion = ach?.importado ? porcentajeImportacion(guildId) / 100 : 1;
    return Math.max(0, Math.floor(base * cfg.reward_multiplier * importacion));
}

function claimAchievement(guildId, userId, achievementId) {
    const ach = getById(achievementId, guildId);
    if (!ach) return { ok: false, msg: "Logro no existe." };

    const row = db
        .prepare(
            "SELECT progress, completedAt, claimedAt, importado FROM achievements_progress WHERE guildId = ? AND userId = ? AND achievementId = ?",
        )
        .get(guildId, userId, achievementId);

    if (!row?.completedAt) return { ok: false, msg: "Ese logro todavía no está completado." };
    if (row.claimedAt) return { ok: false, msg: "Ese logro ya fue reclamado." };

    const reward = rewardCoinsFor({ ...ach, importado: Boolean(row.importado) }, guildId);

    const tx = db.transaction(() => {
        if (reward > 0) {
            // Al 💵 efectivo (systems/dinero); crea la cuenta si no la tenía.
            const dinero = require("./dinero");
            dinero.pagar(userId, reward);
            try {
                dinero.apuntar(userId, "logro", `Recompensa logro: ${ach.name}`, reward);
                const impuestos = require("./impuestos");
                const resultado = impuestos.calcularImpuesto(guildId, "logro", reward);
                if (resultado) {
                    dinero.cobrar(userId, resultado.impuesto);
                    dinero.apuntar(userId, "impuesto", `Impuesto sobre ${dinero.TIPOS.logro}`, -resultado.impuesto);
                    if (resultado.destino === "bote") impuestos.sumarBote(guildId, resultado.impuesto);
                }
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
    log.info(`${userId} reclamó ${ach.id} en ${guildId}: +${reward} monedas${row.importado ? " (de la importación de Plex)" : ""}`);
    return { ok: true, reward, achievement: ach, importado: Boolean(row.importado) };
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
    setClient,
    anunciarLogros: maybeNotifyUnlocked,
    categoriaActiva,
    getCatalog,
    listUserAchievements,
    getSummary,
    applyEvent,
    applyEvents,
    claimAchievement,
    rewardCoinsFor,
    porcentajeImportacion,
    claimAll,
    getTopUsers,
};
