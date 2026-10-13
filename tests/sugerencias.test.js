// #428: buzón de sugerencias. /sugerencia publica la idea en el canal con su número y botones 👍 y 👎 (sin canal, avisa a quien la
// envía); un voto por persona que se puede cambiar; y un admin la acepta o la descarta desde el panel (con motivo opcional): el
// autor lo recibe por DM, el mensaje se repinta y queda en la auditoría.
const db = require("../src/core/db");
const guildSettings = require("../src/systems/guildSettings");
const sugerencias = require("../src/systems/sugerencias");
const avisosDm = require("../src/systems/avisosDm");
const adminAudit = require("../src/systems/adminAudit");
const comando = require("../src/commands/general/sugerencia");
const { mensajeSugerencia } = require("../src/paneles/sugerencia");
const comunidad = require("../src/adminPanel/comunidad");

const G = "g-sug";
const CANAL = "canal-sug";
let n = 0;
const persona = () => `sug-user-${++n}`;
const idsDe = (p) => p.components.flatMap((f) => (f.toJSON ? f.toJSON() : f).components.map((c) => c.custom_id));

beforeEach(() => {
    guildSettings.setSetting(G, "sugerencias.canal_id", CANAL);
});

describe("crear", () => {
    test("una sugerencia nace pendiente, con su número, y se limpia el texto", () => {
        const u = persona();
        const r = sugerencias.crear({ guildId: G, userId: u, texto: "  Más   sonidos\n\n\n\nde Plex  " });
        expect(r.ok).toBe(true);
        expect(r.sugerencia).toMatchObject({ estado: "pendiente", userId: u, guildId: G, texto: "Más sonidos\n\nde Plex" });
        expect(r.sugerencia.id).toBeGreaterThan(0);
    });

    test("el texto tiene que tener entre 5 y 1.000 caracteres", () => {
        const u = persona();
        expect(sugerencias.crear({ guildId: G, userId: u, texto: "hola" }).mensaje).toMatch(/al menos 5/);
        expect(sugerencias.crear({ guildId: G, userId: u, texto: "x".repeat(1001) }).mensaje).toMatch(/1000 caracteres/);
        expect(sugerencias.crear({ guildId: G, userId: u, texto: "x".repeat(1000) }).ok).toBe(true);
    });

    test("tres al día por persona: la cuarta se rechaza, y a las 24 horas se puede otra vez", () => {
        const u = persona();
        const ahora = Date.now();
        for (let i = 0; i < sugerencias.MAX_POR_DIA; i++)
            expect(sugerencias.crear({ guildId: G, userId: u, texto: `idea número ${i}`, ahora }).ok).toBe(true);
        const cuarta = sugerencias.crear({ guildId: G, userId: u, texto: "otra idea más", ahora: ahora + 1000 });
        expect(cuarta.ok).toBe(false);
        expect(cuarta.mensaje).toMatch(/3 sugerencias en las últimas 24 horas/);
        expect(sugerencias.crear({ guildId: G, userId: persona(), texto: "la de otro" }).ok).toBe(true);
        expect(sugerencias.crear({ guildId: G, userId: u, texto: "ya ha pasado un día", ahora: ahora + 25 * 3600 * 1000 }).ok).toBe(true);
    });
});

