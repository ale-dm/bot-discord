// Lectura de los perfiles de personas: cómo se lee una fila, cómo se encuentra el perfil de alguien (por Discord ID o,
// si todavía no está vinculado, por username) y la vinculación de los importados a su ID.
const db = require("../../../core/db");
const { createLogger } = require("../../../core/logger");

const log = createLogger("Duende");

const MAX_NOTAS = 15;
// Caracteres del perfil (descripción + notas) que recibe el modelo por persona. Con 1.200, las
// descripciones largas se cortaban y las notas (van detrás) de esas personas no llegaban nunca.
const MAX_PERFIL_PROMPT = 2500;

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
    return aPerfil(
        db
            .prepare("SELECT id, discord_id, username, nombre, descripcion, notas, actualizado_en FROM duende_perfiles WHERE id = ?")
            .get(Number(id)),
    );
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

function listarPerfiles() {
    return db
        .prepare(
            "SELECT id, discord_id, username, nombre, descripcion, notas, actualizado_en FROM duende_perfiles ORDER BY nombre COLLATE NOCASE",
        )
        .all()
        .map(aPerfil);
}

function filaPorUsuario(user) {
    if (!user) return null;
    const porId = user.id
        ? db
              .prepare(
                  "SELECT id, discord_id, username, nombre, descripcion, notas, actualizado_en FROM duende_perfiles WHERE discord_id = ?",
              )
              .get(String(user.id))
        : null;
    if (porId || !user.username) return porId;
    return db
        .prepare(
            "SELECT id, discord_id, username, nombre, descripcion, notas, actualizado_en FROM duende_perfiles WHERE discord_id IS NULL AND lower(username) = lower(?)",
        )
        .get(user.username);
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
        return db
            .prepare("SELECT id, discord_id, username, nombre, descripcion, notas, actualizado_en FROM duende_perfiles WHERE id = ?")
            .get(fila.id);
    }
    return fila;
}

/** Perfil de un usuario de Discord ({ id, username }), o null. */
function perfilDe(user) {
    return aPerfil(vincular(filaPorUsuario(user), user));
}

function perfilPorDiscordId(discordId) {
    return aPerfil(
        db
            .prepare(
                "SELECT id, discord_id, username, nombre, descripcion, notas, actualizado_en FROM duende_perfiles WHERE discord_id = ?",
            )
            .get(String(discordId)),
    );
}

/**
 * Vincula a su Discord ID los perfiles que solo tienen username, buscándolos entre los miembros
 * del servidor que ya estén en caché. Se llama al arrancar, justo después del backfill de roles, que
 * es quien los carga (pedirlos aquí otra vez hacía que Discord limitara la petición).
 * @returns {number} perfiles vinculados
 */
async function vincularPerfiles(guild) {
    const pendientes = db
        .prepare(
            "SELECT id, discord_id, username, nombre, descripcion, notas, actualizado_en FROM duende_perfiles WHERE discord_id IS NULL AND username IS NOT NULL",
        )
        .all();
    if (!pendientes.length || !guild) return 0;
    const miembros = guild.members.cache;
    let n = 0;
    for (const fila of pendientes) {
        const m = miembros.find((x) => x.user.username.toLowerCase() === fila.username.toLowerCase());
        if (!m || db.prepare("SELECT 1 FROM duende_perfiles WHERE discord_id = ?").get(m.id)) continue;
        vincular(fila, m.user);
        n++;
    }
    const sinVincular = pendientes.length - n;
    // El bot está en varios servidores: solo se informa donde se ha vinculado a alguien.
    if (n) {
        log.info(
            `Perfiles del Duende: ${n} vinculados a su Discord ID en ${guild.name}` +
                (sinVincular ? ` · ${sinVincular} sin encontrar (se vincularán cuando esa persona hable)` : ""),
        );
    }
    return n;
}

module.exports = {
    MAX_NOTAS,
    MAX_PERFIL_PROMPT,
    aPerfil,
    filaPorUsuario,
    vincular,
    perfilPorId,
    asegurarPerfil,
    listarPerfiles,
    perfilDe,
    perfilPorDiscordId,
    vincularPerfiles,
};
