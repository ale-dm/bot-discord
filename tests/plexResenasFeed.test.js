// 📣 Feed de reseñas (#573): el canal `plex.resenas_canal` (vacío = nada), el mensaje (estrellas, extracto sin spoilers y
// autor sin aviso), cada reseña una sola vez (una edición no se republica), las ocultas fuera y el control del panel
// admin (poner y quitar el canal, con auditoría). Sin Discord real: el cliente y el canal son dobles planos.
const db = require("../src/core/db");
const guildSettings = require("../src/systems/guildSettings");
const plexLinks = require("../src/systems/plexLinks");
const plexResenas = require("../src/systems/plexResenas");
const pedidos = require("../src/systems/plexResenas/pedidos");
const adminAudit = require("../src/systems/adminAudit");
const feed = require("../src/systems/plexResenas/feed");
const { mensajeFeedResena, AVISO_SPOILERS } = require("../src/discord/mensajes/resenaFeed");
const { publicarResena } = require("../src/discord/envios/resenaFeed");
const { handleModal } = require("../src/commands/plex/resenas");
const paneladmin = require("../src/commands/admin/paneladmin");
const { buildResenasAdmin } = require("../src/adminPanel/plex/resenas");
const { createComponentRouter } = require("../src/core/componentRouter");

const G = "guild-resenas-feed";
const CANAL = "canal-feed";
const TITULO = "Dune: Parte dos";
const CLAVE = plexResenas.clavePeli(TITULO, 2024);
let siguiente = 1;

function visto(tautulliUserId, titulo, anio) {
    db.prepare(
        `INSERT INTO plex_reproducciones
            (guildId, id, tautulliUserId, tipo, rating_key, titulo, anio, inicio, segundos, porcentaje, visto)
         VALUES (?, ?, ?, 'movie', ?, ?, ?, ?, 7200, 100, 1)`,
    ).run(G, 9000 + siguiente, String(tautulliUserId), `feed${siguiente}`, titulo, anio, 1_700_000_000 + siguiente);
    siguiente++;
}

/** Un cliente con un canal de texto del servidor G que apunta lo que se le manda. */
function clienteFalso({ guildId = G, texto = true, falla = false } = {}) {
    const send = jest.fn(async () => {
        if (falla) throw new Error("Missing Permissions");
    });
    const canal = { id: CANAL, guildId, isTextBased: () => texto, send };
    return { send, client: { channels: { cache: new Map([[CANAL, canal]]), fetch: jest.fn(async () => null) } } };
}

const resena = (extra = {}) => ({
    userId: "u1",
    tipo: "movie",
    titulo: TITULO,
    anio: 2024,
    nota: 9,
    texto: "Una maravilla de principio a fin.",
    spoilers: false,
    meGusta: true,
    oculto: false,
    ...extra,
});

/** El formulario de la ficha (/plex → ⭐ Reseñas), con el cliente que se le pase. */
async function reseñarDesdeLaFicha(client, userId, { nota = "8", texto = "", spoilers = false } = {}) {
    const i = {
        customId: `plex_modal_resena_titulo_${CLAVE}`,
        guildId: G,
        user: { id: userId },
        client,
        fields: { getRadioGroup: () => nota, getTextInputValue: () => texto, getCheckbox: (id) => id === "spoilers" && spoilers },
        update: jest.fn(async () => {}),
        reply: jest.fn(async () => {}),
    };
    await handleModal(i);
    return i;
}

beforeAll(() => {
    for (const [discord, tautulli] of [
        ["u1", "1"],
        ["u2", "2"],
        ["u3", "3"],
        ["u4", "4"],
    ]) {
        plexLinks.setLink(G, discord, tautulli, discord);
        visto(tautulli, TITULO, 2024);
    }
    // La primera reseña de la ficha: el formulario de la ficha necesita una de base para saber el título y el año.
    plexResenas.guardar(G, "u4", { tipo: "movie", titulo: TITULO, anio: 2024, nota: 6 });
});

beforeEach(() => {
    db.prepare("DELETE FROM plex_resenas WHERE guildId = ? AND userId <> 'u4'").run(G);
    db.prepare("DELETE FROM plex_preferencias WHERE guildId = ?").run(G);
    db.prepare("DELETE FROM admin_audit WHERE guildId = ?").run(G);
    guildSettings.setSetting(G, "plex.resenas_canal", CANAL);
});

