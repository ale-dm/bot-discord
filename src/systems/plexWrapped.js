// 🎞️ Plex Wrapped mensual (#23): el día 1 de cada mes, desde las 10:00 (hora de Madrid), se publica en el canal del ranking
// de Plex el resumen del mes anterior: las horas vistas en total y por cada persona (con su gráfica), las series más
// vistas y quién es el más viciado. Usa la copia local del historial (plex_reproducciones), como el ranking semanal, y
// solo cuenta a quien tiene la cuenta de Plex vinculada. Una vez por mes y servidor (plex.wrapped_ultimo_mes).
const { AttachmentBuilder } = require("discord.js");
const db = require("../core/db");
const guildSettings = require("./guildSettings");
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
 * Lo que ha visto cada persona vinculada en el mes: horas, películas y episodios distintos, y las series más vistas
 * entre todos. `masViciado` es la persona con más horas (null si nadie ha visto nada).
 */
function datos(guildId, mes) {
    const links = plexLinks.getLinks(guildId);
    const base = { mes: mes.mes, etiqueta: mes.etiqueta, horas: 0, personas: [], masViciado: null, series: [], peliculas: 0, episodios: 0 };
    if (!links.length) return base;
    const porUsuario = new Map(links.map((l) => [String(l.tautulliUserId), { ...l, segundos: 0, eps: new Set(), pelis: new Set() }]));
    const series = new Map();
    // Un día de margen a cada lado (la hora de Madrid no es UTC); luego se filtra por el día en Madrid.
    const desde = aFecha(mes.inicio).getTime() / 1000 - 86400;
    const hasta = aFecha(sumarDias(mes.fin, 1)).getTime() / 1000 + 86400;
    const filas = db
        .prepare(
            `SELECT tautulliUserId, tipo, rating_key, serie, titulo, inicio, segundos, visto FROM plex_reproducciones
             WHERE guildId = ? AND inicio >= ? AND inicio < ? AND tautulliUserId IN (${links.map(() => "?").join(",")})`,
        )
        .all(guildId, desde, hasta, ...porUsuario.keys());
    for (const f of filas) {
        const { dia } = plexHistorial.momento(f.inicio);
        if (dia < mes.inicio || dia > mes.fin) continue;
        const u = porUsuario.get(String(f.tautulliUserId));
        u.segundos += f.segundos;
        if (f.visto && f.rating_key) (f.tipo === "movie" ? u.pelis : u.eps).add(f.rating_key);
        if (f.tipo === "episode") {
            const nombre = f.serie || f.titulo;
            if (nombre) series.set(nombre, (series.get(nombre) || 0) + f.segundos);
        }
    }
    const personas = [...porUsuario.values()]
        .filter((u) => u.segundos > 0)
        .map((u) => ({
            discordUserId: u.discordUserId,
            plexUsername: u.plexUsername,
            horas: horas(u.segundos),
            episodios: u.eps.size,
            peliculas: u.pelis.size,
        }))
        .sort((a, b) => b.horas - a.horas || String(a.plexUsername).localeCompare(String(b.plexUsername)));
    if (!personas.length) return base;
    return {
        ...base,
        horas: horas(personas.reduce((t, p) => t + p.horas * 3600, 0)),
        personas,
        masViciado: personas[0],
        series: [...series.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, TOP_SERIES)
            .map(([nombre, segundos]) => ({ nombre, horas: horas(segundos) })),
        peliculas: personas.reduce((t, p) => t + p.peliculas, 0),
        episodios: personas.reduce((t, p) => t + p.episodios, 0),
    };
}

function mensaje(d) {
    if (!d.personas.length)
        return { content: `🎞️ **Plex Wrapped · ${d.etiqueta}**\n\nEste mes nadie ha visto Plex. 😴`, allowedMentions: { parse: [] } };
    const lineas = [
        `🎞️ **Plex Wrapped · ${d.etiqueta}**`,
        "",
        `Entre todos: **${fmtH(d.horas)}** vistas (${d.peliculas} ${d.peliculas === 1 ? "película" : "películas"} y ${d.episodios} ${d.episodios === 1 ? "episodio" : "episodios"}).`,
        `🦭 El más viciado: <@${d.masViciado.discordUserId}> con **${fmtH(d.masViciado.horas)}**.`,
    ];
    if (d.series.length)
        lineas.push(`📺 Series más vistas: ${d.series.map((s, i) => `${i + 1}. ${s.nombre} (${fmtH(s.horas)})`).join(" · ")}`);
    return { content: lineas.join("\n"), allowedMentions: { users: [d.masViciado.discordUserId] } };
}

