// Apodos del Duende: cómo se llama y cómo se refiere la gente a cada miembro del servidor.
// Antes eran dos mapas escritos a mano en duende.js; ahora están en la tabla duende_apodos y
// se gestionan en Panel admin → Config Global → Duende → Apodos.
//
// - El apodo "principal" es el nombre con el que el Duende llama a la persona, y el que
//   convierte en mención cuando lo escribe en una respuesta.
// - El resto son formas de referirse a ella ("el perro", "coneyo"...): sirven para entender de
//   quién se habla (herramientas de Plex/Seerr) pero no se convierten en mención.
const db = require("../core/db");
const { createLogger } = require("../core/logger");
const { normalizarApodo, sinArticulo } = require("./apodosUtil");

const log = createLogger("Apodos");

function listar(guildId) {
    if (!guildId) return [];
    return db
        .prepare(
            `
        SELECT apodo, discordId, principal FROM duende_apodos
        WHERE guildId = ? ORDER BY discordId, principal DESC, apodo
    `,
        )
        .all(guildId);
}

/** [{ discordId, nombre, apodos: [...] }] agrupado por persona. */
function porPersona(guildId) {
    const personas = new Map();
    for (const r of listar(guildId)) {
        const p = personas.get(r.discordId) || { discordId: r.discordId, nombre: null, apodos: [] };
        if (r.principal && !p.nombre) p.nombre = r.apodo;
        else p.apodos.push(r.apodo);
        personas.set(r.discordId, p);
    }
    return [...personas.values()];
}

/** Discord ID de quien tenga ese apodo (probando también sin artículo: "el perro" → "perro"). */
function resolver(guildId, nombre) {
    if (!guildId || !nombre) return null;
    const norm = normalizarApodo(nombre);
    if (!norm) return null;
    const q = db.prepare("SELECT discordId FROM duende_apodos WHERE guildId = ? AND apodo_norm = ?");
    const exacto = q.get(guildId, norm);
    if (exacto) return exacto.discordId;
    const sin = sinArticulo(norm);
    return sin !== norm ? q.get(guildId, sin)?.discordId || null : null;
}

/** Nombre con el que el Duende llama a alguien, o null si no tiene. */
function nombreDe(guildId, discordId) {
    if (!guildId || !discordId) return null;
    return (
        db
            .prepare("SELECT apodo FROM duende_apodos WHERE guildId = ? AND discordId = ? AND principal = 1")
            .pluck()
            .get(guildId, discordId) || null
    );
}

/** [{ discordId, nombre }] de todos los que tienen nombre principal. */
function nombres(guildId) {
    if (!guildId) return [];
    return db.prepare("SELECT discordId, apodo AS nombre FROM duende_apodos WHERE guildId = ? AND principal = 1").all(guildId);
}

/**
 * Añade (o reasigna) un apodo. Si es principal, pasa a ser el único nombre principal de esa persona.
 * @returns {{ ok: boolean, anterior?: string }} anterior = discordId al que pertenecía antes, si cambió de dueño
 */
function anadir(guildId, discordId, apodo, principal = false) {
    const norm = normalizarApodo(apodo);
    if (!norm) return { ok: false };
    const previo = db.prepare("SELECT discordId FROM duende_apodos WHERE guildId = ? AND apodo_norm = ?").pluck().get(guildId, norm);
    db.transaction(() => {
        if (principal) db.prepare("UPDATE duende_apodos SET principal = 0 WHERE guildId = ? AND discordId = ?").run(guildId, discordId);
        db.prepare(
            `
            INSERT INTO duende_apodos (guildId, apodo_norm, apodo, discordId, principal) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(guildId, apodo_norm) DO UPDATE SET apodo = excluded.apodo, discordId = excluded.discordId, principal = excluded.principal
        `,
        ).run(guildId, norm, String(apodo).trim(), discordId, principal ? 1 : 0);
    })();
    log.info(
        `${guildId}: apodo "${apodo}"${principal ? " (nombre principal)" : ""} → ${discordId}${previo && previo !== discordId ? ` (antes era de ${previo})` : ""}`,
    );
    return { ok: true, anterior: previo && previo !== discordId ? previo : undefined };
}

/** Quita un apodo. @returns {string|null} discordId al que pertenecía, o null si no existía. */
function quitar(guildId, apodo) {
    const norm = normalizarApodo(apodo);
    const dueno = db.prepare("SELECT discordId FROM duende_apodos WHERE guildId = ? AND apodo_norm = ?").pluck().get(guildId, norm);
    if (!dueno) return null;
    db.prepare("DELETE FROM duende_apodos WHERE guildId = ? AND apodo_norm = ?").run(guildId, norm);
    log.info(`${guildId}: apodo "${apodo}" quitado (era de ${dueno})`);
    return dueno;
}

/**
 * Importa data/duende-apodos.seed.json si existe (se llama al arrancar) y lo renombra a
 * .importado. No pisa apodos que ya existan. Formato:
 *   { "guildId": "...opcional, por defecto GUILD_ID...",
 *     "personas": [ { "discordId": "...", "nombre": "Raúl", "apodos": ["coneyo", "el marcos"] } ] }
 * @returns {number} apodos importados
 */
function importarFicheroSiExiste() {
    const fs = require("fs");
    const path = require("path");
    const { DATA_DIR } = require("../core/paths");
    const file = path.join(DATA_DIR, "duende-apodos.seed.json");
    if (!fs.existsSync(file)) return 0;

    let seed;
    try {
        seed = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (e) {
        log.error(`${path.basename(file)} no es un JSON válido; no se importa:`, e.message);
        return 0;
    }
    const guildId = seed.guildId || process.env.GUILD_ID;
    if (!guildId) {
        log.warn(`${path.basename(file)} no indica guildId y no hay GUILD_ID en .env: no se importa`);
        return 0;
    }
    const insert = db.prepare(`
        INSERT OR IGNORE INTO duende_apodos (guildId, apodo_norm, apodo, discordId, principal)
        VALUES (?, ?, ?, ?, ?)
    `);
    let n = 0;
    db.transaction(() => {
        for (const p of seed.personas || []) {
            if (!/^\d{17,20}$/.test(String(p.discordId || ""))) continue;
            const yaTieneNombre = !!nombreDe(guildId, String(p.discordId));
            const entradas = [...(p.nombre ? [[p.nombre, yaTieneNombre ? 0 : 1]] : []), ...(p.apodos || []).map((a) => [a, 0])];
            for (const [apodo, principal] of entradas) {
                const norm = normalizarApodo(apodo);
                if (norm) n += insert.run(guildId, norm, String(apodo).trim(), String(p.discordId), principal).changes;
            }
        }
    })();
    fs.renameSync(file, file + ".importado");
    log.info(`Importados ${n} apodos de ${(seed.personas || []).length} personas en ${guildId} desde ${path.basename(file)}`);
    return n;
}

module.exports = { listar, porPersona, resolver, nombreDe, nombres, anadir, quitar, importarFicheroSiExiste };
