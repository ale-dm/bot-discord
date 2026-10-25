// 📅 Calendario de eventos (#540): junta lo que ya programa el bot (sesiones de cine, cumpleaños, partidos de las
// competiciones elegidas y el cierre de las quinielas abiertas) con los eventos que crea un admin, en una lista común
// { clave, tipo, emoji, titulo, inicio, diaEntero, enlace } ordenada por fecha. Los rangos (semana o mes) se cuentan en hora
// de Madrid; las horas se enseñan con timestamps de Discord para que cada uno las vea en la suya. Sin Discord.
const db = require("../core/db");
const guildSettings = require("./guildSettings");
const cumpleanos = require("./cumpleanos");
const { DEPORTES } = require("../services/oddsApi");
const { fechaMadridAMs, momentoMadrid, sumarDias, lunesDe } = require("../core/zonaMadrid");

const TITULO_MIN = 3;
const TITULO_MAX = 100;

/** Los ajustes del calendario del servidor. */
function ajustes(guildId) {
    const c = guildSettings.getSettings(guildId).calendario;
    return {
        canal: String(c.canal || ""),
        recordatorioMin: Math.max(0, Number(c.recordatorio_min) || 0),
        competiciones: competicionesDe(c.competiciones),
    };
}

/** Las competiciones válidas de un texto separado por comas (claves de la Odds API). */
const competicionesDe = (texto) => [
    ...new Set(
        String(texto || "")
            .split(",")
            .map((c) => c.trim().toLowerCase())
            .filter((c) => DEPORTES[c]),
    ),
];

/** Un día «AAAA-MM-DD» de Madrid a las 00:00, en ms. */
const inicioDelDia = (dia) => fechaMadridAMs(`${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`);

/** La semana (de lunes a lunes, Madrid) desplazada `offset` semanas desde la de `ahora`. */
function rangoSemana(ahora = Date.now(), offset = 0) {
    const lunes = sumarDias(lunesDe(momentoMadrid(ahora).dia), 7 * offset);
    return { desde: inicioDelDia(lunes), hasta: inicioDelDia(sumarDias(lunes, 7)), lunes };
}

/** El mes (Madrid) desplazado `offset` meses desde el de `ahora`. */
function rangoMes(ahora = Date.now(), offset = 0) {
    const m = momentoMadrid(ahora);
    const indice = m.anio * 12 + (m.mes - 1) + offset;
    const anio = Math.floor(indice / 12);
    const mes = (indice % 12) + 1;
    const dia = (a, me) => `${a}-${String(me).padStart(2, "0")}-01`;
    const sig = mes === 12 ? [anio + 1, 1] : [anio, mes + 1];
    return { desde: inicioDelDia(dia(anio, mes)), hasta: inicioDelDia(dia(...sig)), anio, mes };
}

const enlaceMensaje = (guildId, canalId, mensajeId) =>
    canalId && mensajeId ? `https://discord.com/channels/${guildId}/${canalId}/${mensajeId}` : null;

function deCine(guildId, desde, hasta) {
    return db
        .prepare(
            "SELECT id, canalId, mensajeId, peli, inicio FROM cine_sesiones WHERE guildId = ? AND cancelada = 0 AND inicio >= ? AND inicio < ?",
        )
        .all(String(guildId), new Date(desde).toISOString(), new Date(hasta).toISOString())
        .map((s) => ({
            clave: `cine:${s.id}`,
            tipo: "cine",
            emoji: "🎬",
            titulo: `Sesión de cine: ${s.peli}`,
            inicio: Date.parse(s.inicio),
            diaEntero: false,
            enlace: enlaceMensaje(guildId, s.canalId, s.mensajeId),
        }));
}

function deCumpleanos(guildId, desde, hasta) {
    const anios = [...new Set([momentoMadrid(desde).anio, momentoMadrid(hasta - 1).anio])];
    const filas = db.prepare("SELECT userId, dia, mes FROM cumpleanos WHERE guildId = ?").all(String(guildId));
    const lista = [];
    for (const f of filas) {
        for (const anio of anios) {
            const { dia, mes } = cumpleanos.celebracion(f.dia, f.mes, anio);
            const inicio = fechaMadridAMs(`${dia}/${mes}/${anio}`);
            if (inicio === null || inicio < desde || inicio >= hasta) continue;
            lista.push({
                clave: `cumple:${f.userId}:${anio}`,
                tipo: "cumple",
                emoji: "🎂",
                titulo: `Cumpleaños de <@${f.userId}>`,
                inicio,
                diaEntero: true,
                enlace: null,
            });
        }
    }
    return lista;
}

function dePartidos(competiciones, desde, hasta) {
    if (!competiciones.length) return [];
    const marcas = competiciones.map(() => "?").join(", ");
    return db
        .prepare(
            `SELECT match_id, deporte, home_team, away_team, start_time FROM apuestas_partidos
             WHERE deporte IN (${marcas}) AND start_time >= ? AND start_time < ? AND estado != 'caducado'`,
        )
        .all(...competiciones, new Date(desde).toISOString(), new Date(hasta).toISOString())
        .map((p) => ({
            clave: `partido:${p.match_id}`,
            tipo: "partido",
            emoji: DEPORTES[p.deporte]?.emoji || "⚽",
            titulo: `${p.home_team} - ${p.away_team} (${DEPORTES[p.deporte]?.name || p.deporte})`,
            inicio: Date.parse(p.start_time),
            diaEntero: false,
            enlace: null,
        }));
}

