// ⭐ Reseñas de Plex en /paneladmin → 🎬 Plex (#571): la pantalla con sus contadores (los de la BD), los avisos (activar
// con su «desde» y desactivar sin DM), el tope diario y el mínimo de votos validados y auditados, y el borrado de una
// reseña (también oculta) en dos pasos con confirmación. Pasa por el enrutador del panel, como en Discord.
const db = require("../src/core/db");
const guildSettings = require("../src/systems/guildSettings");
const adminAudit = require("../src/systems/adminAudit");
const pedidos = require("../src/systems/plexResenas/pedidos");
const paneladmin = require("../src/commands/admin/paneladmin");
const { buildResenasAdmin } = require("../src/adminPanel/plex/resenas");

const G = "guild-admin-resenas";
let siguiente = 1;

function resena({ userId, titulo, anio = 2024, nota = 8, oculto = 0, texto = "Buena" }) {
    const ahora = 1000 + siguiente++;
    db.prepare(
        `INSERT INTO plex_resenas (guildId, userId, clave, tipo, titulo, anio, nota, texto, spoilers, me_gusta, oculto, creado_en, actualizado_en)
         VALUES (?, ?, ?, 'movie', ?, ?, ?, ?, 0, 0, ?, ?, ?)`,
    ).run(G, userId, `peli:${titulo.toLowerCase()}|${anio}`, titulo, anio, nota, texto, oculto, ahora, ahora);
}

beforeEach(() => {
    db.prepare("DELETE FROM plex_resenas WHERE guildId = ?").run(G);
    db.prepare("DELETE FROM plex_resenas_pedidas WHERE guildId = ?").run(G);
    guildSettings.setSetting(G, "plex.resenas_activo", false);
    guildSettings.setSetting(G, "plex.resenas_desde", 0);
});

const interaccion = (extra = {}) => ({
    guildId: G,
    guild: { id: G, members: { cache: new Map([["ana", { displayName: "Ana" }]]) } },
    user: { id: "admin", tag: "admin", username: "admin" },
    member: { permissions: { has: () => true } },
    memberPermissions: { has: () => true },
    client: { guilds: { cache: new Map() } },
    reply: jest.fn(async () => {}),
    update: jest.fn(async () => {}),
    showModal: jest.fn(async () => {}),
    ...extra,
});
const boton = async (customId, extra) => {
    const i = interaccion({ customId, ...extra });
    await paneladmin.handleButton(i.client, i);
    return i;
};
const menu = async (customId, values) => {
    const i = interaccion({ customId, values });
    await paneladmin.handleStringSelect(i.client, i);
    return i;
};
const formulario = async (customId, campos) => {
    const i = interaccion({ customId, fields: { getTextInputValue: (k) => campos[k] ?? "" } });
    await paneladmin.handleModal(i.client, i);
    return i;
};
const auditoria = () => adminAudit.listRecent(G, 50).map((r) => r.action);

describe("la pantalla", () => {
    test("los contadores son los de la BD, también con las ocultas, y los avisos sin respuesta", () => {
        resena({ userId: "ana", titulo: "Dune" });
        resena({ userId: "luis", titulo: "Dune" });
        resena({ userId: "marta", titulo: "Otra", oculto: 1 });
        db.prepare(
            "INSERT INTO plex_resenas_pedidas (guildId, userId, clave, titulo, pedido_en, decision) VALUES (?, 'ana', 'peli:x|2024', 'X', 1, NULL)",
        ).run(G);
        db.prepare(
            "INSERT INTO plex_resenas_pedidas (guildId, userId, clave, titulo, pedido_en, decision) VALUES (?, 'luis', 'peli:y|2024', 'Y', 1, 'puntuada')",
        ).run(G);

        const texto = buildResenasAdmin(G).embeds[0].data.description;
        expect(texto).toContain("Reseñas: **3** (1 ocultas) · media **4,0**");
        expect(texto).toContain("Avisos esperando respuesta: **1**");
        expect(texto).toContain("Avisos por DM: **desactivados** (no se manda ninguno)");
    });

    test("sin reseñas la media dice que no hay", () => {
        expect(buildResenasAdmin(G).embeds[0].data.description).toContain("media **sin reseñas**");
    });

    test("se abre desde 🎬 Plex y sin permisos no hace nada", async () => {
        const abre = await boton("paneladmin_plex_resenas");
        expect(abre.update).toHaveBeenCalledWith(expect.objectContaining({ embeds: expect.any(Array) }));

        const sinPermiso = interaccion({
            customId: "paneladmin_plex_resenas_toggle",
            memberPermissions: { has: () => false },
            member: { permissions: { has: () => false } },
        });
        await paneladmin.handleButton(sinPermiso.client, sinPermiso);
        expect(sinPermiso.reply).toHaveBeenCalledWith(expect.objectContaining({ content: "No tienes permisos." }));
        expect(guildSettings.getSettings(G).plex.resenas_activo).toBe(false);
    });
});

