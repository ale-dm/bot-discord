// ⚙️ Caché de los ajustes del servidor (DT-23): leer varias veces consulta la BD una sola vez; escribir invalida la
// caché, así que la siguiente lectura ve el valor nuevo; y lo que devuelve getSettings es una copia.
const db = require("../src/core/db");
const guildSettings = require("../src/systems/guildSettings");

const G = "g-ajustes-cache";
beforeEach(() => {
    guildSettings.invalidarAjustes(G);
    db.prepare("DELETE FROM guild_settings WHERE guildId = ?").run(G);
});
afterEach(() => jest.restoreAllMocks());

test("leer los ajustes dos veces consulta la BD una sola vez", () => {
    const espia = jest.spyOn(db, "prepare");
    guildSettings.getSettings(G);
    guildSettings.getSettings(G);
    const lecturas = espia.mock.calls.filter(([sql]) => sql.includes("SELECT key, value FROM guild_settings")).length;
    expect(lecturas).toBe(1);
});

test("tras cambiar un ajuste, la siguiente lectura devuelve el valor nuevo", () => {
    guildSettings.setSetting(G, "duende.temperature", 0.5);
    expect(guildSettings.getSettings(G).duende.temperature).toBe(0.5);
    guildSettings.setSetting(G, "duende.temperature", 0.9);
    expect(guildSettings.getSettings(G).duende.temperature).toBe(0.9);
});

test("setManySettings también invalida la caché", () => {
    guildSettings.setSetting(G, "duende.history_limit", 5);
    expect(guildSettings.getSettings(G).duende.history_limit).toBe(5);
    guildSettings.setManySettings(G, { "duende.history_limit": 12 });
    expect(guildSettings.getSettings(G).duende.history_limit).toBe(12);
});

test("lo que devuelve getSettings es una copia: cambiarla no toca la caché", () => {
    guildSettings.setSetting(G, "duende.temperature", 0.3);
    guildSettings.getSettings(G).duende.temperature = 99;
    expect(guildSettings.getSettings(G).duende.temperature).toBe(0.3);
});
