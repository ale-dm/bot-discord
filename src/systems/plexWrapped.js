// 🎞️ Plex Wrapped mensual (#23): el día 1 de cada mes, desde las 10:00 (hora de Madrid), cada persona con la cuenta de Plex
// vinculada recibe por DM su propio resumen del mes anterior: sus horas vistas, sus películas y episodios, y sus series más
// vistas. Es privado: no se publica nada en ningún canal ni se muestran datos de otras personas. Usa la copia local del
// historial (plex_reproducciones), como el ranking semanal. Una vez por mes y persona (plex_wrapped_enviados).
const { AttachmentBuilder } = require("discord.js");
const db = require("../core/db");
const plexLinks = require("./plexLinks");
const plexHistorial = require("./plexHistorial");
const tautulli = require("../services/tautulliClient");
const { renderPng, FONDO, TEXTO, TEXTO_SUAVE, REJILLA } = require("./cripto/graficos");
const { createLogger } = require("../core/logger");

const log = createLogger("PlexWrapped");
const HORA = 10;
const TOP_SERIES = 5;
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIA_MS = 86400 * 1000;
const aFecha = (dia) => new Date(`${dia}T00:00:00Z`);
const sumarDias = (dia, n) => new Date(aFecha(dia).getTime() + n * DIA_MS).toISOString().slice(0, 10);
const horas = (segundos) => Math.round((segundos / 3600) * 10) / 10;
const fmtH = (n) => `${String(n.toFixed(1)).replace(".", ",")} h`;

/** El mes anterior al de `ahora` (hora de Madrid): { mes: "2026-09", inicio, fin, etiqueta }. */
function mesAnterior(ahora = Date.now()) {
    const { dia } = plexHistorial.momento(Math.floor(ahora / 1000));
    const [y, m] = dia.split("-").map(Number);
    const py = m === 1 ? y - 1 : y;
    const pm = m === 1 ? 12 : m - 1;
    const mes = `${py}-${String(pm).padStart(2, "0")}`;
    return {
        mes,
        inicio: `${mes}-01`,
        fin: new Date(Date.UTC(py, pm, 0)).toISOString().slice(0, 10),
        etiqueta: `${MESES[pm - 1]} de ${py}`,
    };
}

/**
 * Lo que ha visto UNA persona (su cuenta de Plex) en el mes: horas, películas y episodios distintos, y sus series más vistas.
 * Solo sus datos: nada de otras personas.
 */
function resumenPersonal(guildId, tautulliUserId, mes) {
    const desde = aFecha(mes.inicio).getTime() / 1000 - 86400;
    const hasta = aFecha(sumarDias(mes.fin, 1)).getTime() / 1000 + 86400;
    const filas = db
        .prepare(
            `SELECT tipo, rating_key, serie, titulo, inicio, segundos, visto FROM plex_reproducciones
             WHERE guildId = ? AND tautulliUserId = ? AND inicio >= ? AND inicio < ?`,
        )
        .all(String(guildId), String(tautulliUserId), desde, hasta);
    let segundos = 0;
    const pelis = new Set();
    const eps = new Set();
    const series = new Map();
    for (const f of filas) {
        const { dia } = plexHistorial.momento(f.inicio);
        if (dia < mes.inicio || dia > mes.fin) continue;
        segundos += f.segundos;
        if (f.visto && f.rating_key) (f.tipo === "movie" ? pelis : eps).add(f.rating_key);
        if (f.tipo === "episode") {
            const nombre = f.serie || f.titulo;
            if (nombre) series.set(nombre, (series.get(nombre) || 0) + f.segundos);
        }
    }
    return {
        mes: mes.mes,
        etiqueta: mes.etiqueta,
        horas: horas(segundos),
        peliculas: pelis.size,
        episodios: eps.size,
        series: [...series.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, TOP_SERIES)
            .map(([nombre, s]) => ({ nombre, horas: horas(s) })),
    };
}

/** El texto del resumen de una persona (para el DM y para el botón de /plex). */
function mensajePersonal(r) {
    if (r.horas <= 0) return `🎞️ **Tu Plex Wrapped · ${r.etiqueta}**\n\nEste mes no has visto nada en Plex. 😴`;
    const lineas = [
        `🎞️ **Tu Plex Wrapped · ${r.etiqueta}**`,
        "",
        `Has visto **${fmtH(r.horas)}** de Plex (${r.peliculas} ${r.peliculas === 1 ? "película" : "películas"} y ${r.episodios} ${r.episodios === 1 ? "episodio" : "episodios"}).`,
    ];
    if (r.series.length) lineas.push(`📺 Tus series: ${r.series.map((s, i) => `${i + 1}. ${s.nombre} (${fmtH(s.horas)})`).join(" · ")}`);
    return lineas.join("\n");
}