describe("los avisos", () => {
    test("activarlos fija el desde (sin backfill) y queda auditado", async () => {
        const antes = Math.floor(Date.now() / 1000);
        await boton("paneladmin_plex_resenas_toggle");
        const plex = guildSettings.getSettings(G).plex;
        expect(plex.resenas_activo).toBe(true);
        expect(Number(plex.resenas_desde)).toBeGreaterThanOrEqual(antes);
        expect(auditoria()).toContain("plex.resenas.activo");
    });

    test("desactivados no sale ningún DM pendiente, aunque haya películas vistas", async () => {
        await boton("paneladmin_plex_resenas_toggle");
        await boton("paneladmin_plex_resenas_toggle");
        expect(guildSettings.getSettings(G).plex.resenas_activo).toBe(false);
        expect(pedidos.pendientes(G)).toEqual([]);
    });
});

describe("tope diario y mínimo de votos", () => {
    test("un valor fuera de rango no se guarda", async () => {
        const i = await formulario("paneladmin_plex_resenas_max_dia_modal", { cantidad: "25" });
        expect(i.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("❌") }));
        expect(guildSettings.getSettings(G).plex.resenas_max_dia).not.toBe(25);
        await formulario("paneladmin_plex_resenas_min_votos_modal", { cantidad: "abc" });
        expect(guildSettings.getSettings(G).plex.resenas_min_votos).not.toBe("abc");
    });

    test("un valor válido se guarda y se audita con el antes y el ahora", async () => {
        await formulario("paneladmin_plex_resenas_max_dia_modal", { cantidad: "3" });
        expect(guildSettings.getSettings(G).plex.resenas_max_dia).toBe(3);
        const fila = adminAudit.listRecent(G, 50).find((r) => r.action === "plex.resenas.max_dia");
        expect(fila.details).toEqual({ antes: expect.anything(), ahora: 3 });

        await formulario("paneladmin_plex_resenas_min_votos_modal", { cantidad: "5" });
        expect(guildSettings.getSettings(G).plex.resenas_min_votos).toBe(5);
        expect(auditoria()).toContain("plex.resenas.min_votos");
    });
});

describe("borrar una reseña", () => {
    test("busca (también las ocultas), elige, confirma y borra con auditoría; el token solo vale una vez", async () => {
        resena({ userId: "ana", titulo: "Película Oculta", anio: 2020, oculto: 1 });

        const busca = await formulario("paneladmin_plex_resenas_borrar_modal", { titulo: "pelicula OCULTA", anio: "" });
        const token = busca.reply.mock.calls[0][0].components[0].components[0].options[0].data.value;
        expect(token).toMatch(/^[0-9a-f]{12}$/);

        const elige = await menu("paneladmin_plex_resenas_pick", [token]);
        const confirmar = elige.update.mock.calls[0][0].components[0].components;
        expect(confirmar[0].data.custom_id).toBe(`paneladmin_plex_resenas_si_${token}`);

        await boton(`paneladmin_plex_resenas_si_${token}`);
        const quedan = db.prepare("SELECT COUNT(*) AS n FROM plex_resenas WHERE guildId = ? AND titulo = 'Película Oculta'").get(G).n;
        expect(quedan).toBe(0);
        expect(auditoria()).toContain("plex.resena_borrar");

        const otra = await boton(`paneladmin_plex_resenas_si_${token}`);
        expect(otra.update).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("caducado") }));
    });

    test("un título sin reseñas lo dice y no ofrece nada que borrar", async () => {
        const busca = await formulario("paneladmin_plex_resenas_borrar_modal", { titulo: "No existe", anio: "" });
        expect(busca.reply).toHaveBeenCalledWith(expect.objectContaining({ content: "No hay reseñas de «No existe» en el servidor." }));
    });

    test("cancelar no borra nada", async () => {
        resena({ userId: "ana", titulo: "Cancelable" });
        await boton("paneladmin_plex_resenas_no");
        const n = db.prepare("SELECT COUNT(*) AS n FROM plex_resenas WHERE guildId = ? AND titulo = 'Cancelable'").get(G).n;
        expect(n).toBe(1);
    });
});
