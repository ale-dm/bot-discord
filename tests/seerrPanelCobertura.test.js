// Panel admin → Seerr (adminPanel/seerr.js): ver la configuración, probar la conexión, cambiar el límite diario de
// peticiones, el aviso al llegar lo pedido y los canales permitidos. Los permisos se comprueban por el router del
// panel. Los ajustes del servidor y la BD son los reales; solo se simulan la prueba HTTP y el canal de Discord.
const db = require("../src/core/db");
const guildSettings = require("../src/systems/guildSettings");
const seerrClient = require("../src/services/seerrClient");
const paneladmin = require("../src/commands/admin/paneladmin");
const { handleSeerrButton, handleSeerrChannelSelect, handleSeerrModal } = require("../src/adminPanel/seerr");

let n = 0;
const nuevoServidor = () => `g-seerr-panel-${++n}`;
const ADMIN = { has: (permiso) => permiso === "Administrator" };
const NO_ADMIN = { has: () => false };

function interaccion(extra = {}, { admin = true } = {}) {
    return {
        customId: "",
        guildId: "g-base",
        user: { id: "admin-1", username: "admin", tag: "admin#0001" },
        memberPermissions: admin ? ADMIN : NO_ADMIN,
        guild: { id: "g-base", channels: { cache: new Map() } },
        reply: jest.fn(async () => {}),
        update: jest.fn(async () => {}),
        showModal: jest.fn(async () => {}),
        deferReply: jest.fn(async () => {}),
        editReply: jest.fn(async () => {}),
        fields: { getTextInputValue: () => "" },
        values: [],
        ...extra,
    };
}

function campos(valores) {
    return { getTextInputValue: (id) => valores[id] ?? "" };
}

const ultimo = (mock) => mock.mock.calls.at(-1)[0];
const descripcion = (payload) => payload.embeds[0].data.description;
const etiquetas = (payload) => payload.components.flatMap((f) => f.components.map((b) => b.data.label));
const auditoria = (guildId, accion) =>
    db.prepare("SELECT details FROM admin_audit WHERE guildId = ? AND action = ? ORDER BY id DESC LIMIT 1").get(guildId, accion);

const ID_CANAL = "123456789012345678";

function servidorConfigurado() {
    const g = nuevoServidor();
    guildSettings.setSetting(g, "seerr.url", "https://seerr.local");
    return g;
}

afterEach(() => jest.restoreAllMocks());

describe("permisos: solo un admin toca Seerr", () => {
    test("un no admin no puede probar la conexión", async () => {
        const prueba = jest.spyOn(seerrClient, "testConnection");
        const i = interaccion({ customId: "paneladmin_seerr_test" }, { admin: false });

        await paneladmin.handleButton({}, i);

        expect(ultimo(i.reply).content).toBe("No tienes permisos.");
        expect(prueba).not.toHaveBeenCalled();
    });

    test("un no admin no puede añadir un canal permitido", async () => {
        const g = nuevoServidor();
        const i = interaccion({ guildId: g, customId: "paneladmin_seerr_channel_add_select", values: [ID_CANAL] }, { admin: false });

        await paneladmin.handleChannelSelect({}, i);

        expect(ultimo(i.reply).content).toBe("No tienes permisos.");
        expect(seerrClient.getAllowedChannels(g)).toEqual([]);
    });

    test("un no admin no puede cambiar el límite desde el formulario", async () => {
        const g = servidorConfigurado();
        const i = interaccion({ guildId: g, customId: "paneladmin_seerr_limit_modal", fields: campos({ limit: "1" }) }, { admin: false });

        await paneladmin.handleModal({}, i);

        expect(ultimo(i.reply).content).toBe("No tienes permisos.");
        expect(guildSettings.getSettings(g).seerr.daily_request_limit).toBe(5);
    });
});

