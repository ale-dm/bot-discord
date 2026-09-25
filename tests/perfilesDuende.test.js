// Personalidades y perfiles del Duende en la BD: importación de los JSON antiguos (por username)
// y vinculación a Discord ID.
const fs = require("fs");
const os = require("os");
const path = require("path");
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "el-duende-perfiles-"));

const db = require("../src/core/db");
const perfiles = require("../src/systems/duende/perfiles");

const DATA_DIR = process.env.DATA_DIR;
const limpiar = () => db.exec("DELETE FROM duende_perfiles; DELETE FROM duende_personalidades; DELETE FROM duende_canales;");

beforeEach(limpiar);

test("importa los JSON antiguos una sola vez y los renombra", () => {
    fs.writeFileSync(
        path.join(DATA_DIR, "duende-personalities.json"),
        JSON.stringify({
            personalities: [{ id: "borde", title: "Borde", systemInstructions: "Sé borde." }],
            persons: [{ id: "raul_02", name: "Raúl", description: "Del Betis", notas: ["juega al pádel"] }],
        }),
    );
    fs.writeFileSync(path.join(DATA_DIR, "duende-config.json"), JSON.stringify({ canal1: "borde" }));

    perfiles.importarJsonSiExiste();

    expect(perfiles.obtenerPersonalidad("borde")).toEqual({ id: "borde", title: "Borde", systemInstructions: "Sé borde." });
    expect(perfiles.personalidadDeCanal("canal1")).toBe("borde");
    expect(perfiles.listarPerfiles()).toMatchObject([{ discordId: null, username: "raul_02", name: "Raúl", notas: ["juega al pádel"] }]);
    expect(fs.existsSync(path.join(DATA_DIR, "duende-personalities.json.importado"))).toBe(true);
    expect(fs.existsSync(path.join(DATA_DIR, "duende-config.json.importado"))).toBe(true);
});

test("sin personalidades crea las de por defecto", () => {
    perfiles.importarJsonSiExiste();
    expect(perfiles.listarPersonalidades().map((p) => p.id)).toEqual(["default", "inteligente"]);
});

test("un perfil importado por username se vincula al Discord ID y sobrevive al cambio de username", () => {
    db.prepare("INSERT INTO duende_perfiles (username, nombre, descripcion) VALUES ('raul_02', 'Raúl', 'Del Betis')").run();

    // Primera vez que habla: se reconoce por username y queda vinculado.
    expect(perfiles.perfilDe({ id: "111", username: "raul_02" })).toMatchObject({ discordId: "111", description: "Del Betis" });
    // Cambia de username: sigue siendo él.
    expect(perfiles.perfilDe({ id: "111", username: "raul_nuevo" })).toMatchObject({ discordId: "111", username: "raul_nuevo" });
    // Y alguien que coja su username antiguo no hereda el perfil.
    expect(perfiles.perfilDe({ id: "222", username: "raul_02" })).toBeNull();
});

test("vincularPerfiles busca a los miembros del servidor (en caché) por username", async () => {
    db.prepare("INSERT INTO duende_perfiles (username, nombre) VALUES ('ana_99', 'Ana'), ('nadie', 'Nadie')").run();
    const miembros = new Map([["333", { id: "333", user: { id: "333", username: "Ana_99" } }]]);
    miembros.find = (fn) => [...miembros.values()].find(fn);
    const guild = { name: "test", members: { fetch: jest.fn(), cache: miembros } };

    expect(await perfiles.vincularPerfiles(guild)).toBe(1);
    expect(guild.members.fetch).not.toHaveBeenCalled();
    expect(perfiles.perfilPorDiscordId("333")).toMatchObject({ name: "Ana" });
});

test("anotar guarda como mucho MAX_NOTAS y olvidar conserva la descripción", () => {
    const u = { id: "444", username: "pepe" };
    perfiles.guardarDescripcion({ discordId: "444", username: "pepe", nombre: "Pepe", descripcion: "Perfil base" });
    for (let i = 0; i < perfiles.MAX_NOTAS + 3; i++) perfiles.anotar(u, `nota ${i}`);
    const p = perfiles.perfilDe(u);
    expect(p.notas).toHaveLength(perfiles.MAX_NOTAS);
    expect(p.notas.at(-1)).toBe(`nota ${perfiles.MAX_NOTAS + 2}`);

    expect(perfiles.olvidarNotas(u)).toHaveLength(perfiles.MAX_NOTAS);
    expect(perfiles.perfilDe(u)).toMatchObject({ description: "Perfil base", notas: [] });
});

test("olvidar a alguien sin descripción borra el perfil", () => {
    const u = { id: "555", username: "luis" };
    perfiles.anotar(u, "algo");
    perfiles.olvidarNotas(u);
    expect(perfiles.perfilDe(u)).toBeNull();
});

test("borrar una personalidad la quita también de los canales", () => {
    perfiles.guardarPersonalidad({ id: "x", title: "X", systemInstructions: "..." });
    perfiles.asignarPersonalidadCanal("c1", "x");
    expect(perfiles.borrarPersonalidad("x")).toBe(true);
    expect(perfiles.personalidadDeCanal("c1")).toBeNull();
});
