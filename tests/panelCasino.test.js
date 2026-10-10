// Pestaña Casino de /juegos (antes en /perfil): sus pantallas y que al jugar desde él se edite el mensaje del panel
// sin mandar flags (lo privado no se puede cambiar al editar).
const db = require("../src/core/db");
const guildSettings = require("../src/systems/guildSettings");
const juegos = require("../src/commands/juegos/juegos");

const G = "guild-casino-panel";
guildSettings.setSetting(G, "casino.global_cooldown_sec", 0);
db.prepare("INSERT INTO banco (userId, saldo, enMano) VALUES ('jugador', 0, 600)").run();

function boton(customId) {
    return {
        customId,
        guildId: G,
        guild: { id: G },
        user: { id: "jugador", username: "jugador", tag: "jugador" },
        message: { interaction: { user: { id: "jugador" } } },
        update: jest.fn(async () => {}),
        reply: jest.fn(async () => {}),
        followUp: jest.fn(async () => {}),
        showModal: jest.fn(async () => {}),
    };
}
const primero = (i) => i.update.mock.calls[0][0];

test.each([
    ["casino_home", "🎰 Casino — Tu resumen"],
    ["casino_stats", "📊 Estadísticas de jugador"],
    ["casino_historial", "📜 Historial reciente"],
    ["casino_ranking", "🏆 Ranking del Casino"],
    ["casino_blackjack", "🃏 Blackjack — Elige tu apuesta"],
    ["casino_ruleta", "🎡 Ruleta — Elige tipo de apuesta"],
    ["casino_pick_ruleta_docenas", "🎡 Ruleta — Docenas"],
    ["casino_pick_ruleta_color_rojo", "🎡 Ruleta — Elige tu apuesta"],
])("%s abre su pantalla", async (id, titulo) => {
    const i = boton(id);
    await juegos.handleButton(null, i);
    expect(primero(i).embeds[0].data.title).toBe(titulo);
});

test("los importes que no se pueden pagar salen desactivados", async () => {
    const i = boton("casino_blackjack");
    await juegos.handleButton(null, i);
    const botones = primero(i).components[0].components;
    expect(botones.map((b) => b.data.custom_id)).toEqual([50, 100, 500, 1000, 5000].map((m) => `casino_play_blackjack_${m}`));
    expect(botones.map((b) => b.data.disabled)).toEqual([false, false, false, true, true]); // saldo: 600
});

test("jugar al blackjack desde el panel edita el mensaje sin flags", async () => {
    const i = boton("casino_play_blackjack_100");
    await juegos.handleButton(null, i);
    expect(i.update).toHaveBeenCalledTimes(1);
    expect(primero(i).flags).toBeUndefined();
    expect(primero(i).embeds[0].data.title).toMatch(/Blackjack/);
});

test("el número exacto de la ruleta se elige en dos pasos: rango y luego número", async () => {
    // Paso 1: el rango, en botones (0, 1–12, 13–24, 25–36).
    const rangos = boton("casino_pick_ruleta_numero");
    await juegos.handleButton(null, rangos);
    expect(rangos.showModal).not.toHaveBeenCalled();
    const botonesRango = primero(rangos).components[0].toJSON().components;
    expect(botonesRango.map((b) => b.custom_id)).toEqual([0, 1, 2, 3].map((g) => `casino_pick_ruleta_rango_${g}`));

    // Paso 2: de 1–12, un desplegable con esos doce números; el 0 va directo al importe.
    const docena = boton("casino_pick_ruleta_rango_1");
    await juegos.handleButton(null, docena);
    const desplegable = primero(docena).components[0].toJSON().components[0];
    expect(desplegable.custom_id).toBe("casino_ruleta_numero_sel");
    expect(desplegable.options.map((o) => o.value)).toEqual(Array.from({ length: 12 }, (_, n) => String(n + 1)));

    const cero = boton("casino_pick_ruleta_rango_0");
    await juegos.handleButton(null, cero);
    expect(primero(cero).embeds[0].data.description).toMatch(/Número: \*\*0\*\*/);
});

test("el número del desplegable lleva al importe de ese número", async () => {
    const i = { ...boton("casino_ruleta_numero_sel"), values: ["17"] };
    await juegos.handleSelect(null, i);
    expect(primero(i).embeds[0].data.description).toMatch(/Número: \*\*17\*\*/);
});
