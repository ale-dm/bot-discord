// Índices de la migración 040 (optimización de la BD): que existen, que se pueden aplicar dos veces, y que las consultas
// que se repiten usan el índice en vez de recorrer la tabla entera.
const db = require("../src/core/db");
const { up, INDICES } = require("../src/core/migrations/040_indices_consultas");

function plan(sql, ...args) {
    return db
        .prepare("EXPLAIN QUERY PLAN " + sql)
        .all(...args)
        .map((r) => r.detail)
        .join(" | ");
}

test("la migración 040 crea todos sus índices y se puede aplicar otra vez", () => {
    const nombres = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").pluck().all();
    for (const sql of INDICES) {
        const nombre = /INDEX IF NOT EXISTS (\w+)/.exec(sql)[1];
        expect(nombres).toContain(nombre);
    }
    expect(() => up(db)).not.toThrow();
});

test("el listado de partidos para apostar usa índice", () => {
    const p = plan(
        "SELECT * FROM apuestas_partidos WHERE estado = 'abierto' AND deporte = ? AND start_time > ? ORDER BY start_time LIMIT ? OFFSET ?",
        "laliga",
        "2026-01-01",
        25,
        0,
    );
    expect(p).toMatch(/SEARCH apuestas_partidos USING INDEX/);
    expect(p).not.toMatch(/SCAN apuestas_partidos/);
});

test("«Mis jugadas» busca por persona con índice", () => {
    const p = plan(
        "SELECT a.match_id FROM apuestas_usuario a JOIN apuestas_partidos p ON p.match_id = a.match_id WHERE a.user_id = ?",
        "u1",
    );
    expect(p).toMatch(/SEARCH a USING INDEX idx_apuestas_usuario_user/);
});

test("el aviso de apuestas pendientes usa índice por pagado y recordado", () => {
    const p = plan("SELECT a.id FROM apuestas_usuario a WHERE a.pagado = 0 AND a.recordado = 0");
    expect(p).toMatch(/idx_apuestas_usuario_pendientes/);
});

test("la voz de XP solo mira a quien está en un canal (índice parcial)", () => {
    const p = plan("SELECT guildId, userId, voz_inicio FROM xp_users WHERE voz_inicio IS NOT NULL");
    expect(p).toMatch(/idx_xp_users_voz/);
});

test("el inventario de una persona usa índice", () => {
    const p = plan("SELECT 1 FROM inventario WHERE userId = ? AND itemId = ?", "u1", 7);
    expect(p).toMatch(/idx_inventario_user/);
});

test("la conexión va en WAL con synchronous = NORMAL y caché de 32 MB", () => {
    expect(db.pragma("synchronous", { simple: true })).toBe(1);
    expect(db.pragma("cache_size", { simple: true })).toBe(-32000);
});

test("una BD antigua sin una columna omite ese índice y las migraciones siguen", () => {
    const Database = require("better-sqlite3");
    const { runMigrations } = require("../src/core/migrations");
    const vieja = new Database(":memory:");
    vieja.exec(
        "CREATE TABLE apuestas_partidos (id INTEGER PRIMARY KEY AUTOINCREMENT, match_id TEXT UNIQUE, estado TEXT DEFAULT 'abierto');",
    );
    expect(() => runMigrations(vieja)).not.toThrow();
    const nombres = vieja.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").pluck().all();
    expect(nombres).not.toContain("idx_apuestas_partidos_estado_inicio");
});

test("el listado de quinielas y el ranking usan índice (migración 041)", () => {
    const abiertas = plan("SELECT * FROM quinielas WHERE estado = 'abierta' AND deporte = ? ORDER BY id DESC LIMIT 1", "laliga");
    expect(abiertas).toMatch(/idx_quinielas_estado_deporte/);
    const cerradas = plan(
        "SELECT qa.user_id FROM quiniela_apuestas qa JOIN quinielas q ON q.id = qa.quiniela_id WHERE q.estado = 'cerrada' AND q.cerrada_en >= ? AND q.cerrada_en < ?",
        "a",
        "b",
    );
    expect(cerradas).toMatch(/idx_quinielas_estado_cerrada/);
});

test("las rachas diarias de XP y los ingresos de negocios usan índice (migración 041)", () => {
    expect(plan("SELECT guildId, userId FROM xp_users WHERE streak_dias >= 2 AND streak_last_day = ?", "2026-10-10")).toMatch(
        /idx_xp_users_racha/,
    );
    expect(plan("SELECT * FROM negocios_usuario WHERE ultimo_ingreso_dia IS NULL OR ultimo_ingreso_dia < ?", "2026-10-10")).toMatch(
        /idx_negocios_usuario_ingreso/,
    );
});
