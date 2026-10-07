// ⭐ Partido destacado del día (F-AP-07, issue #5): qué partido se elige, el mensaje con los botones de apostar, que se
// publica una vez al día (desde las 10:00 de Madrid) en el canal de resultados, sin pedir nada a la Odds API, y el
// botón del panel de admin.
const db = require("../src/core/db");
const guildSettings = require("../src/systems/guildSettings");
const destacado = require("../src/systems/apuestas/destacado");
const apuestas = require("../src/juegos/apuestas/apuestas");
const paneladmin = require("../src/commands/admin/paneladmin");

// 15 de octubre de 2026 a las 10:30 en Madrid (08:30 UTC).
const AHORA = Date.UTC(2026, 9, 15, 8, 30);
const partido = (id, inicio, cuotas, estado = "abierto") =>
    db
        .prepare(
            "INSERT INTO apuestas_partidos (match_id, home_team, away_team, start_time, estado, deporte, cuota_home, cuota_draw, cuota_away) VALUES (?, ?, ?, ?, ?, 'laliga', ?, ?, ?)",
        )
        .run(id, `Local ${id}`, `Visitante ${id}`, inicio, estado, ...cuotas);
const apostar = (matchId, veces) => {
    for (let i = 0; i < veces; i++) {
        db.prepare("INSERT INTO apuestas_usuario (user_id, match_id, eleccion, cantidad, cuota) VALUES (?, ?, 'home', 10, 2)").run(
            `u${i}`,
            matchId,
        );
    }
};

partido("A", "2026-10-15T18:00:00.000Z", [2.0, 3.2, 3.8]);
partido("B", "2026-10-15T19:00:00.000Z", [2.6, 3.1, 2.7]); // el más igualado
partido("C", "2026-10-15T20:00:00.000Z", [1.3, 5, 9]);
partido("D", "2026-10-15T07:00:00.000Z", [2.5, 3, 2.5]); // ya ha empezado (09:00 en Madrid)
partido("E", "2026-10-15T22:30:00.000Z", [2.5, 3, 2.5]); // 00:30 del 16 en Madrid: es de mañana
partido("F", "2026-10-15T17:00:00.000Z", [null, null, null]); // sin cuotas
partido("G", "2026-10-15T16:00:00.000Z", [2.5, 3, 2.5], "finalizado");
partido("H", "2026-10-16T18:00:00.000Z", [2.1, 3, 3.4]);
apostar("D", 5);
apostar("E", 9);

let fetchLlamado = false;
beforeAll(() => {
    global.fetch = jest.fn(async () => {
        fetchLlamado = true;
        throw new Error("No debería pedir nada a ninguna API");
    });
});

test("el de hoy que aún no ha empezado: con más apuestas y, a igualdad, el más igualado", () => {
    expect(destacado.elegir(AHORA).match_id).toBe("B");
    apostar("C", 2);
    expect(destacado.elegir(AHORA)).toMatchObject({ match_id: "C", apuestas: 2 });
    // Al día siguiente, el de ese día.
    expect(destacado.elegir(Date.UTC(2026, 9, 16, 8, 30)).match_id).toBe("H");
    // Sin partidos ese día, ninguno.
    expect(destacado.elegir(Date.UTC(2026, 9, 20, 8, 30))).toBeNull();
});

test("el mensaje lleva las cuotas y los mismos botones de apostar que /juegos", async () => {
    const msg = destacado.mensaje(destacado.elegir(AHORA));
    const embed = msg.embeds[0].data;
    expect(embed.title).toBe("⭐ Partido destacado del día");
    expect(embed.description).toMatch(/\*\*Local C\*\* vs \*\*Visitante C\*\* · LaLiga/);
    expect(embed.description).toMatch(/cuota `1.3`[\s\S]*cuota `5`[\s\S]*cuota `9`/);
    expect(embed.description).toMatch(/Ya hay \*\*2\*\* apuestas a este partido/);
    const botones = msg.components[0].toJSON().components.map((b) => b.custom_id);
    expect(botones).toEqual(["apuesta_home_C", "apuesta_draw_C", "apuesta_away_C", "apuesta_exacto_C"]);

    // Pulsar uno desde el canal abre el formulario de apostar de siempre.
    const i = { customId: "apuesta_home_C", user: { id: "ana" }, reply: jest.fn(), showModal: jest.fn(async () => {}) };
    await apuestas.handleButton(null, i);
    expect(i.showModal.mock.calls[0][0].toJSON().custom_id).toBe("apuestas_modal_home_C");
});

