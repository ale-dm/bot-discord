// ⭐ DM de reseñas (#566): a quién se pregunta, el payload de las estrellas, el formulario y los botones.
const db = require("../src/core/db");
const guildSettings = require("../src/systems/guildSettings");
const plexLinks = require("../src/systems/plexLinks");
const plexResenas = require("../src/systems/plexResenas");
const pedidos = require("../src/systems/plexResenas/pedidos");
const { mensajeResena, formularioResena } = require("../src/discord/mensajes/resena");
const envios = require("../src/discord/envios/resenas");
const { handleButton, handleModal } = require("../src/commands/plex/resenas");

const G = "guild-resenas-dm";
const G2 = "guild-resenas-dm-cap";
const G3 = "guild-resenas-dm-envio";
let siguiente = 1;

function visto(guildId, tautulliUserId, titulo, anio, extra = {}) {
    db.prepare(
        `INSERT INTO plex_reproducciones
            (guildId, id, tautulliUserId, tipo, rating_key, titulo, anio, inicio, segundos, porcentaje, visto)
         VALUES (?, ?, ?, 'movie', ?, ?, ?, ?, 7200, ?, ?)`,
    ).run(
        guildId,
        siguiente,
        String(tautulliUserId),
        `k${siguiente}`,
        titulo,
        anio,
        1_700_000_000 + siguiente,
        extra.porcentaje ?? 100,
        extra.visto ?? 1,
    );
    siguiente++;
}

beforeAll(() => {
    plexLinks.setLink(G, "u1", "1", "ana");
    plexLinks.setLink(G2, "u2", "2", "luis");
    plexLinks.setLink(G3, "u3", "3", "eva");
    visto(G, 1, "Dune: Parte dos", 2024);
    visto(G, 1, "A medias", 2023, { visto: 0, porcentaje: 50 });
    for (let i = 0; i < 6; i++) visto(G2, 2, `Película ${i}`, 2020 + i);
    visto(G3, 3, "Envío 1", 2021);
    visto(G3, 3, "Envío 2", 2022);
    guildSettings.setSetting(G, "plex.resenas_activo", true);
    guildSettings.setSetting(G, "plex.resenas_desde", 1);
    guildSettings.setSetting(G2, "plex.resenas_activo", true);
    guildSettings.setSetting(G2, "plex.resenas_desde", 1);
    guildSettings.setSetting(G2, "plex.resenas_max_dia", 2);
    guildSettings.setSetting(G3, "plex.resenas_activo", true);
    guildSettings.setSetting(G3, "plex.resenas_desde", 1);
});

describe("a quién se pregunta", () => {
    test("solo lo terminado después de activar, y una vez por título", () => {
        const p = pedidos.pendientes(G);
        expect(p).toHaveLength(1);
        expect(p[0]).toMatchObject({ userId: "u1", titulo: "Dune: Parte dos", anio: 2024 });
        pedidos.registrar(p[0]);
        expect(pedidos.pendientes(G)).toEqual([]);
    });

    test("con la función apagada no se pregunta nada", () => {
        guildSettings.setSetting(G, "plex.resenas_activo", false);
        expect(pedidos.pendientes(G)).toEqual([]);
        guildSettings.setSetting(G, "plex.resenas_activo", true);
    });

    test("el tope diario por persona se respeta", () => {
        const dos = pedidos.pendientes(G2);
        expect(dos).toHaveLength(2);
        for (const p of dos) pedidos.registrar(p);
        expect(pedidos.pendientes(G2)).toEqual([]);
    });
});

describe("el mensaje y el formulario", () => {
    const pedido = { id: 7, titulo: "Dune: Parte dos", anio: 2024 };

    test("10 estrellas en dos filas, «Ahora no» y sin menciones", () => {
        const m = mensajeResena(pedido);
        expect(m.components).toHaveLength(3);
        expect(m.components[0].components).toHaveLength(5);
        expect(m.components[1].components).toHaveLength(5);
        expect(m.components[2].components[0].data.label).toBe("⏭️ Ahora no");
        const ids = m.components.flatMap((f) => f.components.map((b) => b.data.custom_id));
        expect(new Set(ids).size).toBe(ids.length);
        expect(m.allowedMentions).toEqual({ parse: [] });
    });

    test("el formulario trae la nota marcada, la opinión y las dos casillas", () => {
        const modal = formularioResena(pedido, { nota: 8, texto: "Muy buena", spoilers: true, meGusta: false }, 8).toJSON();
        expect(modal.title).toBe("⭐ Dune: Parte dos");
        const nota = modal.components[0].component;
        expect(nota.options).toHaveLength(10);
        expect(nota.options.find((o) => o.default)?.value).toBe("8");
        expect(modal.components.map((c) => c.component.type)).toEqual([21, 4, 23, 23]);
    });
});

describe("el envío y los botones", () => {
    test("manda el DM una vez y lo apunta; con los DMs cerrados lo marca", async () => {
        const send = jest.fn(async () => ({ id: "dm" }));
        const client = {
            guilds: { cache: new Map([[G3, { id: G3 }]]) },
            users: { fetch: jest.fn(async () => ({ send })) },
        };
        expect(await envios.avisarPendientes(client)).toBe(2);
        expect(send).toHaveBeenCalledTimes(2);
        expect(await envios.avisarPendientes(client)).toBe(0);

        guildSettings.setSetting(G, "plex.resenas_activo", true);
        guildSettings.setSetting(G, "plex.resenas_desde", 1);
        db.prepare("DELETE FROM plex_resenas_pedidas WHERE guildId = ?").run(G);
        const cerrado = jest.fn(async () => {
            const e = new Error("DMs cerrados");
            e.code = 50007;
            throw e;
        });
        const client2 = {
            guilds: { cache: new Map([[G, { id: G }]]) },
            users: { fetch: jest.fn(async () => ({ send: cerrado })) },
        };
        expect(await envios.avisarPendientes(client2)).toBe(0);
        const pedido = db.prepare("SELECT decision FROM plex_resenas_pedidas WHERE guildId = ?").get(G);
        expect(pedido.decision).toBe("cerrado");
    });

    test("otra persona no puede tocar la reseña", async () => {
        const p = db.prepare("SELECT * FROM plex_resenas_pedidas ORDER BY id DESC LIMIT 1").get();
        const reply = jest.fn(async () => {});
        await handleButton({}, { customId: `plex_resena_no_${p.id}`, user: { id: "otro" }, reply });
        expect(reply).toHaveBeenCalled();
    });

    test("el formulario guarda la nota y deja el DM con los botones de cambiar y borrar", async () => {
        db.prepare("DELETE FROM plex_resenas_pedidas WHERE guildId = ?").run(G);
        const [cand] = pedidos.pendientes(G);
        const p = pedidos.pedido(pedidos.registrar(cand));
        const edit = jest.fn(async () => {});
        const reply = jest.fn(async () => {});
        const fields = {
            getRadioGroup: () => "8",
            getTextInputValue: () => "Muy buena",
            getCheckbox: (id) => id === "spoilers",
        };
        await handleModal({
            customId: `plex_modal_resena_${p.id}`,
            user: { id: "u1" },
            fields,
            message: { edit },
            reply,
        });
        expect(plexResenas.de(G, "u1", p.clave)).toMatchObject({ nota: 8, texto: "Muy buena", spoilers: true });
        expect(edit.mock.calls[0][0].content).toBe("✅ Reseñada ★★★★");
        expect(pedidos.pedido(p.id).decision).toBe("puntuada");
        expect(reply).toHaveBeenCalled();
    });
});
