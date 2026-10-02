// 🍿 Ranking semanal de Plex: cada lunes (desde las 10:00, hora de Madrid) se publica en el canal del ranking
// (plex.ranking_canal; la migración 017 pone 874776941000020018) quién ha visto más Plex la semana anterior, de lunes a
// domingo: "🦭 El mayor gordito come foquitos de la semana es @…" y la lista de los 5 primeros. Solo se avisa (mención)
// al primero; los otros cuatro salen con su nombre sin notificación.
// Cuenta el tiempo visto sin pausas de quien tiene la cuenta de Plex vinculada (los demás no se pueden mencionar), con la
// copia del historial (plex_reproducciones): antes de calcular se copia lo último de Tautulli.
// Cron cada hora de los lunes y al arrancar: se publica una vez por semana (plex.ranking_ultima_semana), aunque el bot se
// reinicie.
const db = require("../core/db");
const guildSettings = require("./guildSettings");
const plexLinks = require("./plexLinks");
const plexHistorial = require("./plexHistorial");
const tautulli = require("../services/tautulliClient");
const { createLogger } = require("../core/logger");

const log = createLogger("Plex");

const HORA = 10;
const PUESTOS = 5;
const MEDALLAS = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const DIA_MS = 86400 * 1000;
const aFecha = (dia) => new Date(`${dia}T00:00:00Z`);
const sumarDias = (dia, n) => new Date(aFecha(dia).getTime() + n * DIA_MS).toISOString().slice(0, 10);
/** 1 = lunes … 7 = domingo. */
const diaSemana = (dia) => aFecha(dia).getUTCDay() || 7;

/** La semana anterior completa (lunes y domingo, AAAA-MM-DD, en hora de Madrid) respecto a `ahora` (ms). */
function semanaAnterior(ahora = Date.now()) {
    const { dia } = plexHistorial.momento(Math.floor(ahora / 1000));
    const lunesActual = sumarDias(dia, 1 - diaSemana(dia));
    return { lunes: sumarDias(lunesActual, -7), domingo: sumarDias(lunesActual, -1) };
}

/**
 * Quién ha visto más Plex esa semana, de más a menos (solo los vinculados que han visto algo): tiempo visto sin pausas
 * y cuántos episodios y películas distintos ha terminado.
 * @returns {Array<{ discordUserId, plexUsername, segundos, episodios, peliculas }>}
 */
function ranking(guildId, { lunes, domingo }) {
    const links = plexLinks.getLinks(guildId);
    if (!links.length) return [];
    const porUsuario = new Map(links.map((l) => [String(l.tautulliUserId), { ...l, segundos: 0, eps: new Set(), pelis: new Set() }]));
    // Un día de margen a cada lado (la hora de Madrid no es UTC); luego se filtra por el día en Madrid.
    const desde = aFecha(lunes).getTime() / 1000 - 86400;
    const hasta = aFecha(sumarDias(domingo, 1)).getTime() / 1000 + 86400;
    const filas = db
        .prepare(
            `SELECT tautulliUserId, tipo, rating_key, inicio, segundos, visto FROM plex_reproducciones
             WHERE guildId = ? AND inicio >= ? AND inicio < ? AND tautulliUserId IN (${links.map(() => "?").join(",")})`,
        )
        .all(guildId, desde, hasta, ...porUsuario.keys());
    for (const f of filas) {
        const { dia } = plexHistorial.momento(f.inicio);
        if (dia < lunes || dia > domingo) continue;
        const u = porUsuario.get(String(f.tautulliUserId));
        u.segundos += f.segundos;
        if (f.visto && f.rating_key) (f.tipo === "movie" ? u.pelis : u.eps).add(f.rating_key);
    }
    return [...porUsuario.values()]
        .filter((u) => u.segundos > 0)
        .map((u) => ({
            discordUserId: u.discordUserId,
            plexUsername: u.plexUsername,
            segundos: u.segundos,
            episodios: u.eps.size,
            peliculas: u.pelis.size,
        }))
        .sort((a, b) => b.segundos - a.segundos || String(a.plexUsername).localeCompare(String(b.plexUsername)));
}

function duracion(segundos) {
    const h = Math.floor(segundos / 3600);
    const min = Math.floor((segundos % 3600) / 60);
    if (!h) return `${min} min`;
    return min ? `${h} h ${min} min` : `${h} h`;
}

function fechas({ lunes, domingo }) {
    const f = (dia) => {
        const d = aFecha(dia);
        return `${d.getUTCDate()} de ${MESES[d.getUTCMonth()]}`;
    };
    return `del ${f(lunes)} al ${f(domingo)}`;
}

