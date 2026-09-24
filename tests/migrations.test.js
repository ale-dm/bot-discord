const Database = require("better-sqlite3");
const { runMigrations, listMigrations } = require("../src/core/migrations");

const tablas = (db) =>
    new Set(
        db
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
            .all()
            .map((r) => r.name),
    );
const columnas = (db, t) =>
    db
        .prepare(`PRAGMA table_info(${t})`)
        .all()
        .map((c) => c.name);

describe("migraciones", () => {
    test("en una BD vacía crean todo el esquema y no se repiten", () => {
        const db = new Database(":memory:");
        expect(runMigrations(db)).toBe(listMigrations().length);
        const t = tablas(db);
        for (const nombre of [
            "usuarios",
            "banco",
            "historial",
            "casino",
            "objeto",
            "tienda",
            "inventario",
            "xp_users",
            "xp_role_rewards",
            "apuestas_partidos",
            "quinielas",
            "cripto_ttcl",
            "guild_settings",
            "admin_audit",
            "plex_links",
            "duende_apodos",
            "schema_migrations",
        ]) {
            expect(t.has(nombre)).toBe(true);
        }
        expect(db.prepare("SELECT cantidad FROM slots_jackpot WHERE id = 1").get().cantidad).toBe(10000);
        expect(runMigrations(db)).toBe(0);
    });

    test("en una BD antigua añaden las columnas que faltan sin tocar los datos", () => {
        const db = new Database(":memory:");
        db.exec(`
            CREATE TABLE objeto (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL, descripcion TEXT NOT NULL, imagen TEXT, tipo TEXT, unico INTEGER DEFAULT 0);
            INSERT INTO objeto (nombre, descripcion) VALUES ('Palote', 'un palo');
            CREATE TABLE apuestas_partidos (id INTEGER PRIMARY KEY AUTOINCREMENT, match_id TEXT UNIQUE, estado TEXT DEFAULT 'abierto');
            CREATE TABLE xp_users (guildId TEXT NOT NULL, userId TEXT NOT NULL, xp INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (guildId, userId));
        `);
        runMigrations(db);
        expect(columnas(db, "objeto")).toEqual(expect.arrayContaining(["categoria", "rareza", "rolId", "efecto"]));
        expect(columnas(db, "apuestas_partidos")).toContain("deporte");
        expect(columnas(db, "xp_users")).toEqual(expect.arrayContaining(["streak_dias", "streak_last_day"]));
        expect(db.prepare("SELECT nombre FROM objeto").get().nombre).toBe("Palote");
    });

    test("002 conserva el canal de anuncios que se usaba y corrige el cooldown antiguo", () => {
        const db = new Database(":memory:");
        db.exec(`
            CREATE TABLE xp_config (guildId TEXT NOT NULL, clave TEXT NOT NULL, valor TEXT NOT NULL, PRIMARY KEY (guildId, clave));
            INSERT INTO xp_config VALUES ('g1', 'xp_announce_channel_id', ''), ('g1', 'xp_message_cooldown_sec', '60');
            INSERT INTO xp_config VALUES ('g2', 'xp_announce_channel_id', '999'), ('g2', 'xp_message_cooldown_sec', '30');
        `);
        runMigrations(db);
        const cfg = (g, k) => db.prepare("SELECT valor FROM xp_config WHERE guildId = ? AND clave = ?").get(g, k).valor;
        expect(cfg("g1", "xp_announce_channel_id")).toBe("874776941000020018");
        expect(cfg("g1", "xp_message_cooldown_sec")).toBe("15");
        expect(cfg("g2", "xp_announce_channel_id")).toBe("999");
        expect(cfg("g2", "xp_message_cooldown_sec")).toBe("30");
    });
});

describe("alta automática de usuarios (migración 005)", () => {
    test("crear la cuenta de banco de alguien que no está en usuarios ya no falla", () => {
        const db = new Database(":memory:");
        runMigrations(db);
        expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
        db.prepare("INSERT INTO banco (userId, saldo) VALUES (?, 1000)").run("nuevo");
        db.prepare("INSERT INTO historial (userId, fecha, descripcion, cantidad) VALUES (?, ?, ?, ?)").run("otro", "x", "y", 1);
        expect(
            db
                .prepare("SELECT id FROM usuarios ORDER BY id")
                .all()
                .map((r) => r.id),
        ).toEqual(["nuevo", "otro"]);
    });
});

describe("tablas antiguas (migración 007)", () => {
    test("se borran con sus claves foráneas rotas y su contenido se guarda en data/backups", () => {
        const fs = require("fs");
        const path = require("path");
        const { DATA_DIR } = require("../src/core/paths");
        const file = path.join(fs.mkdtempSync(path.join(require("os").tmpdir(), "el-duende-mig7-")), "banco.db");
        const db = new Database(file);
        // Como en la BD real: la clave foránea ya estaba rota (se creó con las comprobaciones desactivadas).
        db.pragma("foreign_keys = OFF");
        db.exec(`
            CREATE TABLE roles_backup_123 (id INTEGER PRIMARY KEY, nombre TEXT);
            CREATE TABLE role_groups (id INTEGER PRIMARY KEY);
            CREATE TABLE role_group_roles (group_id INTEGER REFERENCES role_groups(id), role_id INTEGER REFERENCES roles_backup_123(id));
            CREATE TABLE battlepass_seasons (id INTEGER PRIMARY KEY, nombre TEXT);
            INSERT INTO role_groups VALUES (1);
            INSERT INTO role_group_roles VALUES (1, 99);
            INSERT INTO battlepass_seasons VALUES (1, 'S1');
        `);
        db.pragma("foreign_keys = ON");
        runMigrations(db);
        const t = tablas(db);
        for (const n of ["roles_backup_123", "role_groups", "role_group_roles", "battlepass_seasons"]) expect(t.has(n)).toBe(false);
        expect(db.pragma("foreign_key_check")).toEqual([]);
        const copia = fs.readdirSync(path.join(DATA_DIR, "backups")).find((f) => f.startsWith("tablas-antiguas-"));
        const volcado = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "backups", copia), "utf8"));
        expect(volcado.battlepass_seasons).toEqual([{ id: 1, nombre: "S1" }]);
        db.close();
    });
});
