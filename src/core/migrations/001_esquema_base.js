// Esquema completo de la BD tal y como estaba en producción el 2026-09-24, cuando se
// centralizó (antes lo creaba cada módulo al cargarse). Todo es IF NOT EXISTS / "si falta":
// en una BD existente no cambia nada; en una nueva crea todo desde cero.
const { addColumnIfMissing } = require("./index");

const TABLES = `
-- Usuarios y economía
CREATE TABLE IF NOT EXISTS usuarios (
    id TEXT PRIMARY KEY,
    nombre TEXT,
    tag TEXT,
    fechaRegistro TEXT
);
CREATE TABLE IF NOT EXISTS banco (
    userId TEXT PRIMARY KEY,
    saldo INTEGER NOT NULL DEFAULT 1000,
    enMano INTEGER NOT NULL DEFAULT 0,
    ultimoSueldo INTEGER DEFAULT 0,
    FOREIGN KEY(userId) REFERENCES usuarios(id)
);
CREATE TABLE IF NOT EXISTS historial (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId TEXT NOT NULL,
    fecha TEXT NOT NULL,
    descripcion TEXT NOT NULL,
    cantidad INTEGER NOT NULL,
    FOREIGN KEY(userId) REFERENCES usuarios(id)
);
CREATE TABLE IF NOT EXISTS config (clave TEXT PRIMARY KEY, valor TEXT);

-- Objetos, tienda e inventario
CREATE TABLE IF NOT EXISTS objeto (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    descripcion TEXT NOT NULL,
    imagen TEXT,
    tipo TEXT,
    unico INTEGER DEFAULT 0,
    categoria TEXT,
    rareza TEXT,
    rolId TEXT,
    efecto TEXT
);
CREATE TABLE IF NOT EXISTS tienda (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    objetoId INTEGER NOT NULL,
    precio INTEGER NOT NULL,
    stock INTEGER,
    FOREIGN KEY(objetoId) REFERENCES objeto(id)
);
CREATE TABLE IF NOT EXISTS inventario (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId TEXT NOT NULL,
    itemId INTEGER NOT NULL,
    fecha TEXT NOT NULL,
    FOREIGN KEY(userId) REFERENCES usuarios(id)
);

-- Casino
CREATE TABLE IF NOT EXISTS casino (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId TEXT NOT NULL,
    juego TEXT NOT NULL,
    fecha TEXT NOT NULL,
    apuesta INTEGER NOT NULL,
    resultado INTEGER NOT NULL,
    detalle TEXT,
    FOREIGN KEY(userId) REFERENCES usuarios(id)
);
CREATE TABLE IF NOT EXISTS casino_partidas_activas (
    userId TEXT NOT NULL,
    juego TEXT NOT NULL,
    guildId TEXT,
    apuesta INTEGER NOT NULL,
    creada_en INTEGER NOT NULL,
    PRIMARY KEY (userId, juego)
);
CREATE TABLE IF NOT EXISTS slots_jackpot (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    cantidad INTEGER NOT NULL DEFAULT 10000
);

-- Apuestas deportivas y quinielas
CREATE TABLE IF NOT EXISTS apuestas_partidos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id TEXT UNIQUE,
    home_team TEXT,
    away_team TEXT,
    start_time TEXT,
    cuota_home REAL,
    cuota_draw REAL,
    cuota_away REAL,
    estado TEXT DEFAULT 'abierto',
    deporte TEXT DEFAULT 'laliga'
);
CREATE TABLE IF NOT EXISTS apuestas_usuario (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    match_id TEXT,
    eleccion TEXT,
    cantidad INTEGER,
    cuota REAL,
    pagado INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS quinielas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deporte TEXT NOT NULL,
    jornada TEXT NOT NULL,
    estado TEXT NOT NULL DEFAULT 'abierta',
    creador_id TEXT,
    creada_en TEXT NOT NULL,
    cerrada_en TEXT
);
CREATE TABLE IF NOT EXISTS quiniela_partidos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quiniela_id INTEGER NOT NULL,
    match_id TEXT NOT NULL,
    orden INTEGER NOT NULL,
    home_team TEXT NOT NULL,
    away_team TEXT NOT NULL,
    start_time TEXT NOT NULL,
    resultado_final TEXT,
    FOREIGN KEY(quiniela_id) REFERENCES quinielas(id)
);
CREATE TABLE IF NOT EXISTS quiniela_apuestas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quiniela_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    predicciones TEXT NOT NULL,
    cantidad INTEGER NOT NULL,
    aciertos INTEGER DEFAULT 0,
    premio INTEGER DEFAULT 0,
    pagado INTEGER DEFAULT 0,
    creada_en TEXT NOT NULL,
    FOREIGN KEY(quiniela_id) REFERENCES quinielas(id)
);

-- Cripto
CREATE TABLE IF NOT EXISTS cripto_carteras (
    userId TEXT NOT NULL,
    cripto TEXT NOT NULL,
    cantidad REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (userId, cripto)
);
CREATE TABLE IF NOT EXISTS cripto_ttcl (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    circulacion REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS cripto_ttcl_precios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    precio REAL NOT NULL,
    timestamp INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cripto_historial (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId TEXT NOT NULL,
    tipo TEXT NOT NULL,
    cripto TEXT NOT NULL,
    cantidad REAL NOT NULL,
    precio REAL NOT NULL,
    monedas INTEGER NOT NULL,
    timestamp INTEGER NOT NULL
);

-- XP y niveles
CREATE TABLE IF NOT EXISTS xp_users (
    guildId TEXT NOT NULL,
    userId TEXT NOT NULL,
    xp INTEGER NOT NULL DEFAULT 0,
    nivel INTEGER NOT NULL DEFAULT 0,
    xp_total INTEGER NOT NULL DEFAULT 0,
    ultimo_msg INTEGER NOT NULL DEFAULT 0,
    voz_inicio INTEGER,
    voz_segundos INTEGER NOT NULL DEFAULT 0,
    streak_dias INTEGER NOT NULL DEFAULT 0,
    streak_last_day TEXT,
    PRIMARY KEY (guildId, userId)
);
CREATE TABLE IF NOT EXISTS xp_config (
    guildId TEXT NOT NULL,
    clave TEXT NOT NULL,
    valor TEXT NOT NULL,
    PRIMARY KEY (guildId, clave)
);
CREATE TABLE IF NOT EXISTS xp_role_rewards (
    guildId TEXT NOT NULL,
    nivel INTEGER NOT NULL,
    roleId TEXT NOT NULL,
    roleName TEXT,
    PRIMARY KEY (guildId, nivel, roleId)
);
CREATE TABLE IF NOT EXISTS xp_ignored_channels (
    guildId TEXT NOT NULL,
    channelId TEXT NOT NULL,
    channelName TEXT,
    PRIMARY KEY (guildId, channelId)
);
CREATE TABLE IF NOT EXISTS xp_level_titles (
    guildId TEXT NOT NULL,
    nivel INTEGER NOT NULL,
    title TEXT NOT NULL,
    emoji TEXT,
    PRIMARY KEY (guildId, nivel)
);
CREATE TABLE IF NOT EXISTS xp_level_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guildId TEXT NOT NULL,
    userId TEXT NOT NULL,
    nivel INTEGER NOT NULL,
    createdAt INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS xp_user_overrides (
    guildId TEXT NOT NULL,
    userId TEXT NOT NULL,
    costMultiplier REAL NOT NULL DEFAULT 1,
    PRIMARY KEY (guildId, userId)
);

-- Logros
CREATE TABLE IF NOT EXISTS achievements_progress (
    guildId TEXT NOT NULL,
    userId TEXT NOT NULL,
    achievementId TEXT NOT NULL,
    progress REAL NOT NULL DEFAULT 0,
    completedAt INTEGER,
    claimedAt INTEGER,
    PRIMARY KEY (guildId, userId, achievementId)
);

-- Ajustes, permisos, límites y auditoría
CREATE TABLE IF NOT EXISTS guild_settings (
    guildId TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT,
    PRIMARY KEY (guildId, key)
);
CREATE TABLE IF NOT EXISTS command_acl (
    guildId TEXT NOT NULL,
    command TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    allowedChannels TEXT,
    allowedRoles TEXT,
    PRIMARY KEY (guildId, command)
);
CREATE TABLE IF NOT EXISTS action_limits (
    guildId TEXT NOT NULL,
    scope TEXT NOT NULL,
    userId TEXT NOT NULL,
    lastTs INTEGER NOT NULL DEFAULT 0,
    day TEXT,
    dayCount INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guildId, scope, userId)
);
CREATE TABLE IF NOT EXISTS admin_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guildId TEXT NOT NULL,
    actorId TEXT NOT NULL,
    action TEXT NOT NULL,
    details TEXT,
    createdAt INTEGER NOT NULL
);

-- Plex y Seerr
CREATE TABLE IF NOT EXISTS plex_links (
    guildId TEXT NOT NULL,
    discordUserId TEXT NOT NULL,
    tautulliUserId TEXT NOT NULL,
    plexUsername TEXT,
    linkedAt INTEGER NOT NULL,
    PRIMARY KEY (guildId, discordUserId)
);
CREATE TABLE IF NOT EXISTS plex_allowed_channels (
    guildId TEXT NOT NULL,
    channelId TEXT NOT NULL,
    channelName TEXT,
    PRIMARY KEY (guildId, channelId)
);
CREATE TABLE IF NOT EXISTS plex_novedades_state (
    guildId TEXT PRIMARY KEY,
    lastAddedAt INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS seerr_allowed_channels (
    guildId TEXT NOT NULL,
    channelId TEXT NOT NULL,
    channelName TEXT,
    PRIMARY KEY (guildId, channelId)
);
`;

