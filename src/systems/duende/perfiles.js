// Personalidades del Duende, perfiles de personas (descripción escrita a mano + notas de
// /duende recuerda) y personalidad asignada a cada canal. En la BD (migración 008).
//
// Un perfil se identifica por Discord ID. Los importados del JSON antiguo solo tenían username:
// se vinculan a su ID en cuanto se sabe quién es (al arrancar con vincularPerfiles, o cuando esa
// persona habla con perfilDe), y desde entonces cambiar de username ya no le hace perder nada.
const fs = require("fs");
const path = require("path");
const db = require("../../core/db");
const { createLogger } = require("../../core/logger");
const { DATA_DIR } = require("../../core/paths");

const log = createLogger("Duende");

const MAX_NOTAS = 15;
// Caracteres del perfil (descripción + notas) que recibe el modelo por persona. Con 1.200, las
// descripciones largas se cortaban y las notas (van detrás) de esas personas no llegaban nunca.
const MAX_PERFIL_PROMPT = 2500;

const instruccionDefault = "Eres un bot de discord asistente , no añadas al principio ni tu nombre ni el de que te hable con los ':'...";
const PERSONALIDADES_INICIALES = [
    { id: "default", title: "Inútil y malhumorado", systemInstructions: instruccionDefault },
    {
        id: "inteligente",
        title: "Inteligente y resolutivo",
        systemInstructions: "Eres un asistente eficiente, claro y resolutivo. Responde con precisión y amabilidad.",
    },
];

// ─── Personalidades ──────────────────────────────────────────────────────────

const aPersonalidad = (r) => r && { id: r.id, title: r.titulo, systemInstructions: r.instrucciones };

function listarPersonalidades() {
    return db.prepare("SELECT * FROM duende_personalidades ORDER BY rowid").all().map(aPersonalidad);
}

function obtenerPersonalidad(id) {
    if (!id) return null;
    return aPersonalidad(db.prepare("SELECT * FROM duende_personalidades WHERE id = ?").get(id)) || null;
}

/** @returns {boolean} true si ya existía (se ha actualizado) */
function guardarPersonalidad({ id, title, systemInstructions }) {
    const existia = !!obtenerPersonalidad(id);
    db.prepare(
        `INSERT INTO duende_personalidades (id, titulo, instrucciones, actualizado_en) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET titulo = excluded.titulo, instrucciones = excluded.instrucciones, actualizado_en = excluded.actualizado_en`,
    ).run(id, title, systemInstructions, Date.now());
    return existia;
}

/** @returns {boolean} true si existía */
function borrarPersonalidad(id) {
    return db.transaction(() => {
        db.prepare("DELETE FROM duende_canales WHERE personalidad_id = ?").run(id);
        return db.prepare("DELETE FROM duende_personalidades WHERE id = ?").run(id).changes > 0;
    })();
}

function personalidadDeCanal(channelId) {
    return db.prepare("SELECT personalidad_id FROM duende_canales WHERE channel_id = ?").pluck().get(channelId) || null;
}

function asignarPersonalidadCanal(channelId, personalidadId) {
    db.prepare(
        "INSERT INTO duende_canales (channel_id, personalidad_id) VALUES (?, ?) ON CONFLICT(channel_id) DO UPDATE SET personalidad_id = excluded.personalidad_id",
    ).run(channelId, personalidadId);
}

// ─── Perfiles de personas ────────────────────────────────────────────────────

function aPerfil(r) {
    if (!r) return null;
    let notas = [];
    try {
        notas = JSON.parse(r.notas || "[]");
    } catch {
        notas = [];
    }
    return {
        id: r.id,
        key: r.discord_id || `u:${r.username}`,
        discordId: r.discord_id,
        username: r.username,
        name: r.nombre,
        description: r.descripcion,
        notas,
        actualizadoEn: r.actualizado_en,
    };
}

function perfilPorId(id) {
    return aPerfil(db.prepare("SELECT * FROM duende_perfiles WHERE id = ?").get(Number(id)));
}

