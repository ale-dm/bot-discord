// #435: bienvenida a quien entra al servidor. Con canal configurado se publica con la mención y la plantilla rellena ({usuario}
// y {miembros}); sin canal no pasa nada; un bot que entra no genera mensaje; y el canal y el texto se cambian en el panel de
// admin (⚙️ Config Global → 📣 Comunidad), igual que los canales de los cumpleaños y del buzón de sugerencias.
const guildSettings = require("../src/systems/guildSettings");
const bienvenida = require("../src/systems/bienvenida");
const comunidad = require("../src/adminPanel/comunidad");
const adminAudit = require("../src/systems/adminAudit");
const { fmtNumero } = require("../src/core/formato");

const G = "g-bienvenida";

function miembro({ bot = false, id = "nuevo-1", miembros = 1234, canalOk = true } = {}) {
    const enviados = [];
    const canal = { send: async (payload) => enviados.push(payload) };
    return {
        enviados,
        member: {
            id,
            user: { bot },
            guild: {
                id: G,
                name: "Servidor",
                memberCount: miembros,
                channels: {
                    cache: new Map(canalOk ? [["canal-bienvenida", canal]] : []),
                    fetch: async () => {
                        if (!canalOk) throw new Error("Unknown Channel");
                        return canal;
                    },
                },
            },
        },
    };
}

beforeEach(() => {
    guildSettings.setManySettings(G, { "bienvenida.canal_id": "canal-bienvenida", "bienvenida.texto": "" });
});

describe("la plantilla", () => {
    test("{usuario} es la mención y {miembros} el número de miembros, todas las veces que aparezcan", () => {
        const esperado = `Hola <@42>, ya somos ${fmtNumero(1500)}. ¡<@42>!`;
        expect(bienvenida.rellenar("Hola {usuario}, ya somos {miembros}. ¡{usuario}!", { usuarioId: "42", miembros: 1500 })).toBe(esperado);
        expect(bienvenida.rellenar("Sin marcas", { usuarioId: "42", miembros: 3 })).toBe("Sin marcas");
        expect(bienvenida.rellenar("{desconocido} {usuario}", { usuarioId: "7", miembros: 1 })).toBe("{desconocido} <@7>");
        expect(bienvenida.rellenar(undefined, { usuarioId: "7", miembros: 1 })).toBe("");
    });
});

describe("al entrar un miembro", () => {
    test("con canal configurado publica la bienvenida con la mención, el texto del admin y cómo empezar", async () => {
        guildSettings.setSetting(G, "bienvenida.texto", "¡Eh, {usuario}! Sois {miembros} ya.");
        const { member, enviados } = miembro({ id: "42", miembros: 77 });
        expect(await bienvenida.enviarBienvenida(member)).toBe(true);
        expect(enviados).toHaveLength(1);
        expect(enviados[0].content).toContain("¡Eh, <@42>! Sois 77 ya.");
        expect(enviados[0].content).toContain("`/perfil`");
        expect(enviados[0].content).toContain("`/ayuda`");
        expect(enviados[0].allowedMentions).toEqual({ users: ["42"] });
    });

    test("sin texto del admin sale uno por defecto en español", async () => {
        const { member, enviados } = miembro({ id: "43", miembros: 10 });
        await bienvenida.enviarBienvenida(member);
        expect(enviados[0].content).toContain("¡Bienvenido/a <@43>! Ya somos 10 en el servidor.");
        expect(enviados[0].content).toContain(bienvenida.COMO_EMPEZAR);
    });

    test("con el canal vacío no pasa nada", async () => {
        guildSettings.setSetting(G, "bienvenida.canal_id", "");
        const { member, enviados } = miembro();
        expect(await bienvenida.enviarBienvenida(member)).toBe(false);
        expect(enviados).toEqual([]);
        expect(bienvenida.bienvenidaDe(member)).toBeNull();
    });

    test("un bot que entra no genera ningún mensaje", async () => {
        const { member, enviados } = miembro({ bot: true });
        expect(bienvenida.bienvenidaDe(member)).toBeNull();
        expect(await bienvenida.enviarBienvenida(member)).toBe(false);
        expect(enviados).toEqual([]);
    });

    test("si el canal no existe o no se puede escribir, no lanza: queda en el log", async () => {
        const roto = miembro({ canalOk: false });
        await expect(bienvenida.enviarBienvenida(roto.member)).resolves.toBe(false);
        const { member } = miembro();
        member.guild.channels.cache.get("canal-bienvenida").send = async () => {
            throw new Error("Missing Permissions");
        };
        await expect(bienvenida.enviarBienvenida(member)).resolves.toBe(false);
    });

    test("la mención solo avisa a la persona nueva, aunque el texto del admin lleve otras", () => {
        guildSettings.setSetting(G, "bienvenida.texto", "Hola {usuario} @everyone <@999>");
        const { member } = miembro({ id: "44" });
        expect(bienvenida.bienvenidaDe(member).allowedMentions).toEqual({ users: ["44"] });
    });
});

