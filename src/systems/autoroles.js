// 🎭 Autoroles (F-AD-07, #539): lista de roles que cada persona se pone y se quita con un botón. La
// configuración vive en `guildSettings` (`autoroles.lista`, un JSON) y aquí solo se lee y se valida; los
// permisos y la jerarquía se comprueban en el comando, que es quien ve el servidor.
const guildSettings = require("./guildSettings");

const MAX = 20;
const MAX_ETIQUETA = 80;
const MAX_GRUPO = 20;

function normalizar(item) {
    return {
        roleId: String(item?.roleId || ""),
        etiqueta: String(item?.etiqueta || "").slice(0, MAX_ETIQUETA),
        emoji: String(item?.emoji || "").slice(0, 8),
        grupo: String(item?.grupo || "").slice(0, MAX_GRUPO),
    };
}

/** Los roles configurados, en orden. Si el JSON está roto, se comporta como si no hubiera ninguno. */
function lista(guildId) {
    const raw = guildSettings.getSettings(guildId).autoroles.lista;
    try {
        const filas = JSON.parse(raw || "[]");
        if (!Array.isArray(filas)) return [];
        return filas
            .map(normalizar)
            .filter((f) => f.roleId && f.etiqueta)
            .slice(0, MAX);
    } catch {
        return [];
    }
}

/** Guarda la lista (máximo 20) en el ajuste del servidor. */
function guardar(guildId, roles) {
    guildSettings.setSetting(
        guildId,
        "autoroles.lista",
        JSON.stringify(
            roles
                .map(normalizar)
                .filter((f) => f.roleId)
                .slice(0, MAX),
        ),
    );
}

/** Añade un rol. Valida duplicados y el tope; el rol en sí lo comprueba el comando. */
function anadir(guildId, item) {
    const filas = lista(guildId);
    if (filas.length >= MAX) return { ok: false, motivo: `Como mucho ${MAX} roles en el menú.` };
    const nuevo = normalizar(item);
    if (!nuevo.roleId) return { ok: false, motivo: "Falta el rol." };
    if (!nuevo.etiqueta) return { ok: false, motivo: "La etiqueta no puede estar vacía." };
    if (filas.some((f) => f.roleId === nuevo.roleId)) return { ok: false, motivo: "Ese rol ya está en el menú." };
    guardar(guildId, [...filas, nuevo]);
    return { ok: true, lista: [...filas, nuevo] };
}

/** Quita un rol del menú. */
function quitar(guildId, roleId) {
    const filas = lista(guildId);
    const quedan = filas.filter((f) => f.roleId !== String(roleId));
    if (quedan.length === filas.length) return { ok: false, motivo: "Ese rol no está en el menú." };
    guardar(guildId, quedan);
    return { ok: true, lista: quedan };
}

/** El grupo exclusivo de un rol (o "" si no está en ninguno). */
function grupoDe(guildId, roleId) {
    return lista(guildId).find((f) => f.roleId === String(roleId))?.grupo || "";
}

module.exports = { MAX, MAX_ETIQUETA, MAX_GRUPO, lista, guardar, anadir, quitar, grupoDe };
