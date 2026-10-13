// 💬 Presentación personal (#430): una frase sobre uno mismo que sale en 👤 Perfil de /perfil para quien abre el perfil.
// Se escribe con /presentacion (o con ✏️ Editar en el perfil propio); un texto vacío la borra.
const db = require("../core/db");

const MAX_PRESENTACION = 150;

/** La presentación guardada de alguien, o null si no tiene. */
function obtener(userId) {
    return db.prepare("SELECT texto FROM presentaciones WHERE userId = ?").get(String(userId))?.texto ?? null;
}

/**
 * Guarda (o, con un texto vacío, borra) la presentación. Se limpia (espacios y saltos de línea) y se rechaza si pasa de
 * MAX_PRESENTACION caracteres.
 * @returns {{ ok: true, texto: string | null } | { ok: false, mensaje: string }} `texto` null = borrada
 */
function guardar(userId, escrito) {
    const texto = String(escrito ?? "")
        .replace(/\s+/g, " ")
        .trim();
    if (texto.length > MAX_PRESENTACION) {
        return {
            ok: false,
            mensaje: `❌ La presentación puede tener como mucho ${MAX_PRESENTACION} caracteres (has puesto ${texto.length}).`,
        };
    }
    if (!texto) {
        db.prepare("DELETE FROM presentaciones WHERE userId = ?").run(String(userId));
        return { ok: true, texto: null };
    }
    db.prepare(
        `INSERT INTO presentaciones (userId, texto, actualizado_en) VALUES (?, ?, ?)
         ON CONFLICT(userId) DO UPDATE SET texto = excluded.texto, actualizado_en = excluded.actualizado_en`,
    ).run(String(userId), texto, Date.now());
    return { ok: true, texto };
}

/**
 * El texto listo para enseñarlo: una mención (@everyone, @here, <@id>) se rompe con un carácter invisible, así que no
 * avisa a nadie ni siquiera si el mensaje se enviara con menciones permitidas.
 */
function escapar(texto) {
    return String(texto).replace(/@/g, "@\u200b");
}

module.exports = { MAX_PRESENTACION, obtener, guardar, escapar };