describe("pantalla principal de Seerr", () => {
    test("muestra servidor, límite, canales y avisos con sus valores", async () => {
        const g = servidorConfigurado();
        const i = interaccion({ guildId: g, customId: "paneladmin_seerr_home" });

        await handleSeerrButton(i);

        const texto = descripcion(ultimo(i.update));
        expect(texto).toContain("Servidor Seerr: https://seerr.local");
        expect(texto).toContain("Límite de peticiones por IA y por persona: 5/día");
        expect(texto).toContain("Canales donde se puede pedir/buscar contenido: todos (sin restricción)");
        expect(texto).toContain('Avisar cuando llega lo pedido ("ya está en Plex"): sí, por DM (no hay canal de novedades de Plex)');
    });

    test("sin URL configurada lo dice", async () => {
        jest.spyOn(seerrClient, "getConfig").mockReturnValue({ url: "", dailyRequestLimit: 5 });
        const i = interaccion({ guildId: nuevoServidor(), customId: "paneladmin_seerr_home" });

        await handleSeerrButton(i);

        expect(descripcion(ultimo(i.update))).toContain("Servidor Seerr: no configurado");
    });

    test("con canal de novedades de Plex, los avisos mencionan a quien lo pidió", async () => {
        const g = servidorConfigurado();
        guildSettings.setSetting(g, "plex.novedades_channel_id", "999888777666555444");
        const i = interaccion({ guildId: g, customId: "paneladmin_seerr_home" });

        await handleSeerrButton(i);

        expect(descripcion(ultimo(i.update))).toContain("sí, mencionando a quien lo pidió en <#999888777666555444>");
    });

    test("con los avisos apagados lo dice y el botón ofrece encenderlos", async () => {
        const g = servidorConfigurado();
        guildSettings.setSetting(g, "seerr.avisar_disponible", false);
        const i = interaccion({ guildId: g, customId: "paneladmin_seerr_home" });

        await handleSeerrButton(i);

        const payload = ultimo(i.update);
        expect(descripcion(payload)).toContain('Avisar cuando llega lo pedido ("ya está en Plex"): no');
        expect(etiquetas(payload)).toContain("🔔 Avisar al llegar");
    });

    test("con canales permitidos los lista", async () => {
        const g = servidorConfigurado();
        seerrClient.addAllowedChannel(g, "111", "uno");
        seerrClient.addAllowedChannel(g, "222", "dos");
        const i = interaccion({ guildId: g, customId: "paneladmin_seerr_home" });

        await handleSeerrButton(i);

        expect(descripcion(ultimo(i.update))).toContain("Canales donde se puede pedir/buscar contenido: <#222>, <#111>");
    });
});

describe("botones de Seerr", () => {
    test("probar la conexión responde en privado con la versión del servidor", async () => {
        const g = servidorConfigurado();
        const prueba = jest.spyOn(seerrClient, "testConnection").mockResolvedValue({ ok: true, version: "2.1.0" });
        const i = interaccion({ guildId: g, customId: "paneladmin_seerr_test" });

        await handleSeerrButton(i);

        expect(prueba).toHaveBeenCalledWith(g);
        expect(i.deferReply).toHaveBeenCalledWith({ flags: 64 });
        expect(i.editReply).toHaveBeenCalledWith("✅ Conexión con Seerr correcta (v2.1.0).");
    });

    test("si la conexión falla lo dice con el motivo", async () => {
        const g = servidorConfigurado();
        jest.spyOn(seerrClient, "testConnection").mockResolvedValue({ ok: false, error: "ECONNREFUSED" });
        const i = interaccion({ guildId: g, customId: "paneladmin_seerr_test" });

        await handleSeerrButton(i);

        expect(i.editReply).toHaveBeenCalledWith("❌ No se pudo conectar con Seerr: ECONNREFUSED");
    });

    test("el botón de avisos alterna el ajuste, lo audita y repinta la pantalla", async () => {
        const g = servidorConfigurado();
        expect(guildSettings.getSettings(g).seerr.avisar_disponible).toBe(true);

        const apagar = interaccion({ guildId: g, customId: "paneladmin_seerr_avisos" });
        await handleSeerrButton(apagar);
        expect(guildSettings.getSettings(g).seerr.avisar_disponible).toBe(false);
        expect(JSON.parse(auditoria(g, "seerr.avisos").details)).toEqual({ activo: false });
        expect(etiquetas(ultimo(apagar.update))).toContain("🔔 Avisar al llegar");

        const encender = interaccion({ guildId: g, customId: "paneladmin_seerr_avisos" });
        await handleSeerrButton(encender);
        expect(guildSettings.getSettings(g).seerr.avisar_disponible).toBe(true);
        expect(etiquetas(ultimo(encender.update))).toContain("🔕 No avisar al llegar");
    });

    test("el botón de límite abre el formulario con el campo del número", async () => {
        const i = interaccion({ customId: "paneladmin_seerr_limit" });

        await handleSeerrButton(i);

        const modal = ultimo(i.showModal);
        expect(modal.data.custom_id).toBe("paneladmin_seerr_limit_modal");
        expect(modal.components[0].components[0].data.custom_id).toBe("limit");
    });

    test("permitir canal pide el canal con un selector de texto o anuncios", async () => {
        const i = interaccion({ customId: "paneladmin_seerr_channel_add" });

        await handleSeerrButton(i);

        const respuesta = ultimo(i.reply);
        expect(respuesta.components[0].components[0].data.custom_id).toBe("paneladmin_seerr_channel_add_select");
        expect(respuesta.flags).toBe(64);
    });

    test("quitar canal abre el formulario con el ID del canal", async () => {
        const i = interaccion({ customId: "paneladmin_seerr_channel_remove" });

        await handleSeerrButton(i);

        const modal = ultimo(i.showModal);
        expect(modal.data.custom_id).toBe("paneladmin_seerr_channel_remove_modal");
        expect(modal.components[0].components[0].data.custom_id).toBe("channel_id");
    });

    test("sin restricción borra todos los canales y lo audita", async () => {
        const g = servidorConfigurado();
        seerrClient.addAllowedChannel(g, "111", "uno");
        const i = interaccion({ guildId: g, customId: "paneladmin_seerr_channel_clear" });

        await handleSeerrButton(i);

        expect(seerrClient.getAllowedChannels(g)).toEqual([]);
        expect(auditoria(g, "seerr.channels.clear")).toBeDefined();
        expect(ultimo(i.reply).content).toContain("Sin restricción");
    });

    test("un botón que no es de Seerr no lo gestiona este módulo", async () => {
        expect(await handleSeerrButton(interaccion({ customId: "paneladmin_otra_cosa" }))).toBe(false);
    });
});