describe("el mensaje", () => {
    test("lleva el título con el año, las estrellas, el extracto y al autor mencionado sin aviso", () => {
        const m = mensajeFeedResena(resena());
        const e = m.embeds[0].data;
        expect(e.title).toBe(`🎬 ${TITULO} (2024)`);
        expect(e.description).toContain("**★★★★½** ❤️");
        expect(e.description).toContain("Una maravilla de principio a fin.");
        expect(e.description).toContain("<@u1>");
        expect(m.content).toContain("<@u1>");
        expect(m.allowedMentions).toEqual({ parse: [] });
    });

    test("con spoilers sale «contiene spoilers» y ni rastro del texto", () => {
        const m = mensajeFeedResena(resena({ texto: "Al final el protagonista muere", spoilers: true }));
        expect(m.embeds[0].data.description).toContain(AVISO_SPOILERS);
        expect(JSON.stringify(m)).not.toContain("protagonista muere");
    });

    test("un texto largo se recorta a 300 caracteres con puntos suspensivos", () => {
        const largo = "a".repeat(450);
        const corto = feed.extracto(resena({ texto: largo }));
        expect(corto).toHaveLength(feed.MAX_EXTRACTO);
        expect(corto.endsWith("…")).toBe(true);
        expect(mensajeFeedResena(resena({ texto: largo })).embeds[0].data.description).not.toContain(largo);
    });

    test("sin texto lo dice y una temporada no lleva año", () => {
        const m = mensajeFeedResena(resena({ tipo: "show", titulo: "The Bear · temporada 2", texto: null }));
        expect(m.embeds[0].data.title).toBe("📺 The Bear · temporada 2");
        expect(m.embeds[0].data.description).toContain("_Sin texto_");
    });
});

describe("qué se publica", () => {
    test("guardar dice si la reseña es nueva o la edición de una que ya había", () => {
        expect(plexResenas.guardar(G, "u1", { tipo: "movie", titulo: TITULO, anio: 2024, nota: 7 }).nueva).toBe(true);
        expect(plexResenas.guardar(G, "u1", { tipo: "movie", titulo: TITULO, anio: 2024, nota: 8 }).nueva).toBe(false);
    });

    test("sin canal no se publica nada", () => {
        guildSettings.setSetting(G, "plex.resenas_canal", "");
        const r = plexResenas.guardar(G, "u1", { tipo: "movie", titulo: TITULO, anio: 2024, nota: 7 });
        expect(feed.canal(G)).toBeNull();
        expect(feed.aPublicar(G, r)).toBeNull();
    });

    test("quien oculta sus reseñas no sale en el feed", () => {
        plexResenas.setOculto(G, "u1", true);
        const r = plexResenas.guardar(G, "u1", { tipo: "movie", titulo: TITULO, anio: 2024, nota: 7 });
        expect(feed.aPublicar(G, r)).toBeNull();
    });

    test("una reseña oculta por moderación no sale en el feed", () => {
        expect(feed.aPublicar(G, { ok: true, nueva: true, resena: resena({ oculto: true }) })).toBeNull();
    });

    test("una reseña que no se ha podido guardar no se publica", () => {
        expect(feed.aPublicar(G, { ok: false, motivo: "Solo puedes valorar lo que has visto." })).toBeNull();
    });
});

describe("el envío al guardar", () => {
    test("la primera reseña se publica una vez y su edición ya no", async () => {
        const { client, send } = clienteFalso();
        await reseñarDesdeLaFicha(client, "u1", { texto: "Muy buena" });
        await reseñarDesdeLaFicha(client, "u1", { nota: "10", texto: "Mejor de lo que dije" });
        expect(send).toHaveBeenCalledTimes(1);
        expect(send.mock.calls[0][0].embeds[0].data.description).toContain("Muy buena");
        expect(plexResenas.de(G, "u1", CLAVE).nota).toBe(10);
    });

    test("sin canal la reseña se guarda y no se manda nada", async () => {
        guildSettings.setSetting(G, "plex.resenas_canal", "");
        const { client, send } = clienteFalso();
        const i = await reseñarDesdeLaFicha(client, "u2", { texto: "Bien" });
        expect(send).not.toHaveBeenCalled();
        expect(plexResenas.de(G, "u2", CLAVE)).toMatchObject({ nota: 8, texto: "Bien" });
        expect(i.update).toHaveBeenCalled();
    });

    test("una con spoilers sale sin su texto", async () => {
        const { client, send } = clienteFalso();
        await reseñarDesdeLaFicha(client, "u3", { texto: "Paul se convierte en el villano", spoilers: true });
        expect(send).toHaveBeenCalledTimes(1);
        const enviado = JSON.stringify(send.mock.calls[0][0]);
        expect(enviado).toContain(AVISO_SPOILERS);
        expect(enviado).not.toContain("villano");
    });

    test("la reseña del DM también se publica", async () => {
        const { client, send } = clienteFalso();
        const id = pedidos.registrar({ guildId: G, userId: "u2", clave: CLAVE, titulo: TITULO, anio: 2024 });
        await handleModal({
            customId: `plex_modal_resena_${id}`,
            user: { id: "u2" },
            client,
            fields: { getRadioGroup: () => "6", getTextInputValue: () => "Larga", getCheckbox: () => false },
            reply: jest.fn(async () => {}),
        });
        expect(send).toHaveBeenCalledTimes(1);
        expect(send.mock.calls[0][0].content).toContain("<@u2>");
    });

    test("un canal de otro servidor o que no es de texto no recibe nada", async () => {
        const r = plexResenas.guardar(G, "u1", { tipo: "movie", titulo: TITULO, anio: 2024, nota: 7 });
        const ajeno = clienteFalso({ guildId: "otro-servidor" });
        const voz = clienteFalso({ texto: false });
        expect(await publicarResena(ajeno.client, G, r)).toBe(false);
        expect(await publicarResena(voz.client, G, r)).toBe(false);
        expect(ajeno.send).not.toHaveBeenCalled();
        expect(voz.send).not.toHaveBeenCalled();
    });

    test("si Discord rechaza el envío no rompe el guardado", async () => {
        const { client, send } = clienteFalso({ falla: true });
        const i = await reseñarDesdeLaFicha(client, "u1", { texto: "Guardada igual" });
        expect(send).toHaveBeenCalledTimes(1);
        expect(plexResenas.de(G, "u1", CLAVE).texto).toBe("Guardada igual");
        expect(i.update).toHaveBeenCalled();
    });
});