function deQuinielas(desde, hasta) {
    return db
        .prepare(
            `SELECT q.id, q.jornada, MIN(p.start_time) AS cierre FROM quinielas q JOIN quiniela_partidos p ON p.quiniela_id = q.id
             WHERE q.estado = 'abierta' GROUP BY q.id HAVING cierre >= ? AND cierre < ?`,
        )
        .all(new Date(desde).toISOString(), new Date(hasta).toISOString())
        .map((q) => ({
            clave: `quiniela:${q.id}`,
            tipo: "quiniela",
            emoji: "🎟️",
            titulo: `Cierra la quiniela: ${q.jornada}`,
            inicio: Date.parse(q.cierre),
            diaEntero: false,
            enlace: null,
        }));
}

function deManuales(guildId, desde, hasta) {
    return db
        .prepare("SELECT id, titulo, inicio FROM calendario_eventos WHERE guildId = ? AND inicio >= ? AND inicio < ?")
        .all(String(guildId), desde, hasta)
        .map((e) => ({
            clave: `manual:${e.id}`,
            tipo: "manual",
            emoji: "📌",
            titulo: e.titulo,
            inicio: e.inicio,
            diaEntero: false,
            enlace: null,
        }));
}

/** Todos los eventos del servidor entre `desde` (incluido) y `hasta` (excluido), por fecha y luego por título. */
function eventos(guildId, desde, hasta) {
    return [
        ...deCine(guildId, desde, hasta),
        ...deCumpleanos(guildId, desde, hasta),
        ...dePartidos(ajustes(guildId).competiciones, desde, hasta),
        ...deQuinielas(desde, hasta),
        ...deManuales(guildId, desde, hasta),
    ]
        .filter((e) => Number.isFinite(e.inicio))
        .sort((a, b) => a.inicio - b.inicio || a.titulo.localeCompare(b.titulo));
}

/**
 * Crea un evento manual. `fecha`: «DD/MM/AAAA HH:MM» en hora de Madrid, y no en el pasado.
 * @returns {{ ok: true, id: number, inicio: number } | { ok: false, motivo: string }}
 */
function crearManual({ guildId, titulo, fecha, porId }, ahora = Date.now()) {
    const t = String(titulo ?? "").trim();
    if (t.length < TITULO_MIN || t.length > TITULO_MAX)
        return { ok: false, motivo: `El título tiene que tener de ${TITULO_MIN} a ${TITULO_MAX} caracteres.` };
    const inicio = fechaMadridAMs(String(fecha ?? "").trim());
    if (inicio === null) return { ok: false, motivo: "La fecha va como DD/MM/AAAA HH:MM (hora de Madrid)." };
    if (inicio <= ahora) return { ok: false, motivo: "Esa fecha ya ha pasado." };
    const { lastInsertRowid } = db
        .prepare("INSERT INTO calendario_eventos (guildId, titulo, inicio, creadoPor, creado) VALUES (?, ?, ?, ?, ?)")
        .run(String(guildId), t, inicio, String(porId), ahora);
    return { ok: true, id: Number(lastInsertRowid), inicio };
}

/** Borra un evento manual de ese servidor. @returns {object | null} el evento borrado */
function borrarManual(guildId, id) {
    const e = db.prepare("SELECT * FROM calendario_eventos WHERE id = ? AND guildId = ?").get(Number(id), String(guildId));
    if (!e) return null;
    db.prepare("DELETE FROM calendario_eventos WHERE id = ?").run(e.id);
    return e;
}

/** Los eventos manuales que aún no han pasado. */
const manualesProximos = (guildId, ahora = Date.now()) =>
    db.prepare("SELECT * FROM calendario_eventos WHERE guildId = ? AND inicio > ? ORDER BY inicio, id").all(String(guildId), ahora);

/**
 * Los eventos con hora que empiezan dentro de los próximos `recordatorio_min` minutos y aún no tienen recordatorio. Los de
 * día entero (cumpleaños) no se recuerdan: ya tienen su felicitación.
 */
function pendientesDeRecordar(guildId, ahora = Date.now()) {
    const { recordatorioMin, canal } = ajustes(guildId);
    if (!recordatorioMin || !canal) return [];
    const enviados = new Set(
        db
            .prepare("SELECT clave FROM calendario_recordatorios WHERE guildId = ?")
            .all(String(guildId))
            .map((r) => r.clave),
    );
    return eventos(guildId, ahora + 1, ahora + recordatorioMin * 60 * 1000 + 1).filter((e) => !e.diaEntero && !enviados.has(e.clave));
}

/** Apunta el recordatorio de un evento. @returns {boolean} si es la primera vez (si no, ya se mandó) */
const marcarRecordado = (guildId, clave, ahora = Date.now()) =>
    db
        .prepare("INSERT OR IGNORE INTO calendario_recordatorios (guildId, clave, enviado) VALUES (?, ?, ?)")
        .run(String(guildId), clave, ahora).changes > 0;

/** Deshace la marca si el recordatorio no se pudo mandar. */
const desmarcarRecordado = (guildId, clave) =>
    db.prepare("DELETE FROM calendario_recordatorios WHERE guildId = ? AND clave = ?").run(String(guildId), clave);

module.exports = {
    TITULO_MAX,
    ajustes,
    competicionesDe,
    rangoSemana,
    rangoMes,
    eventos,
    crearManual,
    borrarManual,
    manualesProximos,
    pendientesDeRecordar,
    marcarRecordado,
    desmarcarRecordado,
};
