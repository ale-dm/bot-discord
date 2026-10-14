// 🏆 Clasificación semanal con premios (F-EC-03): cada lunes, desde las 10:00 (hora de Madrid), se premia con el mismo
// premio (clasificacion.premio, o el propio de cada categoría si lo tiene: #372; al 💵 efectivo) a cuatro personas y se publica
// en el canal de la clasificación:
// - 💰 El más rico: más efectivo + banco ahora mismo (el dinero es global, como en 🏆 Rankings → Riqueza).
// - 💬 El más activo: más XP ganada en el servidor desde la clasificación anterior (clasificacion_xp guarda la XP que
//   tenía cada uno entonces; migración 022).
// - ⚽ El mejor apostador: más beneficio en lo apostado y resuelto la semana anterior, de lunes a domingo (F-AP-03,
//   apuestas/ranking.beneficioEntre); solo si ganó algo.
// - 📆 El más constante (#391): más días distintos con XP en la semana anterior (xp_diaria); en empate, más XP esa semana.
// Una misma persona puede llevarse más de un premio (y cobra la suma). Cada semana se guarda quién ganó (#360). Cron cada hora de los lunes y al arrancar: una vez por semana y
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

const { momentoMadrid: momento, aFecha, diaSemana, semanaAnterior } = require("../core/zonaMadrid");
const historial = require("./clasificacion/historial");

/** Las categorías, en el orden en que salen en el mensaje. */
const CATEGORIAS = [
    { id: "rico", emoji: "💰", nombre: "El más rico" },
    { id: "activo", emoji: "💬", nombre: "El más activo" },
    { id: "apostador", emoji: "⚽", nombre: "El mejor apostador" },
    { id: "constante", emoji: "📆", nombre: "El más constante" },
];

/** El premio de una categoría (#372): el suyo si el admin le puso uno (0 o más) y, si no, el general `clasificacion.premio`. */
function premioDe(cfg, categoria) {
    const propio = Number(cfg[`premio_${categoria}`]);
    return Number.isFinite(propio) && propio >= 0 ? propio : Math.max(0, Number(cfg.premio) || 0);
}

/** La XP ganada desde el último corte de cada persona, la mayor primero: [{ userId, xp }] (#368). */
function ranking(guildId, limite = 10) {
    return db
        .prepare(
            `SELECT u.userId, u.xp_total - COALESCE(c.xp_total, 0) AS xp FROM xp_users u
             LEFT JOIN clasificacion_xp c ON c.guildId = u.guildId AND c.userId = u.userId
             WHERE u.guildId = ? ORDER BY xp DESC, u.userId LIMIT ?`,
        )
        .all(guildId, limite);
}

/** Quién tiene más días con XP entre dos días (AAAA-MM-DD, incluidos): { userId, dias, xp } o undefined (#391). */
function masConstante(guildId, desde, hasta) {
    return db
        .prepare(
            `SELECT userId, COUNT(*) AS dias, SUM(xp) AS xp FROM xp_diaria WHERE guildId = ? AND dia BETWEEN ? AND ? AND xp > 0
             GROUP BY userId ORDER BY dias DESC, xp DESC, userId LIMIT 1`,
        )
        .get(guildId, desde, hasta);
}

/**
 * Quién gana cada premio (o null si nadie): { rico: {userId, total}, activo: {userId, xp}, apostador: {userId, beneficio, resueltas},
 * constante: {userId, dias, xp} }.
 */
function ganadores(guildId, semana) {
    const [rico] = dinero.masRicos(1);
    const [activo] = ranking(guildId, 1);
    const [apostador] = rankingApuestas.beneficioEntre(semana.lunes, semana.domingo);
    const constante = masConstante(guildId, semana.lunes, semana.domingo);
    return {
        rico: rico && rico.total > 0 ? { userId: rico.userId, total: rico.total } : null,
        activo: activo && activo.xp > 0 ? activo : null,
        apostador: apostador && apostador.beneficio > 0 ? apostador : null,
        constante: constante || null,
    };
}