describe("votos", () => {
    const pendiente = () => sugerencias.crear({ guildId: G, userId: persona(), texto: "Una idea para votar" }).sugerencia;

    test("cada persona vota una vez: repetir el mismo voto no suma, y votar lo contrario lo cambia", () => {
        const s = pendiente();
        const a = persona();
        expect(sugerencias.votar(s.id, a, 1)).toMatchObject({ ok: true, cambio: false });
        expect(sugerencias.marcador(s.id)).toMatchObject({ favor: 1, contra: 0 });
        expect(sugerencias.votar(s.id, a, 1)).toMatchObject({ ok: true, cambio: false });
        expect(sugerencias.marcador(s.id)).toMatchObject({ favor: 1, contra: 0 });
        expect(sugerencias.votar(s.id, a, -1)).toMatchObject({ ok: true, cambio: true });
        expect(sugerencias.marcador(s.id, a)).toEqual({ favor: 0, contra: 1, voto: -1 });
        sugerencias.votar(s.id, persona(), 1);
        sugerencias.votar(s.id, persona(), 1);
        expect(sugerencias.marcador(s.id)).toMatchObject({ favor: 2, contra: 1 });
        expect(db.prepare("SELECT COUNT(*) AS n FROM sugerencia_votos WHERE sugerencia_id = ? AND userId = ?").get(s.id, a).n).toBe(1);
    });

    test("un voto inválido, una sugerencia que no existe o ya resuelta no admiten voto", () => {
        const s = pendiente();
        expect(sugerencias.votar(s.id, persona(), 0).ok).toBe(false);
        expect(sugerencias.votar(99999, persona(), 1).mensaje).toMatch(/ya no existe/);
        sugerencias.resolver(s.id, "aceptada", "admin-1");
        expect(sugerencias.votar(s.id, persona(), 1).mensaje).toMatch(/ya está resuelta/);
    });

    test("el mensaje enseña el marcador en los botones y se desactivan al resolverse", () => {
        const s = pendiente();
        sugerencias.votar(s.id, persona(), 1);
        sugerencias.votar(s.id, persona(), -1);
        sugerencias.votar(s.id, persona(), -1);
        const m = mensajeSugerencia(sugerencias.obtener(s.id));
        expect(idsDe(m)).toEqual([`sugerencia_voto_${s.id}_up`, `sugerencia_voto_${s.id}_down`]);
        expect(m.components[0].toJSON().components.map((c) => c.label)).toEqual(["👍 1", "👎 2"]);
        expect(m.embeds[0].toJSON().title).toBe(`💡 Sugerencia #${s.id}`);
        const resuelta = mensajeSugerencia(sugerencias.resolver(s.id, "descartada", "admin-1", "Ya existe").sugerencia);
        expect(resuelta.components[0].toJSON().components.every((c) => c.disabled)).toBe(true);
        expect(JSON.stringify(resuelta.embeds[0].toJSON())).toContain("Ya existe");
    });
});

describe("el formulario /sugerencia", () => {
    const usuarioId = "sug-form";
    function canalFalso({ falla = false } = {}) {
        const enviados = [];
        return {
            enviados,
            canal: {
                id: CANAL,
                send: async (payload) => {
                    if (falla) throw new Error("Missing Permissions");
                    enviados.push(payload);
                    return { id: `msg-${enviados.length}` };
                },
            },
        };
    }
    const modal = (texto) => ({
        customId: "sugerencia_modal",
        guildId: G,
        user: { id: usuarioId },
        fields: { getTextInputValue: () => texto },
        reply: jest.fn(async () => {}),
    });

    test("sin canal configurado avisa a quien la envía antes de pedirle el texto", async () => {
        guildSettings.setSetting(G, "sugerencias.canal_id", "");
        const i = { guildId: G, user: { id: usuarioId }, reply: jest.fn(async () => {}), showModal: jest.fn(async () => {}) };
        await comando.run(null, i);
        expect(i.showModal).not.toHaveBeenCalled();
        expect(i.reply.mock.calls[0][0].content).toMatch(/todavía no está configurado/);
        expect(i.reply.mock.calls[0][0].flags).toBeDefined();
    });

    test("con canal, abre el formulario; al enviarlo publica la idea con su número y la guarda con su mensaje", async () => {
        const abre = { guildId: G, user: { id: usuarioId }, reply: jest.fn(), showModal: jest.fn(async () => {}) };
        await comando.run(null, abre);
        expect(abre.showModal.mock.calls[0][0].data.custom_id).toBe("sugerencia_modal");

        const { canal, enviados } = canalFalso();
        const i = modal("Un canal para recomendar libros");
        await comando.handleModal({ channels: { fetch: async () => canal } }, i);
        expect(enviados).toHaveLength(1);
        expect(enviados[0].embeds[0].toJSON().description).toContain("Un canal para recomendar libros");
        const guardada = db.prepare("SELECT id, channelId, messageId FROM sugerencias WHERE userId = ?").get(usuarioId);
        expect(guardada).toMatchObject({ channelId: CANAL, messageId: "msg-1" });
        expect(i.reply.mock.calls[0][0].content).toBe(`✅ Sugerencia #${guardada.id} enviada. Gracias.`);
    });

    test("si no se puede publicar, no cuenta para el tope diario y se avisa", async () => {
        const antes = sugerencias.enviadasRecientes("sug-falla");
        const { canal } = canalFalso({ falla: true });
        const i = { ...modal("Una idea que no llegará"), user: { id: "sug-falla" } };
        await comando.handleModal({ channels: { fetch: async () => canal } }, i);
        expect(i.reply.mock.calls[0][0].content).toMatch(/No he podido publicar/);
        expect(sugerencias.enviadasRecientes("sug-falla")).toBe(antes);
        const roto = { ...modal("Otra idea"), user: { id: "sug-falla" } };
        await comando.handleModal(
            {
                channels: {
                    fetch: async () => {
                        throw new Error("Unknown Channel");
                    },
                },
            },
            roto,
        );
        expect(roto.reply.mock.calls[0][0].content).toMatch(/No puedo escribir en el canal/);
    });

    test("el límite diario y un texto corto se contestan en privado sin publicar nada", async () => {
        const { canal, enviados } = canalFalso();
        const client = { channels: { fetch: async () => canal } };
        const corto = modal("hey");
        await comando.handleModal(client, corto);
        expect(corto.reply.mock.calls[0][0].content).toMatch(/al menos 5/);
        for (let i = 0; i < 3; i++) await comando.handleModal(client, { ...modal(`sugerencia número ${i}`), user: { id: "sug-tope" } });
        const cuarta = { ...modal("la cuarta del día"), user: { id: "sug-tope" } };
        await comando.handleModal(client, cuarta);
        expect(cuarta.reply.mock.calls[0][0].content).toMatch(/3 sugerencias/);
        expect(enviados).toHaveLength(3);
    });

    test("los botones 👍 y 👎 votan, cambian el voto y repintan el marcador en el propio mensaje", async () => {
        const s = sugerencias.crear({ guildId: G, userId: persona(), texto: "Idea con botones" }).sugerencia;
        const boton = (customId, userId) => ({
            customId,
            user: { id: userId },
            update: jest.fn(async () => {}),
            reply: jest.fn(async () => {}),
        });
        const a = persona();
        const arriba = boton(`sugerencia_voto_${s.id}_up`, a);
        await comando.handleButton(null, arriba);
        expect(arriba.update.mock.calls[0][0].components[0].toJSON().components[0].label).toBe("👍 1");
        const abajo = boton(`sugerencia_voto_${s.id}_down`, a);
        await comando.handleButton(null, abajo);
        expect(abajo.update.mock.calls[0][0].components[0].toJSON().components.map((c) => c.label)).toEqual(["👍 0", "👎 1"]);
        sugerencias.resolver(s.id, "aceptada", "admin-1");
        const tarde = boton(`sugerencia_voto_${s.id}_up`, persona());
        await comando.handleButton(null, tarde);
        expect(tarde.reply.mock.calls[0][0].content).toMatch(/ya está resuelta/);
    });
});