/**
 * Perfil de alguien elegido en el panel; si no tenía, se crea vacío (usando el perfil antiguo
 * sin vincular con su username, si lo hay).
 */
function asegurarPerfil(user, nombre) {
    const existente = perfilDe(user);
    if (existente) return existente;
    db.prepare("INSERT INTO duende_perfiles (discord_id, username, nombre, notas, actualizado_en) VALUES (?, ?, ?, '[]', ?)").run(
        String(user.id),
        user.username || null,
        nombre,
        Date.now(),
    );
    return perfilDe(user);
}

/**
 * Cambia todos los campos de un perfil (Panel admin → Duende → Perfiles → Editar).
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
function actualizarPerfil(id, { nombre, username, discordId, descripcion, notas }) {
    nombre = String(nombre || "").trim();
    if (!nombre) return { ok: false, error: "El nombre no puede estar vacío." };
    discordId = String(discordId || "").trim() || null;
    if (discordId && !/^\d{17,20}$/.test(discordId)) return { ok: false, error: "El Discord ID debe ser un número de 17 a 20 cifras." };
    if (discordId) {
        const otro = db.prepare("SELECT nombre FROM duende_perfiles WHERE discord_id = ? AND id != ?").get(discordId, Number(id));
        if (otro) return { ok: false, error: `Ese Discord ID ya es del perfil de **${otro.nombre}**.` };
    }
    const lista = (Array.isArray(notas) ? notas : [])
        .map((n) => String(n).trim().slice(0, 200))
        .filter(Boolean)
        .slice(-MAX_NOTAS);
    const r = db
        .prepare(
            "UPDATE duende_perfiles SET nombre = ?, username = ?, discord_id = ?, descripcion = ?, notas = ?, actualizado_en = ? WHERE id = ?",
        )
        .run(
            nombre,
            String(username || "").trim() || null,
            discordId,
            String(descripcion || "").trim() || null,
            JSON.stringify(lista),
            Date.now(),
            Number(id),
        );
    return r.changes ? { ok: true } : { ok: false, error: "Ese perfil ya no existe." };
}

function borrarNotasPorId(id) {
    db.prepare("UPDATE duende_perfiles SET notas = '[]', actualizado_en = ? WHERE id = ?").run(Date.now(), Number(id));
}

function borrarPerfilPorId(id) {
    return db.prepare("DELETE FROM duende_perfiles WHERE id = ?").run(Number(id)).changes > 0;
}

function listarPerfiles() {
    return db.prepare("SELECT * FROM duende_perfiles ORDER BY nombre COLLATE NOCASE").all().map(aPerfil);
}

function filaPorUsuario(user) {
    if (!user) return null;
    const porId = user.id ? db.prepare("SELECT * FROM duende_perfiles WHERE discord_id = ?").get(String(user.id)) : null;
    if (porId || !user.username) return porId;
    return db.prepare("SELECT * FROM duende_perfiles WHERE discord_id IS NULL AND lower(username) = lower(?)").get(user.username);
}

// Si el perfil aún no estaba vinculado (importado por username) se le asigna el ID; y si ya lo
// estaba, se apunta el username actual (es lo que ve el modelo en las equivalencias).
function vincular(fila, user) {
    if (!fila || !user?.id) return fila;
    if (fila.discord_id !== String(user.id) || (user.username && fila.username !== user.username)) {
        db.prepare("UPDATE duende_perfiles SET discord_id = ?, username = COALESCE(?, username) WHERE id = ?").run(
            String(user.id),
            user.username || null,
            fila.id,
        );
        if (!fila.discord_id) log.info(`Perfil de ${fila.nombre} (${fila.username}) vinculado a ${user.id}`);
        return db.prepare("SELECT * FROM duende_perfiles WHERE id = ?").get(fila.id);
    }
    return fila;
}

/** Perfil de un usuario de Discord ({ id, username }), o null. */
function perfilDe(user) {
    return aPerfil(vincular(filaPorUsuario(user), user));
}