function fechas({ lunes, domingo }) {
    const f = (dia) => `${aFecha(dia).getUTCDate()} de ${MESES[aFecha(dia).getUTCMonth()]}`;
    return `del ${f(lunes)} al ${f(domingo)}`;
}

/** El texto del dato de cada ganador, para el mensaje. */
const DETALLE = {
    rico: (x) => `${fmtNumero(x.total)} 🪙 entre efectivo y banco`,
    activo: (x) => `+${fmtNumero(x.xp)} XP esta semana`,
    apostador: (x) => `+${fmtNumero(x.beneficio)} 🪙 en ${x.resueltas} ${x.resueltas === 1 ? "apuesta" : "apuestas"}`,
    constante: (x) => `${x.dias} ${x.dias === 1 ? "día" : "días"} con XP`,
};

/**
 * El mensaje de la clasificación (con aviso a los premiados). `premios`: un número (el mismo para todas las categorías) o
 * { rico, activo, apostador, constante }; si no son todos iguales, cada línea lleva el suyo.
 */
function mensaje(g, semana, premios) {
    const de = (id) => (typeof premios === "object" ? premios[id] : premios);
    const distintos = new Set(CATEGORIAS.filter((c) => g[c.id]).map((c) => de(c.id))).size > 1;
    const lineas = CATEGORIAS.filter((c) => g[c.id]).map(
        (c) =>
            `${c.emoji} **${c.nombre}**: <@${g[c.id].userId}> (${DETALLE[c.id](g[c.id])})${distintos ? ` · **${fmtNumero(de(c.id))}** 🪙` : ""}`,
    );
    const cabecera = `🏆 **Clasificación semanal** · ${fechas(semana)}`;
    if (!lineas.length) return { content: `${cabecera}\n\nEsta semana no hay a quién premiar. 😴`, allowedMentions: { parse: [] } };
    const premiados = [
        ...new Set(
            CATEGORIAS.map((c) => g[c.id])
                .filter(Boolean)
                .map((x) => String(x.userId)),
        ),
    ];
    const pie = distintos ? "Cada premio, al efectivo." : `Cada premio: **${fmtNumero(de("rico"))}** 🪙 al efectivo.`;
    return { content: `${cabecera}\n\n${lineas.join("\n")}\n\n${pie}`, allowedMentions: { users: premiados } };
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
    const premios = Object.fromEntries(CATEGORIAS.map((c) => [c.id, premioDe(cfg, c.id)]));
    const g = ganadores(guild.id, semana);
    await canal.send(mensaje(g, semana, premios));
    db.transaction(() => {
        for (const c of CATEGORIAS) {
            if (g[c.id] && premios[c.id] > 0) {
                dinero.pagarConImpuesto(
                    g[c.id].userId,
                    guild.id,
                    "premio",
                    `Clasificación semanal: ${c.nombre.toLowerCase()}`,
                    premios[c.id],
                );
            }
        }
        historial.guardar(guild.id, semana.lunes, g);
        db.prepare(
            `INSERT INTO clasificacion_xp (guildId, userId, xp_total) SELECT guildId, userId, xp_total FROM xp_users WHERE guildId = ?
             ON CONFLICT(guildId, userId) DO UPDATE SET xp_total = excluded.xp_total`,
        ).run(guild.id);
        guildSettings.setSetting(guild.id, "clasificacion.ultima_semana", semana.lunes);
    })();
    log.info(
        `Clasificación semanal (${semana.lunes}) en ${guild.name || guild.id}: rico=${g.rico?.userId || "-"} activo=${g.activo?.userId || "-"} ` +
            `apostador=${g.apostador?.userId || "-"} constante=${g.constante?.userId || "-"} · premios ${JSON.stringify(premios)}`,
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

module.exports = {
    HORA,
    CATEGORIAS,
    semanaAnterior,
    premioDe,
    ranking,
    ganadores,
    mensaje,
    publicar,
    publicarSiToca,
};
