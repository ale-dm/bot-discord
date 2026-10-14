// Histórico de la clasificación semanal (#360) y premios ganados por persona (#355). Se guarda una fila por categoría y semana con el
// ganador (`valor` es el dato que lo hizo ganar: dinero, XP, beneficio o días). Las semanas anteriores a esta función no tienen filas.
const db = require("../../core/db");

/** Guarda los ganadores de una semana (`g`: { rico, activo, apostador, constante }, cada uno con `userId` o null). Para la transacción del pago. */
function guardar(guildId, semana, g) {
    const valores = {
        rico: g.rico?.total,
        activo: g.activo?.xp,
        apostador: g.apostador?.beneficio,
        constante: g.constante?.dias,
    };
    const insertar = db.prepare(
        "INSERT OR REPLACE INTO clasificacion_historial (guildId, semana, categoria, userId, valor) VALUES (?, ?, ?, ?, ?)",
    );
    for (const [categoria, valor] of Object.entries(valores)) {
        if (g[categoria]) insertar.run(guildId, semana, categoria, String(g[categoria].userId), valor);
    }
}

/** Las últimas semanas con ganadores, la más reciente primero: [{ semana, ganadores: { categoria: { userId, valor } } }]. */
function ultimasSemanas(guildId, cuantas = 8) {
    const semanas = db
        .prepare("SELECT DISTINCT semana FROM clasificacion_historial WHERE guildId = ? ORDER BY semana DESC LIMIT ?")
        .all(guildId, cuantas)
        .map((r) => r.semana);
    return semanas.map((semana) => ({
        semana,
        ganadores: Object.fromEntries(
            db
                .prepare("SELECT categoria, userId, valor FROM clasificacion_historial WHERE guildId = ? AND semana = ?")
                .all(guildId, semana)
                .map((r) => [r.categoria, { userId: r.userId, valor: r.valor }]),
        ),
    }));
}

/** Los premios semanales que ha cobrado alguien: { total, ultimo } (fecha ISO del último) (#355). Solo cuenta los de la clasificación. */
function premiosDe(userId) {
    const r = db
        .prepare(
            `SELECT COUNT(*) AS total, MAX(fecha) AS ultimo FROM historial
             WHERE userId = ? AND tipo = 'premio' AND descripcion LIKE 'Clasificación semanal:%'`,
        )
        .get(String(userId));
    return { total: r.total, ultimo: r.ultimo };
}

module.exports = { guardar, ultimasSemanas, premiosDe };