function perfilPorDiscordId(discordId) {
    return aPerfil(db.prepare("SELECT * FROM duende_perfiles WHERE discord_id = ?").get(String(discordId)));
}

/** Añade una nota (se guardan las MAX_NOTAS más recientes). Crea el perfil si no existía. */
function anotar(user, nota, nombre = user.username) {
    return db.transaction(() => {
        let fila = vincular(filaPorUsuario(user), user);
        if (!fila) {
            db.prepare("INSERT INTO duende_perfiles (discord_id, username, nombre, notas, actualizado_en) VALUES (?, ?, ?, '[]', ?)").run(
                String(user.id),
                user.username,
                nombre,
                Date.now(),
            );
            fila = filaPorUsuario(user);
        }
        const notas = [...aPerfil(fila).notas, nota].slice(-MAX_NOTAS);
        db.prepare("UPDATE duende_perfiles SET notas = ?, actualizado_en = ? WHERE id = ?").run(JSON.stringify(notas), Date.now(), fila.id);
        return aPerfil({ ...fila, notas: JSON.stringify(notas) });
    })();
}

/**
 * Borra las notas de /duende recuerda. El perfil base (descripción) se conserva; si no tenía,
 * se borra el perfil entero.
 * @returns {string[]} notas borradas
 */
function olvidarNotas(user) {
    return db.transaction(() => {
        const fila = filaPorUsuario(user);
        if (!fila) return [];
        const notas = aPerfil(fila).notas;
        if (!notas.length) return [];
        if (fila.descripcion)
            db.prepare("UPDATE duende_perfiles SET notas = '[]', actualizado_en = ? WHERE id = ?").run(Date.now(), fila.id);
        else db.prepare("DELETE FROM duende_perfiles WHERE id = ?").run(fila.id);
        return notas;
    })();
}

/** Crea o cambia el nombre y la descripción del perfil de alguien (Panel admin → Duende → Perfiles). */
function guardarDescripcion({ discordId, username = null, nombre, descripcion }) {
    const texto = String(descripcion || "").trim() || null;
    // Si había un perfil antiguo sin vincular con ese username, se usa ese (no uno duplicado).
    vincular(filaPorUsuario({ id: discordId, username }), { id: discordId, username });
    db.prepare(
        `INSERT INTO duende_perfiles (discord_id, username, nombre, descripcion, notas, actualizado_en) VALUES (?, ?, ?, ?, '[]', ?)
         ON CONFLICT(discord_id) DO UPDATE SET nombre = excluded.nombre, descripcion = excluded.descripcion,
             username = COALESCE(excluded.username, username), actualizado_en = excluded.actualizado_en`,
    ).run(String(discordId), username, nombre, texto, Date.now());
}

function borrarPerfil(discordId) {
    return db.prepare("DELETE FROM duende_perfiles WHERE discord_id = ?").run(String(discordId)).changes > 0;
}

/**
 * Vincula a su Discord ID los perfiles que solo tienen username, buscándolos entre los miembros
 * del servidor (hace falta el intent GuildMembers, que el bot ya usa). Se llama al arrancar.
 * @returns {number} perfiles vinculados
 */
async function vincularPerfiles(guild) {
    const pendientes = db.prepare("SELECT * FROM duende_perfiles WHERE discord_id IS NULL AND username IS NOT NULL").all();
    if (!pendientes.length || !guild) return 0;
    let miembros;
    try {
        miembros = await guild.members.fetch();
    } catch (e) {
        log.warn(`No se pudieron cargar los miembros de ${guild.name} para vincular perfiles: ${e.message}`);
        miembros = guild.members.cache;
    }
    let n = 0;
    for (const fila of pendientes) {
        const m = miembros.find((x) => x.user.username.toLowerCase() === fila.username.toLowerCase());
        if (!m || db.prepare("SELECT 1 FROM duende_perfiles WHERE discord_id = ?").get(m.id)) continue;
        vincular(fila, m.user);
        n++;
    }
    const sinVincular = pendientes.length - n;
    if (n || sinVincular) {
        log.info(
            `Perfiles del Duende: ${n} vinculados a su Discord ID en ${guild.name}` +
                (sinVincular ? ` · ${sinVincular} sin encontrar (se vincularán cuando esa persona hable)` : ""),
        );
    }
    return n;
}

