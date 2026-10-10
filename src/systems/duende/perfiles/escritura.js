// Escritura de los perfiles de personas: cambiar sus datos desde el panel, añadir y olvidar notas de /duende recuerda.
const db = require("../../../core/db");
const { MAX_NOTAS, aPerfil, filaPorUsuario, vincular } = require("./lectura");

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

module.exports = { actualizarPerfil, borrarNotasPorId, borrarPerfilPorId, anotar, olvidarNotas, guardarDescripcion };
