// 🏅 Liga de pronósticos por temporada (F-AP-12, #8): cada acierto de una quiniela cerrada suma 1 punto. La temporada va
// de julio a junio, como la liga ("2026-27"). El 1 de julio, desde las 10:00 (hora de Madrid), se publica la clasificación
// final de la temporada anterior en el canal de la clasificación y se pagan al efectivo los tres primeros (liga.premio_1..3).
// Los puntos salen de quiniela_apuestas.aciertos, así que no hay tabla de puntos. Una vez por temporada y servidor
// (liga_temporadas, migración 030). Sin canal no se publica ni se paga, igual que la clasificación semanal.
const db = require("../../core/db");
const dinero = require("../dinero");
const guildSettings = require("../guildSettings");
const { createLogger } = require("../../core/logger");
const { fmtNumero } = require("../../core/formato");

const log = createLogger("Liga");

const HORA = 10;
const PREMIADOS = 3;
const MEDALLAS = ["🥇", "🥈", "🥉"];

const formato = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
});
/** { anio, mes, dia: "AAAA-MM-DD", hora } en hora de Madrid. */
function momento(fecha) {
    const p = Object.fromEntries(formato.formatToParts(new Date(fecha)).map((x) => [x.type, x.value]));
    return { anio: Number(p.year), mes: Number(p.month), dia: `${p.year}-${p.month}-${p.day}`, hora: Number(p.hour) };
}

/** La temporada de un momento: "2026-27" desde el 1 de julio de 2026 hasta el 30 de junio de 2027. */
function temporadaDe(ahora = Date.now()) {
    const { anio, mes } = momento(ahora);
    const inicio = mes >= 7 ? anio : anio - 1;
    return `${inicio}-${String(inicio + 1).slice(-2)}`;
}

const anioDe = (temporada) => Number(temporada.slice(0, 4));
const temporadaAnterior = (temporada) => {
    const y = anioDe(temporada) - 1;
    return `${y}-${String(y + 1).slice(-2)}`;
};

/** Límites (ISO, UTC) de la temporada: de 1 de julio a 1 de julio en hora de Madrid (en verano, +02:00). */
function rangoISO(temporada) {
    return {
        desde: new Date(`${anioDe(temporada)}-07-01T00:00:00+02:00`).toISOString(),
        hasta: new Date(`${anioDe(temporada) + 1}-07-01T00:00:00+02:00`).toISOString(),
    };
}

/** Clasificación de una temporada: [{ userId, puntos, quinielas }], de más a menos puntos. Solo quien ha sumado. */
function clasificacion(temporada, limite = 10) {
    const { desde, hasta } = rangoISO(temporada);
    return db
        .prepare(
            `SELECT a.user_id AS userId, SUM(a.aciertos) AS puntos, COUNT(*) AS quinielas
             FROM quiniela_apuestas a JOIN quinielas q ON q.id = a.quiniela_id
             WHERE q.estado = 'cerrada' AND q.cerrada_en >= ? AND q.cerrada_en < ?
             GROUP BY a.user_id HAVING puntos > 0
             ORDER BY puntos DESC, quinielas ASC, a.user_id ASC LIMIT ?`,
        )
        .all(desde, hasta, limite);
}

/** Premios de la temporada (puesto 1, 2 y 3) en monedas de este servidor. */
function premiosDe(guildId) {
    const cfg = guildSettings.getSettings(guildId).liga;
    return [cfg.premio_1, cfg.premio_2, cfg.premio_3].map((p) => Math.max(0, Number(p) || 0));
}

/** Los campeones de las últimas temporadas liquidadas en el servidor, más recientes primero. */
function campeonesAnteriores(guildId, limite = 3) {
    return db
        .prepare("SELECT temporada, campeones FROM liga_temporadas WHERE guildId = ? ORDER BY temporada DESC LIMIT ?")
        .all(guildId, limite)
        .map((r) => ({ temporada: r.temporada, campeones: JSON.parse(r.campeones) }));
}

