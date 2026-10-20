// ⭐ Equipos favoritos (#530): seguir y dejar equipos, ver sus próximos partidos y avisar por DM cuando aparece uno
// nuevo. Los equipos son globales por usuario (como las apuestas) y el catálogo sale de los partidos ya sincronizados:
// no se llama a la Odds API. El DM sale al guardarse cuotas nuevas y se puede apagar en /avisos.
const db = require("../../core/db");
const { intentarDm, silenciado } = require("../avisosDm");
const { DEPORTES } = require("../../services/oddsApi");
const { createLogger } = require("../../core/logger");

const log = createLogger("Apuestas");

const MAX_EQUIPOS = 10;
const MAX_AUTOCOMPLETADO = 25;
/** Discord corta los mensajes en 2000 caracteres: se deja margen para el encabezado y el pie. */
const MAX_DM = 1900;

// Se duplica a propósito la normalización de systems/retos/partidos.js: las apuestas no deben depender de los retos.
/** Sin mayúsculas, tildes ni signos, para comparar nombres de equipos. */
const normalizar = (texto) =>
    String(texto || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();

const cuota = (n) => (Number.isFinite(Number(n)) && Number(n) >= 1 ? Number(n).toFixed(2) : "—");
const deporteDe = (clave) => DEPORTES[clave] || DEPORTES.laliga;
const unixDe = (fecha) => Math.floor(Date.parse(fecha) / 1000);

const COLUMNAS = "match_id, home_team, away_team, start_time, deporte, cuota_home, cuota_draw, cuota_away";

/**
 * Los partidos abiertos que aún no han empezado, el más cercano primero. Se compara la hora en JS (con un margen de
 * un día en SQL) porque `start_time` es texto ISO y puede venir con offset; es el patrón de recordatorios.js.
 */
function partidosAbiertos(ahora = Date.now()) {
    return db
        .prepare(
            `SELECT ${COLUMNAS} FROM apuestas_partidos
             WHERE estado = 'abierto' AND home_team IS NOT NULL AND away_team IS NOT NULL AND start_time >= ?
             ORDER BY start_time, id`,
        )
        .all(new Date(ahora - 24 * 3600 * 1000).toISOString())
        .filter((p) => Date.parse(p.start_time) > ahora);
}

/** Todos los nombres distintos de los equipos de los partidos abiertos futuros, ordenados en español. */
function catalogo(ahora = Date.now()) {
    const nombres = partidosAbiertos(ahora).flatMap((p) => [p.home_team, p.away_team]);
    return [...new Set(nombres)].sort((a, b) => a.localeCompare(b, "es"));
}

/** Los equipos que puede seguir una persona, filtrados por texto (hasta 25: lo que admite el autocompletado). */
function equiposDisponibles({ texto = "", limite = MAX_AUTOCOMPLETADO, ahora = Date.now() } = {}) {
    const buscado = normalizar(texto);
    const cuantos = Math.max(1, Math.min(MAX_AUTOCOMPLETADO, Number(limite) || MAX_AUTOCOMPLETADO));
    return catalogo(ahora)
        .filter((equipo) => !buscado || normalizar(equipo).includes(buscado))
        .slice(0, cuantos);
}

/** Los equipos que sigue una persona, ordenados por nombre. */
function seguidos(userId) {
    return db
        .prepare("SELECT equipo_key, equipo, creado_en FROM equipos_favoritos WHERE userId = ? ORDER BY equipo COLLATE NOCASE")
        .all(String(userId));
}

/** Resuelve un texto contra una lista de nombres: exacto normalizado o único parcial. */
function resolver(nombres, texto) {
    const buscado = normalizar(texto);
    if (!buscado) return { ok: false, motivo: "❌ Escribe el nombre de un equipo." };
    const exacto = nombres.find((nombre) => normalizar(nombre) === buscado);
    if (exacto) return { ok: true, equipo: exacto };
    const parciales = nombres.filter((nombre) => normalizar(nombre).includes(buscado));
    if (parciales.length === 1) return { ok: true, equipo: parciales[0] };
    if (parciales.length > 1) {
        return {
            ok: false,
            motivo: `❌ «${texto}» encaja con varios equipos: ${parciales.slice(0, 10).join(", ")}. Escribe el nombre completo.`,
            candidatos: parciales,
        };
    }
    return { ok: false, motivo: `❌ No encuentro ningún equipo con «${texto}».` };
}

/**
 * Sigue a un equipo resolviendo el texto contra el catálogo de partidos guardados.
 * @returns {{ ok: true, equipo: string } | { ok: false, motivo: string, candidatos?: string[] }}
 */
function seguir(userId, texto, ahora = Date.now()) {
    const elegido = resolver(catalogo(ahora), texto);
    if (!elegido.ok) return elegido;
    const clave = normalizar(elegido.equipo);
    const ya = db.prepare("SELECT 1 FROM equipos_favoritos WHERE userId = ? AND equipo_key = ?").get(String(userId), clave);
    if (ya) return { ok: false, motivo: `❌ Ya sigues a **${elegido.equipo}**.` };
    const n = db.prepare("SELECT COUNT(*) AS n FROM equipos_favoritos WHERE userId = ?").get(String(userId)).n;
    if (n >= MAX_EQUIPOS) {
        return { ok: false, motivo: `❌ Ya sigues a ${MAX_EQUIPOS} equipos, el máximo. Deja alguno con \`/favoritos dejar\`.` };
    }
    db.prepare("INSERT INTO equipos_favoritos (userId, equipo_key, equipo, creado_en) VALUES (?, ?, ?, ?)").run(
        String(userId),
        clave,
        elegido.equipo,
        ahora,
    );
    return { ok: true, equipo: elegido.equipo };
}

/** Deja de seguir un equipo resolviendo el texto contra los que ya sigue. */
function dejar(userId, texto) {
    const suyos = seguidos(userId);
    const elegido = resolver(
        suyos.map((f) => f.equipo),
        texto,
    );
    if (!elegido.ok) return elegido;
    const clave = normalizar(elegido.equipo);
    db.prepare("DELETE FROM equipos_favoritos WHERE userId = ? AND equipo_key = ?").run(String(userId), clave);
    return { ok: true, equipo: elegido.equipo };
}

/** Los partidos abiertos futuros de los equipos seguidos, ordenados por hora. */
function proximos(userId, { limite = 10, ahora = Date.now() } = {}) {
    const claves = new Set(seguidos(userId).map((f) => f.equipo_key));
    if (!claves.size) return [];
    return partidosAbiertos(ahora)
        .filter((p) => claves.has(normalizar(p.home_team)) || claves.has(normalizar(p.away_team)))
        .slice(0, Math.max(1, Number(limite) || 10));
}

function lineaPartido(p) {
    const unix = unixDe(p.start_time);
    return (
        `${deporteDe(p.deporte).emoji} **${p.home_team} vs ${p.away_team}** · ${deporteDe(p.deporte).name}\n` +
        `   <t:${unix}:f> (<t:${unix}:R>)\n` +
        `   Cuotas: 1 ${cuota(p.cuota_home)} · X ${cuota(p.cuota_draw)} · 2 ${cuota(p.cuota_away)}`
    );
}

function mensajeAviso(partidos) {
    return (
        "⭐ **Hay partido de tus equipos favoritos:**\n\n" +
        partidos.map(lineaPartido).join("\n\n") +
        "\n\nApuesta en /juegos → ⚽ Apuestas. Gestiona tus equipos en /favoritos."
    );
}

/** Trocea los partidos en mensajes que quepan en un DM (2000 caracteres), sin partir una línea de partido. */
function bloquesDe(partidos, max = MAX_DM) {
    const bloques = [];
    let actual = [];
    for (const p of partidos) {
        const prueba = [...actual, p];
        if (actual.length && mensajeAviso(prueba).length > max) {
            bloques.push(actual);
            actual = [p];
        } else {
            actual = prueba;
        }
    }
    if (actual.length) bloques.push(actual);
    return bloques;
}

/**
 * Avisa por DM de los partidos nuevos de los equipos seguidos. Marca antes de enviar (`INSERT OR IGNORE`), así que
 * cada partido se avisa una sola vez por persona aunque el DM falle; si el fallo es transitorio (no son DMs cerrados)
 * se desmarca ese bloque para reintentarlo en el siguiente refresco. Los mensajes se trocean para no pasar de 2000
 * caracteres.
 * @returns {Promise<number>} DMs enviados
 */
async function avisarPartidos(client, ahora = Date.now()) {
    const porEquipo = new Map();
    for (const f of db.prepare("SELECT userId, equipo_key FROM equipos_favoritos").all()) {
        porEquipo.set(f.equipo_key, [...(porEquipo.get(f.equipo_key) || []), f.userId]);
    }
    if (!porEquipo.size) return 0;

    const marcar = db.prepare("INSERT OR IGNORE INTO equipos_favoritos_avisos (userId, match_id, avisado_en) VALUES (?, ?, ?)");
    const desmarcar = db.prepare("DELETE FROM equipos_favoritos_avisos WHERE userId = ? AND match_id = ?");
    const pendientes = new Map();
    for (const p of partidosAbiertos(ahora)) {
        for (const clave of new Set([normalizar(p.home_team), normalizar(p.away_team)])) {
            for (const userId of porEquipo.get(clave) || []) {
                if (marcar.run(String(userId), String(p.match_id), ahora).changes !== 1) continue;
                pendientes.set(userId, [...(pendientes.get(userId) || []), p]);
            }
        }
    }

    let enviados = 0;
    for (const [userId, suyos] of pendientes) {
        if (silenciado(userId, "equipo_favorito")) continue;
        for (const bloque of bloquesDe(suyos)) {
            const resultado = await intentarDm(client, userId, { content: mensajeAviso(bloque) });
            if (resultado === "ok") enviados++;
            // DMs cerrados (50007) no se reintentan; un fallo transitorio sí.
            else if (resultado === "error") for (const p of bloque) desmarcar.run(String(userId), String(p.match_id));
        }
    }
    if (pendientes.size) {
        const partidos = new Set([...pendientes.values()].flat().map((p) => p.match_id)).size;
        log.info(`Equipos favoritos: ${enviados}/${pendientes.size} DMs (${partidos} partidos)`);
    }
    return enviados;
}

module.exports = {
    MAX_EQUIPOS,
    normalizar,
    equiposDisponibles,
    seguidos,
    seguir,
    dejar,
    proximos,
    avisarPartidos,
    _mensajeAviso: mensajeAviso,
};