function vistos({ episodios, peliculas }) {
    const partes = [];
    if (episodios) partes.push(`${episodios} episodio${episodios === 1 ? "" : "s"}`);
    if (peliculas) partes.push(`${peliculas} película${peliculas === 1 ? "" : "s"}`);
    return partes.length ? ` · ${partes.join(" y ")}` : "";
}

/** El mensaje del ranking: el primero, mencionado (solo a él le llega el aviso), y la lista de los 5 primeros. */
function mensaje(lista, semana) {
    const cabecera = `🍿 **Ranking semanal de Plex** · ${fechas(semana)}`;
    if (!lista.length) {
        return { content: `${cabecera}\n\nEsta semana nadie ha visto nada en Plex. 😴`, allowedMentions: { parse: [] } };
    }
    const [primero] = lista;
    const puestos = lista
        .slice(0, PUESTOS)
        .map((u, i) => `${MEDALLAS[i]} <@${u.discordUserId}> — **${duracion(u.segundos)}**${vistos(u)}`)
        .join("\n");
    return {
        content:
            `${cabecera}\n\n🦭 El mayor gordito come foquitos de la semana es <@${primero.discordUserId}> con **${duracion(primero.segundos)}** de Plex.\n\n` +
            puestos,
        allowedMentions: { users: [String(primero.discordUserId)] },
    };
}

/**
 * Publica el ranking de una semana (por defecto, la anterior) en el canal del ranking y la apunta como publicada.
 * @returns {Promise<{ ok: boolean, motivo?: string, lista?: Array, semana }>}
 */
async function publicar(guild, { semana = semanaAnterior() } = {}) {
    const canalId = guildSettings.getSettings(guild.id).plex.ranking_canal;
    if (!canalId) return { ok: false, motivo: "No hay canal para el ranking semanal.", semana };
    const channel = guild.channels?.cache?.get(canalId) || (await guild.channels?.fetch?.(canalId).catch(() => null));
    if (!channel || !channel.isTextBased?.()) {
        log.warn(`Ranking semanal de Plex: el canal ${canalId} no existe o no es de texto en ${guild.name || guild.id}`);
        return { ok: false, motivo: `No encuentro el canal <#${canalId}> (o no es de texto).`, semana };
    }
    const lista = ranking(guild.id, semana);
    await channel.send(mensaje(lista, semana));
    guildSettings.setSetting(guild.id, "plex.ranking_ultima_semana", semana.lunes);
    log.info(
        `Ranking semanal de Plex (${semana.lunes}) publicado en #${channel.name} de ${guild.name || guild.id}: ` +
            (lista.length ? lista.map((u) => `${u.plexUsername} ${duracion(u.segundos)}`).join(", ") : "nadie vio nada"),
    );
    return { ok: true, lista, semana };
}

let enCurso = null;

/**
 * Cron (cada hora de los lunes) y arranque: si es lunes desde las 10:00 (Madrid) y en un servidor no se ha publicado
 * todavía el de la semana anterior, copia lo último del historial y lo publica. Nunca dos a la vez.
 */
function enviarSiToca(client, ahora = Date.now()) {
    if (!enCurso) enCurso = enviar(client, ahora).finally(() => (enCurso = null));
    return enCurso;
}

async function enviar(client, ahora) {
    const { dia, hora } = plexHistorial.momento(Math.floor(ahora / 1000));
    if (diaSemana(dia) !== 1 || hora < HORA) return;
    const semana = semanaAnterior(ahora);
    for (const guild of client.guilds.cache.values()) {
        const cfg = guildSettings.getSettings(guild.id).plex;
        if (!cfg.ranking_canal || cfg.ranking_ultima_semana === semana.lunes || !plexLinks.getLinks(guild.id).length) continue;
        const { url, apiKey } = tautulli.getConfig(guild.id);
        if (url && apiKey) {
            try {
                await plexHistorial.sincronizar(guild.id);
            } catch (e) {
                log.warn(
                    `Ranking semanal de Plex: no se pudo copiar lo último del historial de ${guild.name} (se usa lo que hay): ${e.message}`,
                );
            }
        }
        try {
            await publicar(guild, { semana });
        } catch (e) {
            log.warn(`No se pudo publicar el ranking semanal de Plex en ${guild.name}: ${e.message}`);
        }
    }
}

module.exports = { HORA, semanaAnterior, ranking, mensaje, duracion, publicar, enviarSiToca };