/** El mensaje con la clasificación final (con aviso a los premiados). */
function mensaje(temporada, top, premios) {
    const cabecera = `🏅 **Liga de pronósticos ${temporada}** · clasificación final`;
    if (!top.length) return { content: `${cabecera}\n\nNadie sumó puntos esta temporada. 😴`, allowedMentions: { parse: [] } };
    const lineas = top.map(
        (r, i) =>
            `${MEDALLAS[i]} <@${r.userId}> · **${r.puntos}** ${r.puntos === 1 ? "punto" : "puntos"} ` +
            `(${r.quinielas} ${r.quinielas === 1 ? "quiniela" : "quinielas"})`,
    );
    const pagos = top.map((r, i) => `${MEDALLAS[i]} ${fmtNumero(premios[i])} 🪙`).join(" · ");
    return {
        content: `${cabecera}\n\n${lineas.join("\n")}\n\nPremios al efectivo: ${pagos}`,
        allowedMentions: { users: top.map((r) => String(r.userId)) },
    };
}

function yaLiquidada(guildId, temporada) {
    return Boolean(db.prepare("SELECT 1 FROM liga_temporadas WHERE guildId = ? AND temporada = ?").get(guildId, temporada));
}

/**
 * Publica la clasificación de una temporada en el canal, paga los premios y la marca como liquidada.
 * Primero se publica: si el canal falla, no se paga nada y se reintenta en la siguiente pasada.
 * @returns {Promise<{ ok: boolean, motivo?: string, temporada, campeones?: object[] }>}
 */
async function liquidar(guild, temporada) {
    const cfg = guildSettings.getSettings(guild.id).clasificacion;
    if (!cfg.canal) return { ok: false, motivo: "No hay canal para la clasificación.", temporada };
    const canal = guild.channels?.cache?.get(cfg.canal) || (await guild.channels?.fetch?.(cfg.canal).catch(() => null));
    if (!canal?.isTextBased?.()) {
        log.warn(`El canal de la clasificación ${cfg.canal} no existe o no es de texto en ${guild.name || guild.id}`);
        return { ok: false, motivo: `No encuentro el canal <#${cfg.canal}> (o no es de texto).`, temporada };
    }
    const premios = premiosDe(guild.id);
    const top = clasificacion(temporada, PREMIADOS);
    await canal.send(mensaje(temporada, top, premios));
    const campeones = top.map((r, i) => ({ userId: r.userId, puntos: r.puntos, quinielas: r.quinielas, premio: premios[i] }));
    db.transaction(() => {
        top.forEach((r, i) => {
            if (premios[i] > 0)
                dinero.pagarConImpuesto(r.userId, guild.id, "premio", `Liga de pronósticos ${temporada}: puesto ${i + 1}`, premios[i]);
        });
        db.prepare("INSERT INTO liga_temporadas (guildId, temporada, campeones, liquidada_en) VALUES (?, ?, ?, ?)").run(
            guild.id,
            temporada,
            JSON.stringify(campeones),
            Date.now(),
        );
    })();
    log.info(`Liga de pronósticos ${temporada} en ${guild.name || guild.id}: ${campeones.length} premiados`);
    return { ok: true, temporada, campeones };
}

let enCurso = null;

/**
 * Cron (cada hora) y arranque: cuando ya ha empezado la temporada nueva (1 de julio desde las 10:00, Madrid), liquida la
 * anterior en cada servidor que aún no la tenga.
 */
function liquidarSiToca(client, ahora = Date.now()) {
    if (!enCurso) enCurso = liquidarTodos(client, ahora).finally(() => (enCurso = null));
    return enCurso;
}

async function liquidarTodos(client, ahora) {
    const actual = temporadaDe(ahora);
    const { dia, hora } = momento(ahora);
    if (dia === `${anioDe(actual)}-07-01` && hora < HORA) return 0;
    const anterior = temporadaAnterior(actual);
    let liquidadas = 0;
    for (const guild of client.guilds.cache.values()) {
        if (yaLiquidada(guild.id, anterior)) continue;
        try {
            if ((await liquidar(guild, anterior)).ok) liquidadas++;
        } catch (e) {
            log.warn(`No se pudo liquidar la liga ${anterior} en ${guild.name}: ${e.message}`);
        }
    }
    return liquidadas;
}

module.exports = {
    HORA,
    temporadaDe,

    rangoISO,
    clasificacion,
    premiosDe,
    campeonesAnteriores,
    mensaje,
    liquidar,
    liquidarSiToca,
};