// Índices de las tablas que crecen sin parar (antes en core/dbIndexes.js).
const INDEXES = `
CREATE INDEX IF NOT EXISTS idx_ttcl_precios_ts ON cripto_ttcl_precios (timestamp);
CREATE INDEX IF NOT EXISTS idx_historial_user_fecha ON historial (userId, fecha);
CREATE INDEX IF NOT EXISTS idx_historial_fecha ON historial (fecha);
CREATE INDEX IF NOT EXISTS idx_casino_user_juego ON casino (userId, juego);
CREATE INDEX IF NOT EXISTS idx_apuestas_usuario_match ON apuestas_usuario (match_id, pagado);
CREATE INDEX IF NOT EXISTS idx_cripto_historial_user_ts ON cripto_historial (userId, timestamp);
`;

function up(db) {
    // Una versión muy antigua de xp_role_rewards solo admitía un rol por nivel.
    const rr = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'xp_role_rewards'").get();
    if (rr?.sql && !rr.sql.includes("nivel, roleId")) {
        db.exec(`
            ALTER TABLE xp_role_rewards RENAME TO xp_role_rewards_old;
            CREATE TABLE xp_role_rewards (
                guildId TEXT NOT NULL,
                nivel INTEGER NOT NULL,
                roleId TEXT NOT NULL,
                roleName TEXT,
                PRIMARY KEY (guildId, nivel, roleId)
            );
            INSERT OR IGNORE INTO xp_role_rewards SELECT guildId, nivel, roleId, roleName FROM xp_role_rewards_old;
            DROP TABLE xp_role_rewards_old;
        `);
    }

    db.exec(TABLES);

    // Columnas que se añadieron después de crear algunas tablas (BD antiguas).
    addColumnIfMissing(db, "apuestas_partidos", "deporte", "TEXT DEFAULT 'laliga'");
    addColumnIfMissing(db, "xp_users", "streak_dias", "INTEGER NOT NULL DEFAULT 0");
    addColumnIfMissing(db, "xp_users", "streak_last_day", "TEXT");
    for (const col of ["categoria", "rareza", "rolId", "efecto"]) addColumnIfMissing(db, "objeto", col, "TEXT");

    // Filas únicas que el código da por existentes.
    db.prepare("INSERT OR IGNORE INTO slots_jackpot (id, cantidad) VALUES (1, 10000)").run();
    db.prepare("INSERT OR IGNORE INTO cripto_ttcl (id, circulacion) VALUES (1, 0)").run();

    db.exec(INDEXES);
}

module.exports = { up };
