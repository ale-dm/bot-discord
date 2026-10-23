// ⭐ Pantalla de reseñas en /plex (#567) y moderación (#568): listas, ficha, borrar, reportar y privacidad.
const db = require("../src/core/db");
const guildSettings = require("../src/systems/guildSettings");
const plexLinks = require("../src/systems/plexLinks");
const plexResenas = require("../src/systems/plexResenas");
const avisosDm = require("../src/systems/avisosDm");
const { pantallaResenas, pantallaTitulo } = require("../src/paneles/plexResenas");
const { handleButton, handleModal } = require("../src/commands/plex/resenas");
const plexCmd = require("../src/commands/plex/plex");

const G = "guild-resenas-pantalla";
const CLAVE = plexResenas.clavePeli("Dune: Parte dos", 2024);
let siguiente = 1;

function visto(tautulliUserId, titulo, anio) {
    db.prepare(
        `INSERT INTO plex_reproducciones
            (guildId, id, tautulliUserId, tipo, rating_key, titulo, anio, inicio, segundos, porcentaje, visto)
         VALUES (?, ?, ?, 'movie', ?, ?, ?, ?, 7200, 100, 1)`,
    ).run(G, siguiente, String(tautulliUserId), `k${siguiente}`, titulo, anio, 1_700_000_000 + siguiente);
    siguiente++;
}

const ids = (p) => p.components.flatMap((f) => f.toJSON().components.map((c) => c.custom_id));

beforeAll(() => {
    for (const [discord, tautulli] of [
        ["u1", "1"],
        ["u2", "2"],
        ["u3", "3"],
    ])
        plexLinks.setLink(G, discord, tautulli, discord);
    for (const t of ["1", "2", "3"]) visto(t, "Dune: Parte dos", 2024);
    guildSettings.setSetting(G, "plex.resenas_activo", true);
    guildSettings.setSetting(G, "plex.resenas_desde", 1);
    guildSettings.setSetting(G, "alertas.admin_ids", "admin1");
    guildSettings.setSetting(G, "plex.resenas_min_votos", 2);
    plexResenas.guardar(G, "u1", { tipo: "movie", titulo: "Dune: Parte dos", anio: 2024, nota: 8, texto: "Muy buena" });
    plexResenas.guardar(G, "u2", {
        tipo: "movie",
        titulo: "Dune: Parte dos",
        anio: 2024,
        nota: 9,
        texto: "Brutal",
        spoilers: true,
    });
});

describe("la pantalla", () => {
    test("mis reseñas: título, botones de vista y Ver", () => {
        const p = pantallaResenas(G, "u1", "mias");
        expect(p.embeds[0].toJSON().title).toContain("Mis reseñas");
        expect(ids(p)).toEqual(expect.arrayContaining(["plex_resenas_mias", `plex_resenas_ver_${CLAVE}`]));
        expect(ids(p)).toContain("plex_resenas_ocultar");
    });

    test("mejor valoradas: media y votos", () => {
        const p = pantallaResenas(G, "u1", "mejores");
        expect(p.embeds[0].toJSON().description).toContain("Dune: Parte dos");
        expect(p.embeds[0].toJSON().description).toContain("4,3");
    });

    test("la ficha enseña media, votos y los spoilers tapados", () => {
        const p = pantallaTitulo(G, "u1", CLAVE);
        const e = p.embeds[0].toJSON();
        expect(e.title).toContain("Dune: Parte dos");
        expect(e.description).toContain("4,3");
        expect(e.description).toContain("||Brutal||");
        expect(ids(p)).toEqual(expect.arrayContaining([`plex_resenas_puntuar_${CLAVE}`, `plex_resenas_borrar_${CLAVE}`]));
        expect(ids(p)).not.toContain(`plex_resenas_reportar_${CLAVE}`);
    });

    test("quien no ha reseñado puede puntuar y reportar", () => {
        const p = pantallaTitulo(G, "u3", CLAVE);
        expect(ids(p)).toContain(`plex_resenas_puntuar_${CLAVE}`);
        expect(ids(p)).toContain(`plex_resenas_reportar_${CLAVE}`);
        expect(ids(p)).not.toContain(`plex_resenas_borrar_${CLAVE}`);
    });

    test("un admin puede borrar reseñas ajenas", () => {
        const p = pantallaTitulo(G, "admin1", CLAVE);
        expect(ids(p)).toContain(`plex_resenas_borrar_${CLAVE}`);
    });
});

describe("los botones", () => {
    const interaccion = (customId, userId) => ({
        customId,
        guildId: G,
        user: { id: userId },
        update: jest.fn(async () => {}),
        reply: jest.fn(async () => {}),
        deferReply: jest.fn(async () => {}),
        editReply: jest.fn(async () => {}),
    });

    test("el botón ⭐ Reseñas del panel de /plex abre la pantalla (customId exacto)", async () => {
        const i = interaccion("plex_resenas", "u1");
        await plexCmd.handleButton({}, i);
        expect(i.update).toHaveBeenCalledTimes(1);
        expect(i.update.mock.calls[0][0].embeds[0].toJSON().title).toContain("Reseñas");
    });

    test("Ver abre la ficha y Ocultar cambia la privacidad", async () => {
        const i = interaccion(`plex_resenas_ver_${CLAVE}`, "u1");
        await handleButton({}, i);
        expect(i.update.mock.calls[0][0].embeds[0].toJSON().title).toContain("Dune");

        const o = interaccion("plex_resenas_ocultar", "u3");
        await handleButton({}, o);
        expect(plexResenas.oculto(G, "u3")).toBe(true);
        await handleButton({}, o);
        expect(plexResenas.oculto(G, "u3")).toBe(false);
    });

    test("borrar quita la propia y, si eres admin, la ajena queda en la auditoría", async () => {
        const i = interaccion(`plex_resenas_borrar_${CLAVE}`, "u1");
        await handleButton({}, i);
        expect(plexResenas.de(G, "u1", CLAVE)).toBeNull();

        const a = interaccion(`plex_resenas_borrar_${CLAVE}`, "admin1");
        await handleButton({}, a);
        expect(plexResenas.titulo(G, CLAVE).votos).toBe(0);
        const fila = db.prepare("SELECT action FROM admin_audit WHERE guildId = ? AND action = ?").get(G, "plex.resena_borrar");
        expect(fila).toBeTruthy();
    });

    test("reportar avisa a los admins por DM", async () => {
        const spy = jest.spyOn(avisosDm, "sendDm").mockResolvedValue(true);
        const i = interaccion(`plex_resenas_reportar_${CLAVE}`, "u3");
        await handleButton({}, i);
        expect(spy).toHaveBeenCalled();
        expect(i.editReply).toHaveBeenCalled();
        spy.mockRestore();
    });

    test("el formulario de la ficha guarda y limpia menciones y enlaces", async () => {
        plexResenas.guardar(G, "u1", { tipo: "movie", titulo: "Dune: Parte dos", anio: 2024, nota: 6 });
        const fields = {
            getRadioGroup: () => "7",
            getTextInputValue: () => "@everyone https://x.com me gustó",
            getCheckbox: (id) => id === "megusta",
        };
        const i = {
            customId: `plex_modal_resena_titulo_${CLAVE}`,
            guildId: G,
            user: { id: "u3" },
            fields,
            update: jest.fn(async () => {}),
            reply: jest.fn(async () => {}),
        };
        await handleModal(i);
        expect(plexResenas.de(G, "u3", CLAVE)).toMatchObject({ nota: 7, texto: "me gustó", meGusta: true });
        expect(i.update).toHaveBeenCalled();
    });
});
