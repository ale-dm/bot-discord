// 🎂 Cumpleaños (#427): el día y el mes (sin año) de cada persona en cada servidor, la felicitación automática en el canal
// configurado (avisos.cumple_channel_id) el día de su cumpleaños, y los próximos cumpleaños. El día de calendario es el de Madrid
// (core/zonaMadrid). Quien nace un 29 de febrero se felicita el 28 los años que no son bisiestos.
const db = require("../core/db");
const { createLogger } = require("../core/logger");
const { momentoMadrid } = require("../core/zonaMadrid");

const log = createLogger("Cumpleaños");

/** A partir de esta hora (Madrid) se publican las felicitaciones del día. */
const HORA_FELICITACION = 9;
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIAS_DEL_MES = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const esBisiesto = (anio) => (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0;

/** ¿Existe ese día y mes? El 29 de febrero vale (no se guarda el año). */
function fechaValida(dia, mes) {
    return Number.isInteger(dia) && Number.isInteger(mes) && mes >= 1 && mes <= 12 && dia >= 1 && dia <= DIAS_DEL_MES[mes - 1];
}

/** El día y mes en que se celebra en `anio`: el 29 de febrero pasa al 28 si el año no es bisiesto. */
function celebracion(dia, mes, anio) {
    return dia === 29 && mes === 2 && !esBisiesto(anio) ? { dia: 28, mes: 2 } : { dia, mes };
}

/** «14 de octubre». */
const textoFecha = (dia, mes) => `${dia} de ${MESES[mes - 1]}`;

/** Guarda (o cambia) el cumpleaños de alguien en un servidor. @returns {{ ok: true } | { ok: false, mensaje: string }} */
function guardar(userId, guildId, dia, mes) {
    if (!fechaValida(dia, mes)) return { ok: false, mensaje: `❌ El ${dia} del ${mes} no es una fecha que exista.` };
    db.prepare(
        "INSERT INTO cumpleanos (userId, guildId, dia, mes) VALUES (?, ?, ?, ?) ON CONFLICT(userId, guildId) DO UPDATE SET dia = excluded.dia, mes = excluded.mes",
    ).run(String(userId), String(guildId), dia, mes);
    return { ok: true };
}

/** Borra el cumpleaños propio. @returns {boolean} si había uno */
function borrar(userId, guildId) {
    return db.prepare("DELETE FROM cumpleanos WHERE userId = ? AND guildId = ?").run(String(userId), String(guildId)).changes === 1;
}

/** El cumpleaños guardado de alguien, o null. */
function de(userId, guildId) {
    return db.prepare("SELECT dia, mes FROM cumpleanos WHERE userId = ? AND guildId = ?").get(String(userId), String(guildId)) || null;
}

/** El día del mes de un momento de Madrid (su `dia` es «AAAA-MM-DD»; también vale un número). */
const diaDelMes = (hoy) => (typeof hoy.dia === "string" ? Number(hoy.dia.slice(8, 10)) : hoy.dia);

/** Días que faltan desde `hoy` (un momento de Madrid, o { anio, mes, dia }) hasta el próximo cumpleaños (0 si es hoy). */
function diasHasta(dia, mes, hoy) {
    const inicio = Date.UTC(hoy.anio, hoy.mes - 1, diaDelMes(hoy));
    for (const anio of [hoy.anio, hoy.anio + 1]) {
        const c = celebracion(dia, mes, anio);
        const diferencia = Math.round((Date.UTC(anio, c.mes - 1, c.dia) - inicio) / 86400000);
        if (diferencia >= 0) return diferencia;
    }
    return 0;
}

/** Los próximos `n` cumpleaños del servidor (el de hoy incluido), del más cercano al más lejano. */
function proximos(guildId, hoy = momentoMadrid(Date.now()), n = 5) {
    return db
        .prepare("SELECT userId, dia, mes FROM cumpleanos WHERE guildId = ?")
        .all(String(guildId))
        .map((f) => ({ ...f, enDias: diasHasta(f.dia, f.mes, hoy) }))
        .sort((a, b) => a.enDias - b.enDias || a.userId.localeCompare(b.userId))
        .slice(0, n);
}

/** Quién cumple años hoy en el servidor y aún no se ha felicitado este año. */
function felicitables(guildId, hoy = momentoMadrid(Date.now())) {
    return db
        .prepare("SELECT userId, dia, mes FROM cumpleanos WHERE guildId = ?")
        .all(String(guildId))
        .filter((f) => {
            const c = celebracion(f.dia, f.mes, hoy.anio);
            return c.dia === diaDelMes(hoy) && c.mes === hoy.mes;
        })
        .filter(
            (f) =>
                !db
                    .prepare("SELECT 1 FROM cumpleanos_felicitados WHERE userId = ? AND guildId = ? AND anio = ?")
                    .get(f.userId, String(guildId), hoy.anio),
        )
        .map((f) => f.userId);
}

/**
 * Cron (cada hora y al arrancar): desde las 09:00 de Madrid, publica en el canal de avisos una felicitación con mención por
 * cada cumpleaños de hoy, una sola vez. Sin canal configurado no hace nada (y sin marcarlo: si se configura ese mismo día,
 * se felicita). Si el canal no existe o el bot no puede escribir, queda en el log y se reintenta en la siguiente pasada.
 * @returns {Promise<number>} felicitaciones publicadas
 */
async function felicitarSiToca(client, ahora = Date.now()) {
    const hoy = momentoMadrid(ahora);
    if (hoy.hora < HORA_FELICITACION) return 0;
    const guildSettings = require("./guildSettings");
    let publicadas = 0;
    for (const guild of client.guilds.cache.values()) {
        const canalId = guildSettings.getSettings(guild.id).avisos.cumple_channel_id;
        if (!canalId) continue;
        const pendientes = felicitables(guild.id, hoy);
        if (!pendientes.length) continue;
        let canal;
        try {
            canal = guild.channels.cache.get(canalId) || (await guild.channels.fetch(canalId));
        } catch (e) {
            log.warn(`No se pudo felicitar en ${guild.name}: el canal ${canalId} no existe o no es visible (${e.message})`);
            continue;
        }
        for (const userId of pendientes) {
            try {
                await canal.send({
                    content: `🎂 ¡Feliz cumpleaños, <@${userId}>! 🎉 Que lo pases genial.`,
                    allowedMentions: { users: [userId] },
                });
                db.prepare("INSERT OR IGNORE INTO cumpleanos_felicitados (userId, guildId, anio) VALUES (?, ?, ?)").run(
                    userId,
                    guild.id,
                    hoy.anio,
                );
                publicadas++;
            } catch (e) {
                log.warn(`No se pudo felicitar a ${userId} en ${guild.name}: ${e.message}`);
            }
        }
    }
    if (publicadas) log.info(`Cumpleaños: ${publicadas} felicitaciones publicadas`);
    return publicadas;
}

module.exports = {
    HORA_FELICITACION,
    fechaValida,
    celebracion,
    textoFecha,
    guardar,
    borrar,
    de,
    diasHasta,
    proximos,
    felicitables,
    felicitarSiToca,
};