describe("publicación", () => {
    const canal = { isTextBased: () => true, send: jest.fn(async () => {}) };
    const servidor = (id) => ({ id, name: id, channels: { cache: new Map([["canal-1", canal]]), fetch: async () => null } });
    const client = { guilds: { cache: new Map(["g-con-canal", "g-sin-canal", "g-desactivado"].map((id) => [id, servidor(id)])) } };
    guildSettings.setSetting("g-con-canal", "apuestas.canal_resultados", "canal-1");
    guildSettings.setSetting("g-desactivado", "apuestas.canal_resultados", "canal-1");
    guildSettings.setSetting("g-desactivado", "apuestas.destacado", false);

    test("antes de las 10:00 de Madrid no se publica", async () => {
        expect(await destacado.publicarSiToca(client, Date.UTC(2026, 9, 15, 7, 30))).toBe(0);
        expect(canal.send).not.toHaveBeenCalled();
    });

    test("una vez al día, solo donde está activo y con canal", async () => {
        expect(await destacado.publicarSiToca(client, AHORA)).toBe(1);
        expect(canal.send).toHaveBeenCalledTimes(1);
        expect(canal.send.mock.calls[0][0].embeds[0].data.description).toMatch(/Local C/);
        expect(guildSettings.getSettings("g-con-canal").apuestas.destacado_dia).toBe("2026-10-15");
        // Una hora después (o tras reiniciar), nada nuevo.
        expect(await destacado.publicarSiToca(client, AHORA + 3600 * 1000)).toBe(0);
        // Al día siguiente, el de ese día.
        expect(await destacado.publicarSiToca(client, Date.UTC(2026, 9, 16, 8, 30))).toBe(1);
        expect(canal.send.mock.calls[1][0].embeds[0].data.description).toMatch(/Local H/);
        // Un día sin partidos no se publica (ni se marca, por si llegan más tarde).
        expect(await destacado.publicarSiToca(client, Date.UTC(2026, 9, 20, 8, 30))).toBe(0);
        expect(guildSettings.getSettings("g-con-canal").apuestas.destacado_dia).toBe("2026-10-16");
        expect(fetchLlamado).toBe(false);
    });
});

test("/paneladmin → ⚽ Apuestas: activar y desactivar el destacado", async () => {
    const G = "g-panel-destacado";
    const pulsar = async (customId) => {
        const i = {
            guildId: G,
            guild: { id: G },
            customId,
            user: { id: "admin", tag: "admin" },
            member: { permissions: { has: () => true } },
            reply: jest.fn(async () => {}),
            update: jest.fn(async () => {}),
        };
        await paneladmin.handleButton(null, i);
        const payload = i.update.mock.calls[0][0];
        return {
            avisos: payload.embeds[0].data.fields.find((f) => f.name === "📢 Avisos").value,
            boton: payload.components.flatMap((r) => r.toJSON().components).find((c) => c.custom_id === "paneladmin_apu_destacado").label,
        };
    };
    let p = await pulsar("paneladmin_apu_home");
    expect(p.avisos).toMatch(/⭐ Partido destacado del día: activo, pero hace falta el canal de resultados/);
    expect(p.boton).toBe("⭐ Quitar el destacado");

    p = await pulsar("paneladmin_apu_destacado");
    expect(guildSettings.getSettings(G).apuestas.destacado).toBe(false);
    expect(p.avisos).toMatch(/⭐ Partido destacado del día: desactivado/);
    expect(p.boton).toBe("⭐ Publicar el destacado");

    guildSettings.setSetting(G, "apuestas.canal_resultados", "123456789012345678");
    p = await pulsar("paneladmin_apu_destacado");
    expect(guildSettings.getSettings(G).apuestas.destacado).toBe(true);
    expect(p.avisos).toMatch(/⭐ Partido destacado del día: cada día desde las 10:00 en <#123456789012345678>/);
});