describe("la decisión de un admin", () => {
    const admin = { id: "admin-sug", tag: "admin#1" };
    function cliente(autor) {
        const dms = [];
        const editados = [];
        return {
            dms,
            editados,
            client: {
                users: { fetch: async (id) => ({ send: async (t) => dms.push({ id, t }) }) },
                channels: { fetch: async () => ({ messages: { edit: async (m, p) => editados.push({ m, p }) } }) },
                autor,
            },
        };
    }
    const enModal = (customId, motivo, client) => ({
        customId,
        guildId: G,
        client,
        user: admin,
        fields: { getTextInputValue: () => motivo },
        isFromMessage: () => true,
        update: jest.fn(async () => {}),
        reply: jest.fn(async () => {}),
    });

    test("el panel lista las pendientes y muestra la elegida con los botones de decidir", async () => {
        const s = sugerencias.crear({ guildId: G, userId: persona(), texto: "Revisar esto en el panel" }).sugerencia;
        const home = comunidad.buildComunidadHome(G);
        expect(JSON.stringify(home.embeds[0].toJSON().fields)).toContain("Pendientes");
        const lista = comunidad.buildRevisar(G);
        expect(lista.embeds[0].toJSON().description).toContain(`**#${s.id}**`);
        expect(idsDe(lista)).toContain("paneladmin_com_sug_sel");
        const sel = { customId: "paneladmin_com_sug_sel", guildId: G, values: [String(s.id)], update: jest.fn(async () => {}) };
        expect(await comunidad.handleComunidadStringSelect(sel)).toBe(true);
        expect(idsDe(sel.update.mock.calls[0][0])).toEqual([
            `paneladmin_com_sug_aceptada_${s.id}`,
            `paneladmin_com_sug_descartada_${s.id}`,
            "paneladmin_com_revisar",
        ]);
    });

    test("aceptar abre el formulario del motivo; al enviarlo se resuelve, el autor recibe el DM, el mensaje se repinta y queda auditado", async () => {
        const autor = persona();
        const s = sugerencias.crear({ guildId: G, userId: autor, texto: "Añadir un ranking de rachas" }).sugerencia;
        sugerencias.guardarMensaje(s.id, CANAL, "msg-resolver");
        const boton = {
            customId: `paneladmin_com_sug_aceptada_${s.id}`,
            guildId: G,
            showModal: jest.fn(async () => {}),
            update: jest.fn(),
        };
        expect(await comunidad.handleComunidadButton(boton)).toBe(true);
        expect(boton.showModal.mock.calls[0][0].data.custom_id).toBe(`paneladmin_com_sugmodal_aceptada_${s.id}`);

        const c = cliente(autor);
        const i = enModal(`paneladmin_com_sugmodal_aceptada_${s.id}`, "Buena idea, la apuntamos", c.client);
        expect(await comunidad.handleComunidadModal(i)).toBe(true);
        expect(sugerencias.obtener(s.id)).toMatchObject({ estado: "aceptada", motivo: "Buena idea, la apuntamos", resuelta_por: admin.id });
        expect(c.dms).toHaveLength(1);
        expect(c.dms[0].id).toBe(autor);
        expect(c.dms[0].t).toContain(`#${s.id}`);
        expect(c.dms[0].t).toContain("aceptada");
        expect(c.dms[0].t).toContain("Buena idea, la apuntamos");
        expect(c.editados[0].m).toBe("msg-resolver");
        expect(c.editados[0].p.components[0].toJSON().components.every((x) => x.disabled)).toBe(true);
        expect(i.update.mock.calls[0][0].embeds[0].toJSON().description).toContain("avisada por DM");
        const auditoria = adminAudit.listRecent(G, 5).find((a) => a.action === "sugerencia.aceptar");
        expect(auditoria).toMatchObject({ actorId: admin.id });
        expect(auditoria.details).toMatchObject({ id: s.id, autor, motivo: "Buena idea, la apuntamos" });
    });

    test("descartar sin motivo también se resuelve; una ya resuelta no se cambia, y con el aviso apagado no hay DM", async () => {
        const autor = persona();
        const s = sugerencias.crear({ guildId: G, userId: autor, texto: "Quitar todos los sonidos" }).sugerencia;
        avisosDm.fijar(autor, "sugerencia", false);
        const c = cliente(autor);
        const i = enModal(`paneladmin_com_sugmodal_descartada_${s.id}`, "", c.client);
        await comunidad.handleComunidadModal(i);
        expect(sugerencias.obtener(s.id)).toMatchObject({ estado: "descartada", motivo: null });
        expect(c.dms).toEqual([]);
        expect(i.update.mock.calls[0][0].embeds[0].toJSON().description).toContain("sin DM");
        expect(adminAudit.listRecent(G, 10).some((a) => a.action === "sugerencia.descartar")).toBe(true);

        const otra = enModal(`paneladmin_com_sugmodal_aceptada_${s.id}`, "", c.client);
        await comunidad.handleComunidadModal(otra);
        expect(sugerencias.obtener(s.id).estado).toBe("descartada");
        expect(otra.update.mock.calls[0][0].embeds[0].toJSON().description).toContain("ya está descartada");
        avisosDm.fijar(autor, "sugerencia", true);
    });

    test("el motivo no puede pasar de 300 caracteres y no se resuelve nada", async () => {
        const s = sugerencias.crear({ guildId: G, userId: persona(), texto: "Idea con motivo largo" }).sugerencia;
        expect(sugerencias.resolver(s.id, "aceptada", "a", "x".repeat(301)).mensaje).toMatch(/300 caracteres/);
        expect(sugerencias.obtener(s.id).estado).toBe("pendiente");
        expect(sugerencias.resolver(s.id, "rara", "a").ok).toBe(false);
    });

    test("solo los admins llegan al panel: lo comprueba el manejador de /paneladmin", async () => {
        const paneladmin = require("../src/commands/admin/paneladmin");
        const i = {
            customId: "paneladmin_com_revisar",
            guildId: G,
            user: { id: "no-admin", tag: "x#1" },
            memberPermissions: { has: () => false },
            member: { permissions: { has: () => false } },
            reply: jest.fn(async () => {}),
            update: jest.fn(async () => {}),
        };
        await paneladmin.handleButton(null, i);
        expect(i.update).not.toHaveBeenCalled();
        expect(i.reply.mock.calls[0][0].content).toMatch(/No tienes permisos/);
    });
});