describe("selector de canal permitido", () => {
    test("añade el canal con su nombre cuando lo tiene en caché y lo audita", async () => {
        const g = servidorConfigurado();
        const i = interaccion({
            guildId: g,
            customId: "paneladmin_seerr_channel_add_select",
            values: [ID_CANAL],
            guild: { id: g, channels: { cache: new Map([[ID_CANAL, { id: ID_CANAL, name: "peticiones" }]]) } },
        });

        expect(await handleSeerrChannelSelect(i)).toBe(true);

        expect(seerrClient.getAllowedChannels(g)).toEqual([{ channelId: ID_CANAL, channelName: "peticiones" }]);
        expect(ultimo(i.reply).content).toBe(`✅ Seerr permitido en <#${ID_CANAL}>.`);
        expect(JSON.parse(auditoria(g, "seerr.channels.add").details)).toEqual({ channelId: ID_CANAL });
    });

    test("si el canal no está en caché lo añade sin nombre", async () => {
        const g = servidorConfigurado();
        const i = interaccion({ guildId: g, customId: "paneladmin_seerr_channel_add_select", values: [ID_CANAL] });

        await handleSeerrChannelSelect(i);

        expect(seerrClient.getAllowedChannels(g)).toEqual([{ channelId: ID_CANAL, channelName: null }]);
    });

    test("ignora otros selectores", async () => {
        expect(await handleSeerrChannelSelect(interaccion({ customId: "otro", values: [ID_CANAL] }))).toBe(false);
    });
});

describe("formularios de Seerr", () => {
    test("quitar canal: un ID que no tiene 17 a 19 cifras se rechaza", async () => {
        const g = servidorConfigurado();
        seerrClient.addAllowedChannel(g, ID_CANAL, "x");
        const i = interaccion({
            guildId: g,
            customId: "paneladmin_seerr_channel_remove_modal",
            fields: campos({ channel_id: "canal-raro" }),
        });

        await handleSeerrModal(i);

        expect(ultimo(i.reply).content).toBe("ID de canal inválido.");
        expect(seerrClient.getAllowedChannels(g)).toHaveLength(1);
    });

    test("quitar canal: con un ID válido (con espacios alrededor) lo quita y lo audita", async () => {
        const g = servidorConfigurado();
        seerrClient.addAllowedChannel(g, ID_CANAL, "x");
        const i = interaccion({
            guildId: g,
            customId: "paneladmin_seerr_channel_remove_modal",
            fields: campos({ channel_id: `  ${ID_CANAL} ` }),
        });

        expect(await handleSeerrModal(i)).toBe(true);

        expect(seerrClient.getAllowedChannels(g)).toEqual([]);
        expect(JSON.parse(auditoria(g, "seerr.channels.remove").details)).toEqual({ channelId: ID_CANAL });
        expect(ultimo(i.reply).content).toBe("✅ Canal quitado de la lista de Seerr.");
    });

    test.each([
        ["abc", "no es un número"],
        ["-1", "es negativo"],
        ["Infinity", "no es finito"],
    ])("límite inválido («%s»: %s) no cambia el ajuste", async (valor) => {
        const g = servidorConfigurado();
        const i = interaccion({ guildId: g, customId: "paneladmin_seerr_limit_modal", fields: campos({ limit: valor }) });

        await handleSeerrModal(i);

        expect(ultimo(i.reply).content).toBe("Número inválido.");
        expect(guildSettings.getSettings(g).seerr.daily_request_limit).toBe(5);
    });

    test("un límite válido se guarda y se audita", async () => {
        const g = servidorConfigurado();
        const i = interaccion({ guildId: g, customId: "paneladmin_seerr_limit_modal", fields: campos({ limit: " 7 " }) });

        await handleSeerrModal(i);

        expect(guildSettings.getSettings(g).seerr.daily_request_limit).toBe(7);
        expect(ultimo(i.reply).content).toBe("✅ Límite diario de peticiones IA: 7.");
        expect(JSON.parse(auditoria(g, "seerr.limit.set").details)).toEqual({ limit: 7 });
    });

    test("un límite de 0 significa sin límite", async () => {
        const g = servidorConfigurado();
        const i = interaccion({ guildId: g, customId: "paneladmin_seerr_limit_modal", fields: campos({ limit: "0" }) });

        await handleSeerrModal(i);

        expect(guildSettings.getSettings(g).seerr.daily_request_limit).toBe(0);
        expect(ultimo(i.reply).content).toBe("✅ Límite diario de peticiones IA: sin límite.");
    });

    test("un formulario que no es de Seerr no lo gestiona este módulo", async () => {
        expect(await handleSeerrModal(interaccion({ customId: "paneladmin_otro_modal" }))).toBe(false);
    });
});