/** La gráfica de horas por persona del mes (PNG), o null si nadie ha visto nada. */
function grafico(d) {
    if (!d.personas.length) return null;
    const orden = [...d.personas].reverse();
    const alto = Math.max(260, 110 + orden.length * 56);
    return renderPng(
        {
            title: {
                text: `Plex Wrapped · ${d.etiqueta}`,
                subtext: `${fmtH(d.horas)} vistas en total`,
                left: 40,
                top: 22,
                textStyle: { color: TEXTO, fontSize: 22, fontWeight: "bold" },
                subtextStyle: { color: TEXTO_SUAVE, fontSize: 15 },
            },
            grid: { left: 170, right: 90, top: 100, bottom: 40 },
            xAxis: { type: "value", axisLabel: { color: TEXTO_SUAVE, fontSize: 12 }, splitLine: { lineStyle: { color: REJILLA } } },
            yAxis: {
                type: "category",
                data: orden.map((p) => p.plexUsername),
                axisLabel: { color: TEXTO, fontSize: 15 },
                axisTick: { show: false },
            },
            series: [
                {
                    type: "bar",
                    data: orden.map((p) => p.horas),
                    itemStyle: { color: "#e5a00d", borderRadius: [0, 6, 6, 0] },
                    label: { show: true, position: "right", color: TEXTO, fontSize: 13, formatter: (x) => fmtH(x.value) },
                },
            ],
            backgroundColor: FONDO,
        },
        900,
        alto,
    );
}

/** Publica el resumen de un mes en el canal del ranking de Plex y lo marca como publicado. */
async function publicar(guild, mes = mesAnterior()) {
    const canalId = guildSettings.getSettings(guild.id).plex.ranking_canal;
    if (!canalId) return { ok: false, motivo: "No hay canal para el ranking de Plex." };
    const canal = guild.channels?.cache?.get(canalId) || (await guild.channels?.fetch?.(canalId).catch(() => null));
    if (!canal?.isTextBased?.()) {
        log.warn(`Plex Wrapped: el canal ${canalId} no existe o no es de texto en ${guild.name || guild.id}`);
        return { ok: false, motivo: `No encuentro el canal <#${canalId}> (o no es de texto).` };
    }
    const d = datos(guild.id, mes);
    const buf = grafico(d);
    const files = buf ? [new AttachmentBuilder(buf, { name: "wrapped.png" })] : [];
    await canal.send({ ...mensaje(d), files });
    guildSettings.setSetting(guild.id, "plex.wrapped_ultimo_mes", mes.mes);
    log.info(`Plex Wrapped ${mes.mes} publicado en ${guild.name || guild.id}: ${d.personas.length} personas, ${fmtH(d.horas)}`);
    return { ok: true, datos: d };
}

let enCurso = null;

/** Cron (cada hora) y arranque: el día 1 desde las 10:00 (Madrid), publica el mes anterior en cada servidor que no lo tenga. */
function enviarSiToca(client, ahora = Date.now()) {
    if (!enCurso) enCurso = enviar(client, ahora).finally(() => (enCurso = null));
    return enCurso;
}

async function enviar(client, ahora) {
    const { dia, hora } = plexHistorial.momento(Math.floor(ahora / 1000));
    if (!dia.endsWith("-01") || hora < HORA) return 0;
    const mes = mesAnterior(ahora);
    let publicados = 0;
    for (const guild of client.guilds.cache.values()) {
        const cfg = guildSettings.getSettings(guild.id).plex;
        if (!cfg.ranking_canal || cfg.wrapped_ultimo_mes === mes.mes || !plexLinks.getLinks(guild.id).length) continue;
        const { url, apiKey } = tautulli.getConfig(guild.id);
        if (url && apiKey) {
            try {
                await plexHistorial.sincronizar(guild.id);
            } catch (e) {
                log.warn(`Plex Wrapped: no se pudo copiar lo último del historial de ${guild.name} (se usa lo que hay): ${e.message}`);
            }
        }
        try {
            if ((await publicar(guild, mes)).ok) publicados++;
        } catch (e) {
            log.warn(`No se pudo publicar el Plex Wrapped en ${guild.name}: ${e.message}`);
        }
    }
    return publicados;
}

module.exports = { HORA, mesAnterior, datos, mensaje, grafico, publicar, enviarSiToca };