describe("el panel 📣 Comunidad", () => {
    const base = { guildId: G, user: { id: "admin-com", tag: "admin#2" }, isFromMessage: () => true };
    const enviar = (customId, campos) => ({
        ...base,
        customId,
        fields: {
            getTextInputValue: (id) => campos[id] ?? "",
            getSelectedChannels: () => (campos.canal ? new Map([[campos.canal, {}]]) : null),
        },
        update: jest.fn(async () => {}),
        reply: jest.fn(async () => {}),
    });

    test("el botón de la bienvenida abre el formulario con el canal y el texto de ahora", async () => {
        guildSettings.setSetting(G, "bienvenida.texto", "Hola {usuario}");
        const i = { ...base, customId: "paneladmin_com_bienvenida", showModal: jest.fn(async () => {}) };
        expect(await comunidad.handleComunidadButton(i)).toBe(true);
        const json = i.showModal.mock.calls[0][0].toJSON();
        expect(json.custom_id).toBe("paneladmin_com_bienvenida_modal");
        const texto = json.components.flatMap((f) => f.components ?? []).find((c) => c.custom_id === "texto");
        expect(texto.value).toBe("Hola {usuario}");
        const canal = json.components.find((f) => f.component?.custom_id === "canal").component;
        expect(canal.default_values.map((d) => d.id)).toEqual(["canal-bienvenida"]);
    });

    test("guardar cambia canal y texto, queda en la auditoría y el panel lo enseña; vaciarlo lo apaga", async () => {
        const i = enviar("paneladmin_com_bienvenida_modal", { canal: "nuevo-canal", texto: "  ¡Bienvenido {usuario}!  " });
        expect(await comunidad.handleComunidadModal(i)).toBe(true);
        expect(guildSettings.getSettings(G).bienvenida).toEqual({ canal_id: "nuevo-canal", texto: "¡Bienvenido {usuario}!" });
        const payload = i.update.mock.calls[0][0];
        expect(payload.embeds[0].toJSON().description).toContain("<#nuevo-canal>");
        expect(JSON.stringify(payload.embeds[0].toJSON().fields)).toContain("¡Bienvenido {usuario}!");
        expect(adminAudit.listRecent(G, 5).find((a) => a.action === "comunidad.bienvenida").details).toMatchObject({
            canal: "nuevo-canal",
        });

        const vacio = enviar("paneladmin_com_bienvenida_modal", { canal: "", texto: "" });
        await comunidad.handleComunidadModal(vacio);
        expect(guildSettings.getSettings(G).bienvenida).toEqual({ canal_id: "", texto: "" });
        expect(vacio.update.mock.calls[0][0].embeds[0].toJSON().description).toContain("Ya no se da la bienvenida");
    });

    test("los canales de cumpleaños y del buzón se eligen igual, cada uno con su ajuste", async () => {
        const cumple = enviar("paneladmin_com_cumple_modal", { canal: "canal-cumples" });
        await comunidad.handleComunidadModal(cumple);
        expect(guildSettings.getSettings(G).avisos.cumple_channel_id).toBe("canal-cumples");
        const buzon = enviar("paneladmin_com_buzon_modal", { canal: "canal-buzon" });
        await comunidad.handleComunidadModal(buzon);
        expect(guildSettings.getSettings(G).sugerencias.canal_id).toBe("canal-buzon");
        for (const id of ["paneladmin_com_cumple", "paneladmin_com_buzon"]) {
            const abre = { ...base, customId: id, showModal: jest.fn(async () => {}) };
            expect(await comunidad.handleComunidadButton(abre)).toBe(true);
            expect(abre.showModal.mock.calls[0][0].toJSON().custom_id).toBe(`${id}_modal`);
        }
        const quitar = enviar("paneladmin_com_cumple_modal", { canal: "" });
        await comunidad.handleComunidadModal(quitar);
        expect(guildSettings.getSettings(G).avisos.cumple_channel_id).toBe("");
        expect(quitar.update.mock.calls[0][0].embeds[0].toJSON().description).toContain("Ya no se felicita");
    });

    test("está en Config Global y los botones que no son suyos no los atiende", async () => {
        const { buildConfigHome } = require("../src/adminPanel/settings");
        const ids = buildConfigHome(G).components.flatMap((f) => f.toJSON().components.map((c) => c.custom_id));
        expect(ids).toContain("paneladmin_com_home");
        expect(await comunidad.handleComunidadButton({ ...base, customId: "paneladmin_otra_cosa" })).toBe(false);
        expect(await comunidad.handleComunidadModal(enviar("paneladmin_otra_cosa_modal", {}))).toBe(false);
        const home = { ...base, customId: "paneladmin_com_home", update: jest.fn(async () => {}) };
        expect(await comunidad.handleComunidadButton(home)).toBe(true);
        expect(home.update.mock.calls[0][0].embeds[0].toJSON().title).toBe("📣 Comunidad");
    });
});
