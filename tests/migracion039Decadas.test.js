// Migración 039: los trofeos de década creados antes pasan a llevar el año entero (#218). Solo cambia el texto de los
// que creó el código; los que puso Gemini (nombre_ia = 1) no se tocan.
const Database = require("better-sqlite3");
const { runMigrations } = require("../src/core/migrations");
const { up } = require("../src/core/migrations/039_decadas_nombre");

function bd() {
    const db = new Database(":memory:");
    runMigrations(db);
    return db;
}

function insertar(db, fila) {
    db.prepare(
        `INSERT INTO plex_trofeos (guildId, id, tipo, nombre, descripcion, objetivo, recompensa, anime, nombre_ia, creado)
         VALUES (?, ?, ?, ?, ?, 1, 100, 0, ?, 0)`,
    ).run(fila.guildId, fila.id, fila.tipo, fila.nombre, fila.descripcion, fila.nombre_ia ?? 0);
}

test("los trofeos de década de dos dígitos pasan al año entero", () => {
    const db = bd();
    insertar(db, {
        guildId: "g",
        id: "decada:1980",
        tipo: "decada",
        nombre: "Máquina del tiempo: los 80",
        descripcion: "Ve 10 películas de los años 80",
    });
    insertar(db, {
        guildId: "g",
        id: "decada:1920",
        tipo: "decada",
        nombre: "Máquina del tiempo: los 20",
        descripcion: "Ve 10 películas de los años 1920",
    });
    up(db);
    const filas = Object.fromEntries(
        db
            .prepare("SELECT id, nombre, descripcion FROM plex_trofeos")
            .all()
            .map((f) => [f.id, f]),
    );
    expect(filas["decada:1980"]).toMatchObject({
        nombre: "Máquina del tiempo: los años 1980",
        descripcion: "Ve 10 películas de los años 1980",
    });
    expect(filas["decada:1920"]).toMatchObject({
        nombre: "Máquina del tiempo: los años 1920",
        descripcion: "Ve 10 películas de los años 1920",
    });
});

test("no toca los que puso Gemini ni los de otro tipo", () => {
    const db = bd();
    insertar(db, {
        guildId: "g",
        id: "decada:1950",
        tipo: "decada",
        nombre: "Máquina del tiempo: los 50 (de Gemini)",
        descripcion: "Ve 10 películas de los años 50",
        nombre_ia: 1,
    });
    insertar(db, {
        guildId: "g",
        id: "genero:drama:10",
        tipo: "genero",
        nombre: "Máquina del tiempo: los 80",
        descripcion: "Ve 10 películas de los años 80",
    });
    up(db);
    const fila = db.prepare("SELECT nombre FROM plex_trofeos WHERE id = 'decada:1950'").get();
    expect(fila.nombre).toBe("Máquina del tiempo: los 50 (de Gemini)");
    expect(db.prepare("SELECT nombre FROM plex_trofeos WHERE id = 'genero:drama:10'").get().nombre).toBe("Máquina del tiempo: los 80");
});

test("aplicarla otra vez no cambia nada", () => {
    const db = bd();
    insertar(db, {
        guildId: "g",
        id: "decada:1980",
        tipo: "decada",
        nombre: "Máquina del tiempo: los 80",
        descripcion: "Ve 10 películas de los años 80",
    });
    up(db);
    const primera = db.prepare("SELECT nombre, descripcion FROM plex_trofeos").all();
    up(db);
    expect(db.prepare("SELECT nombre, descripcion FROM plex_trofeos").all()).toEqual(primera);
});
