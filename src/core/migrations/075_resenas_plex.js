// 🍿 Reseñas de Plex (#565): la nota (en medias estrellas, de 1 a 10), el texto, los spoilers y el «me gusta» de lo
// que ha visto cada persona. `plex_resenas_pedidas` guarda a quién se le ha preguntado ya (el DM llega en #566) y qué
// decidió. `plex_preferencias.ocultar_resenas` es la privacidad global de cada persona.
const { addColumnIfMissing } = require("./index");

function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS plex_resenas (
            guildId TEXT NOT NULL,
            userId TEXT NOT NULL,
            clave TEXT NOT NULL,                -- peli:<titulo normalizado>|<anio> | serie:<titulo>[|t<n>]
            tipo TEXT NOT NULL,                 -- movie | show
            titulo TEXT NOT NULL,
            anio INTEGER,
            nota INTEGER NOT NULL,              -- medias estrellas: 1 = ½, 2 = ★, 10 = ★★★★★
            texto TEXT,
            spoilers INTEGER NOT NULL DEFAULT 0,
            me_gusta INTEGER NOT NULL DEFAULT 0,
            oculto INTEGER NOT NULL DEFAULT 0,
            creado_en INTEGER NOT NULL,
            actualizado_en INTEGER NOT NULL,
            PRIMARY KEY (guildId, userId, clave)
        );
    `);
    db.exec("CREATE INDEX IF NOT EXISTS idx_plex_resenas_titulo ON plex_resenas (guildId, clave)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_plex_resenas_usuario ON plex_resenas (guildId, userId, actualizado_en DESC)");
    db.exec(`
        CREATE TABLE IF NOT EXISTS plex_resenas_pedidas (
            id INTEGER PRIMARY KEY AUTOINCREMENT, -- va en el customId del DM
            guildId TEXT NOT NULL,
            userId TEXT NOT NULL,
            clave TEXT NOT NULL,
            titulo TEXT NOT NULL,
            pedido_en INTEGER NOT NULL,
            decision TEXT,                        -- NULL esperando | puntuada | pasada | cerrado
            UNIQUE (guildId, userId, clave)
        );
    `);
    db.exec("CREATE INDEX IF NOT EXISTS idx_plex_resenas_pedidas_pend ON plex_resenas_pedidas (guildId, decision, pedido_en)");
    addColumnIfMissing(db, "plex_preferencias", "ocultar_resenas", "INTEGER NOT NULL DEFAULT 0");
}

module.exports = { up };
