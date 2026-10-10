// Panel 🧩 Combinada (#1): el boleto privado (efímero) y sus botones, la pata que se suma desde un partido y el formulario
// de importe.
const { MessageFlags } = require("discord.js");
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const { pantallaCombinada } = require("../src/paneles/combinada");
const combinada = require("../src/juegos/apuestas/combinada");
const combinadas = require("../src/systems/apuestas/combinadas");

const FUTURO = "2099-01-01T20:00:00.000Z";
let n = 0;
function partido(id) {
    db.prepare(
        `INSERT INTO apuestas_partidos (match_id, deporte, home_team, away_team, start_time, estado, cuota_home, cuota_draw, cuota_away)
         VALUES (?, 'laliga', ?, 'Visitante', ?, 'abierto', 2.0, 3.0, 4.0)`,
    ).run(id, `Local ${id}`, FUTURO);
    return id;
}
const usuario = () => {
    const id = `panel-comb-${++n}`;
    dinero.pagar(id, 1000);
    return id;
};
const botones = (p) => p.components.flatMap((f) => f.components.map((b) => b.data));

test("sin partidos, el boleto lo dice y no se puede apostar", () => {
    const p = pantallaCombinada(usuario());
    expect(p.embeds[0].data.description).toMatch(/Todavía no has sumado/);
    const apostar = botones(p).find((b) => b.custom_id === "combinada_apostar");
    expect(apostar.disabled).toBe(true);
});

test("con dos partidos enseña la cuota total, el premio de 100 y un botón para quitar cada uno", () => {
    const u = usuario();
    const a = partido(`pc-${++n}`);
    const b = partido(`pc-${++n}`);
    combinadas.sumar(u, a, "home"); // 2
    combinadas.sumar(u, b, "draw"); // 3
    const p = pantallaCombinada(u);
    expect(p.embeds[0].data.description).toMatch(/Cuota total:\*\* `6`/);
    expect(p.embeds[0].data.description).toMatch(/cobrarías \*\*600\*\*/);
    const quitar = botones(p).filter((b) => b.custom_id.startsWith("combinada_quitar_"));
    expect(quitar.map((b) => b.custom_id)).toEqual([`combinada_quitar_${a}`, `combinada_quitar_${b}`]);
    expect(botones(p).find((b) => b.custom_id === "combinada_apostar").disabled).toBeFalsy();
});

test("sumar desde un partido responde en privado con el boleto actualizado", async () => {
    const u = usuario();
    const a = partido(`pc-${++n}`);
    const reply = jest.fn();
    await combinada.handleSumar(null, { customId: `combinada_sumar_${a}`, values: ["away"], user: { id: u }, reply });
    const payload = reply.mock.calls[0][0];
    expect(payload.flags).toBe(MessageFlags.Ephemeral);
    expect(payload.embeds[0].data.description).toMatch(/Visitante/);
    expect(payload.embeds[0].data.description).toMatch(/cuota 4/);
});

test("el formulario con un importe no válido responde con el motivo, en privado", async () => {
    const u = usuario();
    partido(`pc-${++n}`);
    const reply = jest.fn();
    await combinada.handleModal(null, {
        customId: "combinada_modal_apostar",
        user: { id: u },
        guildId: "g-panel-comb",
        fields: { getStringSelectValues: () => null, getTextInputValue: () => "abc" },
        reply,
    });
    expect(reply.mock.calls[0][0].flags).toBe(MessageFlags.Ephemeral);
    expect(reply.mock.calls[0][0].embeds[0].data.description).toMatch(/al menos \*\*2\*\* partidos/);
});