describe("el control del panel admin", () => {
    const interaccion = (extra = {}) => ({
        guildId: G,
        guild: { id: G, members: { cache: new Map() } },
        user: { id: "admin", tag: "admin", username: "admin" },
        member: { permissions: { has: () => true } },
        memberPermissions: { has: () => true },
        client: { guilds: { cache: new Map() } },
        reply: jest.fn(async () => {}),
        update: jest.fn(async () => {}),
        ...extra,
    });
    const ids = (p) => p.components.flatMap((f) => f.toJSON().components.map((c) => c.custom_id));
    const quitar = (p) =>
        p.components.flatMap((f) => f.toJSON().components).find((c) => c.custom_id === "paneladmin_plex_resenas_canal_quitar");

    test("la pantalla enseña el canal, el selector y el botón de quitarlo, con ids únicos", () => {
        const p = buildResenasAdmin(G);
        expect(p.embeds[0].data.description).toContain(`Feed de reseñas: <#${CANAL}>`);
        expect(ids(p)).toContain("paneladmin_plex_resenas_canal_select");
        expect(new Set(ids(p)).size).toBe(ids(p).length);
        expect(p.components.length).toBeLessThanOrEqual(5);
        expect(quitar(p).disabled).toBe(false);
    });

    test("sin canal lo dice y el botón de quitar está deshabilitado", () => {
        guildSettings.setSetting(G, "plex.resenas_canal", "");
        const p = buildResenasAdmin(G);
        expect(p.embeds[0].data.description).toContain("sin canal");
        expect(quitar(p).disabled).toBe(true);
    });

    test("elegir un canal lo guarda y lo deja en la auditoría", async () => {
        guildSettings.setSetting(G, "plex.resenas_canal", "");
        const i = interaccion({ customId: "paneladmin_plex_resenas_canal_select", values: ["nuevo-canal"] });
        await paneladmin.handleChannelSelect(i.client, i);
        expect(guildSettings.getSettings(G).plex.resenas_canal).toBe("nuevo-canal");
        const [fila] = adminAudit.listRecent(G, 10);
        expect(fila).toMatchObject({ action: "plex.resenas.canal", details: { antes: null, ahora: "nuevo-canal" } });
        expect(i.update.mock.calls[0][0].embeds[0].data.description).toContain("<#nuevo-canal>");
    });

    test("quitar el canal lo vacía y lo deja en la auditoría", async () => {
        const i = interaccion({ customId: "paneladmin_plex_resenas_canal_quitar" });
        await paneladmin.handleButton(i.client, i);
        expect(guildSettings.getSettings(G).plex.resenas_canal).toBe("");
        const [fila] = adminAudit.listRecent(G, 10);
        expect(fila).toMatchObject({ action: "plex.resenas.canal", details: { antes: CANAL, ahora: null } });
    });

    test("quien no es admin no puede cambiar el canal", async () => {
        const i = interaccion({
            customId: "paneladmin_plex_resenas_canal_select",
            values: ["otro"],
            member: { permissions: { has: () => false } },
            memberPermissions: { has: () => false },
        });
        await paneladmin.handleChannelSelect(i.client, i);
        expect(i.reply.mock.calls[0][0].content).toBe("No tienes permisos.");
        expect(guildSettings.getSettings(G).plex.resenas_canal).toBe(CANAL);
        expect(adminAudit.listRecent(G, 10)).toEqual([]);
    });

    test("el selector de canal llega a /paneladmin por el enrutador", () => {
        const router = createComponentRouter();
        router.register(paneladmin, "paneladmin");
        const fake = (customId) => ({
            customId,
            isButton: () => false,
            isStringSelectMenu: () => false,
            isUserSelectMenu: () => false,
            isRoleSelectMenu: () => false,
            isChannelSelectMenu: () => true,
            isModalSubmit: () => false,
        });
        expect(router.match(fake("paneladmin_plex_resenas_canal_select")).method).toBe("handleChannelSelect");
    });
});
