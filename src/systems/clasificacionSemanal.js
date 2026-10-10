// 🏆 Clasificación semanal con premios (F-EC-03): cada lunes, desde las 10:00 (hora de Madrid), se premia con el mismo
// premio (clasificacion.premio, al 💵 efectivo) a tres personas y se publica en el canal de la clasificación:
// - 💰 El más rico: más efectivo + banco ahora mismo (el dinero es global, como en 🏆 Rankings → Riqueza).
// - 💬 El más activo: más XP ganada en el servidor desde la clasificación anterior (clasificacion_xp guarda la XP que
//   tenía cada uno entonces; migración 022).
// - ⚽ El mejor apostador: más beneficio en lo apostado y resuelto la semana anterior, de lunes a domingo (F-AP-03,
//   apuestas/ranking.beneficioEntre); solo si ganó algo.
// Una misma persona puede llevarse más de un premio. Cron cada hora de los lunes y al arrancar: una vez por semana y
// servidor (clasificacion.ultima_semana), aunque el bot se reinicie. Sin canal elegido no se publica ni se paga nada.
// Se configura en /paneladmin → ⚙️ Config Global → 🏆 Semanal.
const db = require("../core/db");
const dinero = require("./dinero");
const guildSettings = require("./guildSettings");
const rankingApuestas = require("./apuestas/ranking");
const { createLogger } = require("../core/logger");
const { fmtNumero } = require("../core/formato");

const log = createLogger("Clasificación");

const HORA = 10;
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const { momentoMadrid: momento } = require("../core/zonaMadrid");
const aFecha = (dia) => new Date(`${dia}T00:00:00Z`);
const sumarDias = (dia, n) => new Date(aFecha(dia).getTime() + n * 86400 * 1000).toISOString().slice(0, 10);
/** 1 = lunes … 7 = domingo. */
const diaSemana = (dia) => aFecha(dia).getUTCDay() || 7;

/** La semana anterior completa (lunes y domingo, AAAA-MM-DD, en hora de Madrid) respecto a `ahora`. */
function semanaAnterior(ahora = Date.now()) {
    const { dia } = momento(ahora);
    const lunesActual = sumarDias(dia, 1 - diaSemana(dia));
    return { lunes: sumarDias(lunesActual, -7), domingo: sumarDias(lunesActual, -1) };
}

/** Quién gana cada premio (o null si nadie): { rico: {userId, total}, activo: {userId, xp}, apostador: {userId, beneficio, resueltas} }. */
function ganadores(guildId, semana) {
    const [rico] = dinero.masRicos(1);
    const activo = db
        .prepare(
            `SELECT u.userId, u.xp_total - COALESCE(c.xp_total, 0) AS xp FROM xp_users u
             LEFT JOIN clasificacion_xp c ON c.guildId = u.guildId AND c.userId = u.userId
             WHERE u.guildId = ? ORDER BY xp DESC, u.userId LIMIT 1`,
        )
        .get(guildId);
    const [apostador] = rankingApuestas.beneficioEntre(semana.lunes, semana.domingo);
    return {
        rico: rico && rico.total > 0 ? { userId: rico.userId, total: rico.total } : null,
        activo: activo && activo.xp > 0 ? activo : null,
        apostador: apostador && apostador.beneficio > 0 ? apostador : null,
    };
}

function fechas({ lunes, domingo }) {
    const f = (dia) => `${aFecha(dia).getUTCDate()} de ${MESES[aFecha(dia).getUTCMonth()]}`;
    return `del ${f(lunes)} al ${f(domingo)}`;
}