/** La gráfica de tus series del mes (PNG), o null si no has visto series. */
function graficoPersonal(r) {
    if (!r.series.length) return null;
    const orden = [...r.series].reverse();
    return renderPng(
        {
            title: {
                text: `Tu Plex Wrapped · ${r.etiqueta}`,
                subtext: `${fmtH(r.horas)} vistas en total`,
                left: 40,
                top: 22,
                textStyle: { color: TEXTO, fontSize: 22, fontWeight: "bold" },
                subtextStyle: { color: TEXTO_SUAVE, fontSize: 15 },
            },
            grid: { left: 200, right: 90, top: 100, bottom: 40 },
            xAxis: { type: "value", axisLabel: { color: TEXTO_SUAVE, fontSize: 12 }, splitLine: { lineStyle: { color: REJILLA } } },
            yAxis: {
                type: "category",
                data: orden.map((s) => s.nombre),
                axisLabel: { color: TEXTO, fontSize: 14 },
                axisTick: { show: false },
            },
            series: [
                {
                    type: "bar",
                    data: orden.map((s) => s.horas),
                    itemStyle: { color: "#e5a00d", borderRadius: [0, 6, 6, 0] },
                    label: { show: true, position: "right", color: TEXTO, fontSize: 13, formatter: (x) => fmtH(x.value) },
                },
            ],
            backgroundColor: FONDO,
        },
        900,
        Math.max(260, 110 + orden.length * 56),
    );
}

const yaEnviado = (guildId, tautulliUserId, mes) =>
    Boolean(
        db
            .prepare("SELECT 1 FROM plex_wrapped_enviados WHERE guildId = ? AND tautulliUserId = ? AND mes = ?")
            .get(String(guildId), String(tautulliUserId), mes),
    );

/** Manda por DM el resumen de cada persona vinculada que ha visto algo ese mes y aún no lo tiene. Un DM fallido no para a los demás. */
async function enviarPorDm(client, guild, mes) {
    let enviados = 0;
    for (const link of plexLinks.getLinks(guild.id)) {
        if (yaEnviado(guild.id, link.tautulliUserId, mes.mes)) continue;
        const r = resumenPersonal(guild.id, link.tautulliUserId, mes);
        if (r.horas <= 0) continue;
        try {
            const usuario = await client.users.fetch(link.discordUserId);
            const buf = graficoPersonal(r);
            const files = buf ? [new AttachmentBuilder(buf, { name: "wrapped.png" })] : [];
            await usuario.send({ content: mensajePersonal(r), files, allowedMentions: { parse: [] } });
            db.prepare("INSERT INTO plex_wrapped_enviados (guildId, tautulliUserId, mes, enviado_en) VALUES (?, ?, ?, ?)").run(
                String(guild.id),
                String(link.tautulliUserId),
                mes.mes,
                Date.now(),
            );
            enviados++;
        } catch (e) {
            log.debug(`No se pudo mandar el Plex Wrapped a ${link.plexUsername} (DMs cerrados o error): ${e.message}`);
        }
    }
    return enviados;
}

let enCurso = null;

/** Cron (cada hora) y arranque: el día 1 desde las 10:00 (Madrid), manda el resumen del mes anterior a cada persona. */
function enviarSiToca(client, ahora = Date.now()) {
    if (!enCurso) enCurso = enviar(client, ahora).finally(() => (enCurso = null));
    return enCurso;
}

async function enviar(client, ahora) {
    const { dia, hora } = plexHistorial.momento(Math.floor(ahora / 1000));
    if (!dia.endsWith("-01") || hora < HORA) return 0;
    const mes = mesAnterior(ahora);
    let enviados = 0;
    for (const guild of client.guilds.cache.values()) {
        if (!plexLinks.getLinks(guild.id).length) continue;
        const { url, apiKey } = tautulli.getConfig(guild.id);
        if (url && apiKey) {
            try {
                await plexHistorial.sincronizar(guild.id);
            } catch (e) {
                log.warn(`Plex Wrapped: no se pudo copiar lo último del historial de ${guild.name} (se usa lo que hay): ${e.message}`);
            }
        }
        try {
            enviados += await enviarPorDm(client, guild, mes);
        } catch (e) {
            log.warn(`No se pudo mandar el Plex Wrapped en ${guild.name}: ${e.message}`);
        }
    }
    log.info(`Plex Wrapped ${mes.mes}: ${enviados} resúmenes enviados por DM`);
    return enviados;
}

module.exports = { HORA, mesAnterior, resumenPersonal, mensajePersonal, graficoPersonal, enviarPorDm, enviarSiToca };
