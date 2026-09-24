// Borra las tablas de versiones antiguas del bot que ya no usa ningún código: el juego de roles
// (games, roles, role_groups, actions...), un prototipo del pase de batalla (battlepass_*), las
// sesiones de una web que ya no existe y una copia manual de roles. Varias tenían claves foráneas
// rotas (apuntaban a roles_backup_*), que hacían fallar PRAGMA foreign_key_check.
//
// Antes de borrarlas se guarda su contenido en data/backups/tablas-antiguas-<fecha>.json, por si
// algo (p. ej. las recompensas del prototipo del pase de batalla) sirve para más adelante.
const fs = require("fs");
const path = require("path");
const { DATA_DIR } = require("../paths");

const FIJAS = [
    "actions",
    "battlepass_claims",
    "battlepass_daily_caps",
    "battlepass_progress",
    "battlepass_rewards",
    "battlepass_seasons",
    "game_logs",
    "game_players",
    "game_roles_assigned",
    "game_votes",
    "games",
    "role_group_roles",
    "role_groups",
    "role_incompatibilities",
    "role_slots_by_playercount",
    "role_subgroups",
    "roles",
    "web_sessions",
];

function up(db, { log }) {
    const existentes = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((r) => r.name);
    const borrar = existentes.filter((t) => FIJAS.includes(t) || /^roles_backup_\d+$/.test(t));
    if (!borrar.length) return;

    const volcado = {};
    let filas = 0;
    for (const t of borrar) {
        volcado[t] = db.prepare(`SELECT * FROM "${t}"`).all();
        filas += volcado[t].length;
    }
    // BD en memoria (tests) o vacía: no hace falta copia.
    if (filas > 0 && db.name && db.name !== ":memory:") {
        const dir = path.join(DATA_DIR, "backups");
        fs.mkdirSync(dir, { recursive: true });
        const fichero = path.join(dir, `tablas-antiguas-${new Date().toISOString().slice(0, 10)}.json`);
        fs.writeFileSync(fichero, JSON.stringify(volcado, null, 2));
        log.info(`Contenido de ${borrar.length} tablas antiguas (${filas} filas) guardado en ${fichero}`);
    }

    // Se borran entre ellas en cualquier orden: las claves foráneas se comprueban al final.
    db.pragma("defer_foreign_keys = ON");
    for (const t of borrar) db.exec(`DROP TABLE "${t}"`);
    log.info(`Borradas ${borrar.length} tablas antiguas: ${borrar.join(", ")}`);
}

module.exports = { up };