/** El mensaje de la clasificación (con aviso a los premiados). */
function mensaje(g, semana, premio) {
    const lineas = [];
    if (g.rico) lineas.push(`💰 **El más rico**: <@${g.rico.userId}> (${fmtNumero(g.rico.total)} 🪙 entre efectivo y banco)`);
    if (g.activo) lineas.push(`💬 **El más activo**: <@${g.activo.userId}> (+${fmtNumero(g.activo.xp)} XP esta semana)`);
    if (g.apostador) {
        const n = g.apostador.resueltas;
        lineas.push(
            `⚽ **El mejor apostador**: <@${g.apostador.userId}> (+${fmtNumero(g.apostador.beneficio)} 🪙 en ${n} ${n === 1 ? "apuesta" : "apuestas"})`,
        );
    }
    const cabecera = `🏆 **Clasificación semanal** · ${fechas(semana)}`;
    if (!lineas.length) return { content: `${cabecera}\n\nEsta semana no hay a quién premiar. 😴`, allowedMentions: { parse: [] } };
    const premiados = [...new Set([g.rico, g.activo, g.apostador].filter(Boolean).map((x) => String(x.userId)))];
    return {
        content: `${cabecera}\n\n${lineas.join("\n")}\n\nCada premio: **${fmtNumero(premio)}** 🪙 al efectivo.`,
        allowedMentions: { users: premiados },
    };
}

/**
 * Publica la clasificación de una semana en su canal, paga los premios y guarda la XP de ahora para la siguiente.
 * Primero se publica: si el canal falla, no se paga nada (se reintenta a la hora siguiente).
 * @returns {Promise<{ ok: boolean, motivo?: string, ganadores?: object, semana }>}
 */
async function publicar(guild, { semana = semanaAnterior() } = {}) {
    const cfg = guildSettings.getSettings(guild.id).clasificacion;
    if (!cfg.canal) return { ok: false, motivo: "No hay canal para la clasificación semanal.", semana };
    const canal = guild.channels?.cache?.get(cfg.canal) || (await guild.channels?.fetch?.(cfg.canal).catch(() => null));
    if (!canal?.isTextBased?.()) {
        log.warn(`El canal de la clasificación semanal ${cfg.canal} no existe o no es de texto en ${guild.name || guild.id}`);
        return { ok: false, motivo: `No encuentro el canal <#${cfg.canal}> (o no es de texto).`, semana };
    }
    const premio = Math.max(0, Number(cfg.premio) || 0);
    const g = ganadores(guild.id, semana);
    await canal.send(mensaje(g, semana, premio));
    db.transaction(() => {
        const premios = [
            [g.rico, "el más rico"],
            [g.activo, "el más activo"],
            [g.apostador, "el mejor apostador"],
        ];
        for (const [ganador, que] of premios) {
            if (ganador && premio > 0) dinero.pagarConImpuesto(ganador.userId, guild.id, "premio", `Clasificación semanal: ${que}`, premio);
        }
        db.prepare(
            `INSERT INTO clasificacion_xp (guildId, userId, xp_total) SELECT guildId, userId, xp_total FROM xp_users WHERE guildId = ?
             ON CONFLICT(guildId, userId) DO UPDATE SET xp_total = excluded.xp_total`,
        ).run(guild.id);
        guildSettings.setSetting(guild.id, "clasificacion.ultima_semana", semana.lunes);
    })();
    log.info(
        `Clasificación semanal (${semana.lunes}) en ${guild.name || guild.id}: rico=${g.rico?.userId || "-"} activo=${g.activo?.userId || "-"} ` +
            `apostador=${g.apostador?.userId || "-"} · premio ${premio}`,
    );
    return { ok: true, ganadores: g, semana };
}

let enCurso = null;

/** Cron (cada hora de los lunes) y arranque: si es lunes desde las 10:00 (Madrid) y en un servidor no se ha publicado la de esta semana. */
function publicarSiToca(client, ahora = Date.now()) {
    if (!enCurso) enCurso = publicarTodos(client, ahora).finally(() => (enCurso = null));
    return enCurso;
}

async function publicarTodos(client, ahora) {
    const { dia, hora } = momento(ahora);
    if (diaSemana(dia) !== 1 || hora < HORA) return 0;
    const semana = semanaAnterior(ahora);
    let publicadas = 0;
    for (const guild of client.guilds.cache.values()) {
        const cfg = guildSettings.getSettings(guild.id).clasificacion;
        if (!cfg.canal || cfg.ultima_semana === semana.lunes) continue;
        try {
            if ((await publicar(guild, { semana })).ok) publicadas++;
        } catch (e) {
            log.warn(`No se pudo publicar la clasificación semanal en ${guild.name}: ${e.message}`);
        }
    }
    return publicadas;
}

module.exports = { HORA, semanaAnterior, ganadores, mensaje, publicar, publicarSiToca };
