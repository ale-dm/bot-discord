// 📈 Niveles, XP y logros, fase 6 (#339, #346, #352, #362, #369, #373, #378, #383, #358):
// - xp_users.streak_max: la mejor racha de cada persona (parte de la actual).
// - xp_users.streak_gracia_mes / streak_gracia_usados: los días de gracia gastados en el mes natural en curso.
// - xp_users.anuncios_off: la persona no quiere que se anuncie su subida de nivel.
// - xp_users.ultimo_recordatorio_logros: cuándo (ms) se le mandó el último DM de logros sin reclamar.
// - xp_users.ultima_reaccion: cuándo (ms) recibió XP por última vez por una reacción (cooldown por autor).
// - xp_diaria: la XP final ganada cada día (hora de Madrid), para el tope diario y los logros de un día. Solo se necesita
//   el día actual: se borra lo de más de una semana (systems/xp/diaria).
// - xp_ignored_roles: roles cuyos miembros no ganan XP.
// - xp_channel_multipliers: multiplicador de XP de un canal (el 0 lo deja como ignorado; el 1 no se guarda).
const { addColumnIfMissing } = require("./index");

function up(db) {
    addColumnIfMissing(db, "xp_users", "streak_max", "INTEGER NOT NULL DEFAULT 0");
    addColumnIfMissing(db, "xp_users", "streak_gracia_mes", "TEXT");
    addColumnIfMissing(db, "xp_users", "streak_gracia_usados", "INTEGER NOT NULL DEFAULT 0");
    addColumnIfMissing(db, "xp_users", "anuncios_off", "INTEGER NOT NULL DEFAULT 0");
    addColumnIfMissing(db, "xp_users", "ultimo_recordatorio_logros", "INTEGER");
    addColumnIfMissing(db, "xp_users", "ultima_reaccion", "INTEGER");
    db.exec(`
        UPDATE xp_users SET streak_max = streak_dias WHERE streak_max < streak_dias;
        CREATE TABLE IF NOT EXISTS xp_diaria (
            guildId TEXT NOT NULL,
            userId TEXT NOT NULL,
            dia TEXT NOT NULL,
            xp INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (guildId, userId, dia)
        );
        CREATE INDEX IF NOT EXISTS idx_xp_diaria_dia ON xp_diaria(dia);
        CREATE TABLE IF NOT EXISTS xp_ignored_roles (
            guildId TEXT NOT NULL,
            roleId TEXT NOT NULL,
            roleName TEXT,
            PRIMARY KEY (guildId, roleId)
        );
        CREATE TABLE IF NOT EXISTS xp_channel_multipliers (
            guildId TEXT NOT NULL,
            channelId TEXT NOT NULL,
            multiplicador REAL NOT NULL,
            PRIMARY KEY (guildId, channelId)
        );
    `);
}

module.exports = { up };