// ─── Importación de los JSON antiguos ────────────────────────────────────────

function leerJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (e) {
        log.error(`${path.basename(file)} no es un JSON válido; no se importa:`, e.message);
        return null;
    }
}

/**
 * Importa data/duende-personalities.json y data/duende-config.json si existen (una vez: después
 * se renombran a .importado) y crea las personalidades por defecto si no hay ninguna.
 */
function importarJsonSiExiste() {
    const filePers = path.join(DATA_DIR, "duende-personalities.json");
    const fileCfg = path.join(DATA_DIR, "duende-config.json");

    if (fs.existsSync(filePers)) {
        const datos = leerJson(filePers);
        if (datos) {
            let np = 0;
            let nf = 0;
            db.transaction(() => {
                for (const p of Array.isArray(datos.personalities) ? datos.personalities : []) {
                    if (!p?.id || !p.systemInstructions || obtenerPersonalidad(p.id)) continue;
                    guardarPersonalidad({
                        id: String(p.id),
                        title: String(p.title || p.id),
                        systemInstructions: String(p.systemInstructions),
                    });
                    np++;
                }
                const existe = db.prepare("SELECT 1 FROM duende_perfiles WHERE lower(username) = lower(?)");
                const insert = db.prepare(
                    "INSERT INTO duende_perfiles (discord_id, username, nombre, descripcion, notas, actualizado_en) VALUES (NULL, ?, ?, ?, ?, ?)",
                );
                for (const p of Array.isArray(datos.persons) ? datos.persons : []) {
                    if (!p?.id || existe.get(String(p.id))) continue;
                    const notas = Array.isArray(p.notas) ? p.notas.map(String).slice(-MAX_NOTAS) : [];
                    insert.run(
                        String(p.id),
                        String(p.name || p.id),
                        p.description ? String(p.description) : null,
                        JSON.stringify(notas),
                        Date.now(),
                    );
                    nf++;
                }
            })();
            fs.renameSync(filePers, filePers + ".importado");
            log.info(`Importadas ${np} personalidades y ${nf} perfiles de ${path.basename(filePers)} (renombrado a .importado)`);
        }
    }

    if (fs.existsSync(fileCfg)) {
        const cfg = leerJson(fileCfg);
        if (cfg && typeof cfg === "object") {
            let n = 0;
            for (const [channelId, pid] of Object.entries(cfg)) {
                if (!pid || personalidadDeCanal(channelId)) continue;
                asignarPersonalidadCanal(channelId, String(pid));
                n++;
            }
            fs.renameSync(fileCfg, fileCfg + ".importado");
            log.info(`Importadas ${n} personalidades de canal de ${path.basename(fileCfg)} (renombrado a .importado)`);
        }
    }

    if (!db.prepare("SELECT 1 FROM duende_personalidades LIMIT 1").get()) {
        for (const p of PERSONALIDADES_INICIALES) guardarPersonalidad(p);
    }
}

module.exports = {
    MAX_NOTAS,
    MAX_PERFIL_PROMPT,
    instruccionDefault,
    listarPersonalidades,
    obtenerPersonalidad,
    guardarPersonalidad,
    borrarPersonalidad,
    personalidadDeCanal,
    asignarPersonalidadCanal,
    listarPerfiles,
    perfilDe,
    perfilPorDiscordId,
    perfilPorId,
    asegurarPerfil,
    actualizarPerfil,
    borrarNotasPorId,
    borrarPerfilPorId,
    anotar,
    olvidarNotas,
    guardarDescripcion,
    borrarPerfil,
    vincularPerfiles,
    importarJsonSiExiste,
};
