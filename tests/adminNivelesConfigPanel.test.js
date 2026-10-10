// Panel admin → Niveles → Configuración (#238): vista de parámetros, formularios con valores actuales, guardado de
// mensajes, voz, multiplicador, fórmula y racha, vista previa de la curva y canal de anuncios. Usa la base de datos
// en memoria real (xpSystem) para comprobar lo que queda guardado.
const xp = require("../src/systems/xpSystem");
const { boton, modal, selectCanal } = require("../src/adminPanel/niveles/config");

const G = "g-admin-niveles-config";

function interaccion(extra = {}) {
    return {
        customId: "",
        guildId: G,
        guild: { id: G },
        user: { id: "admin-1", username: "admin", tag: "admin#0001" },
        reply: jest.fn(async () => {}),
        update: jest.fn(async () => {}),
        showModal: jest.fn(async () => {}),
        fields: { getTextInputValue: () => "" },
        values: [],
        ...extra,
    };
}

function campos(valores) {
    return { getTextInputValue: (id) => valores[id] ?? "", getRadioGroup: (id) => valores[id] ?? "" };
}

const ultimo = (mock) => mock.mock.calls.at(-1)[0];
// Los selectores (radio) van en su etiqueta: se lee su opción marcada.
const valorDeFila = (fila) =>
    fila.component
        ? [fila.component.custom_id, fila.component.options.find((o) => o.default)?.value]
        : [fila.components[0].custom_id, fila.components[0].value];
const valoresDeModal = (m) => Object.fromEntries(m.toJSON().components.map(valorDeFila));

describe("vista de configuración", () => {
    test("muestra los parámetros actuales y los botones de cada ajuste", async () => {
        xp.setConfig(G, "xp_multiplier", 2.5);
        const i = interaccion({ customId: "paneladmin_levels_config" });
        expect(await boton(i)).toBe(true);
        const embed = ultimo(i.update).embeds[0].data;
        const multiplicador = embed.fields.find((f) => f.name === "Multiplicador");
        expect(multiplicador.value).toBe("x2.5");
        const ids = ultimo(i.update).components.flatMap((f) => f.components.map((c) => c.data.custom_id));
        expect(ids).toEqual(
            expect.arrayContaining([
                "paneladmin_levels_cfg_msg",
                "paneladmin_levels_cfg_voice",
                "paneladmin_levels_cfg_mult",
                "paneladmin_levels_cfg_formula",
                "paneladmin_levels_cfg_channel",
                "paneladmin_levels_cfg_streak",
                "paneladmin_levels_formula_preview",
                "paneladmin_levels_home",
            ]),
        );
    });

    test("con la racha desactivada lo indica", async () => {
        xp.setConfig(G, "streak_enabled", "0");
        const i = interaccion({ customId: "paneladmin_levels_config" });
        await boton(i);
        const racha = ultimo(i.update).embeds[0].data.fields.find((f) => f.name === "Racha diaria");
        expect(racha.value).toBe("Desactivada");
    });

    test("el canal de anuncios se muestra o dice que no está configurado", async () => {
        xp.setConfig(G, "xp_announce_channel_id", "");
        const sin = interaccion({ customId: "paneladmin_levels_config" });
        await boton(sin);
        expect(ultimo(sin.update).embeds[0].data.fields.find((f) => f.name === "Canal anuncio").value).toBe("No configurado");

        xp.setConfig(G, "xp_announce_channel_id", "555");
        const con = interaccion({ customId: "paneladmin_levels_config" });
        await boton(con);
        expect(ultimo(con.update).embeds[0].data.fields.find((f) => f.name === "Canal anuncio").value).toBe("<#555>");
    });
});

describe("formularios con los valores actuales", () => {
    test("cada botón abre su modal con los valores guardados", async () => {
        xp.setConfig(G, "xp_message_base", 12);
        xp.setConfig(G, "xp_voice_per_min", 4);
        xp.setConfig(G, "xp_multiplier", 1.5);
        xp.setConfig(G, "streak_enabled", "1");

        const msg = interaccion({ customId: "paneladmin_levels_cfg_msg" });
        await boton(msg);
        expect(ultimo(msg.showModal).data.custom_id).toBe("paneladmin_levels_cfg_msg_modal");
        expect(valoresDeModal(ultimo(msg.showModal)).xp_base).toBe("12");

        const voz = interaccion({ customId: "paneladmin_levels_cfg_voice" });
        await boton(voz);
        expect(valoresDeModal(ultimo(voz.showModal)).xp_voice).toBe("4");

        const mult = interaccion({ customId: "paneladmin_levels_cfg_mult" });
        await boton(mult);
        expect(valoresDeModal(ultimo(mult.showModal)).xp_mult).toBe("1.5");
    });

    test("el formulario de fórmula trae los cuatro parámetros", async () => {
        const i = interaccion({ customId: "paneladmin_levels_cfg_formula" });
        await boton(i);
        expect(Object.keys(valoresDeModal(ultimo(i.showModal)))).toEqual(["formula_base", "formula_exp", "cost_mult", "req_mult"]);
    });

    test("la racha muestra si/no según esté activada", async () => {
        xp.setConfig(G, "streak_enabled", "0");
        const off = interaccion({ customId: "paneladmin_levels_cfg_streak" });
        await boton(off);
        expect(valoresDeModal(ultimo(off.showModal)).enabled).toBe("no");

        xp.setConfig(G, "streak_enabled", "1");
        const on = interaccion({ customId: "paneladmin_levels_cfg_streak" });
        await boton(on);
        expect(valoresDeModal(ultimo(on.showModal)).enabled).toBe("si");
    });
});

describe("guardado de mensajes, voz y multiplicador", () => {
    test("la config de mensajes guarda base, bonus y cooldown, con mínimos", async () => {
        const i = interaccion({
            customId: "paneladmin_levels_cfg_msg_modal",
            fields: campos({ xp_base: "0", xp_bonus: "-5", xp_cd: "30" }),
        });
        await modal(i);
        const cfg = xp.getAllConfig(G);
        expect(Number(cfg.xp_message_base)).toBe(1);
        expect(Number(cfg.xp_message_len_bonus_max)).toBe(0);
        expect(Number(cfg.xp_message_cooldown_sec)).toBe(30);
        expect(ultimo(i.reply).content).toContain("Config mensajes actualizada");
    });

    test("la XP de voz no baja de cero", async () => {
        const i = interaccion({ customId: "paneladmin_levels_cfg_voice_modal", fields: campos({ xp_voice: "-3" }) });
        await modal(i);
        expect(Number(xp.getAllConfig(G).xp_voice_per_min)).toBe(0);
        expect(ultimo(i.reply).content).toContain("XP voz actualizada");
    });

    test("el multiplicador se guarda y se confirma", async () => {
        const i = interaccion({ customId: "paneladmin_levels_cfg_mult_modal", fields: campos({ xp_mult: "2" }) });
        await modal(i);
        expect(Number(xp.getAllConfig(G).xp_multiplier)).toBe(2);
        expect(ultimo(i.reply).content).toBe("✅ Multiplicador x2.");
    });
});

describe("fórmula de XP", () => {
    test("los parámetros se guardan y los que bajan de su mínimo se suben", async () => {
        const i = interaccion({
            customId: "paneladmin_levels_cfg_formula_modal",
            fields: campos({ formula_base: "0.5", formula_exp: "1.4", cost_mult: "0", req_mult: "2" }),
        });
        await modal(i);
        const cfg = xp.getAllConfig(G);
        expect(Number(cfg.xp_formula_base)).toBe(1);
        expect(Number(cfg.xp_formula_exp)).toBeCloseTo(1.4);
        expect(Number(cfg.xp_level_cost_multiplier)).toBe(1);
        expect(Number(cfg.xp_level_requirement_multiplier)).toBe(2);
        expect(ultimo(i.reply).content).toContain("Fórmula 1 × (N+1)^1.4 × 1 × 2");
    });

    test("la vista previa lista los niveles con título y el XP acumulado", async () => {
        const i = interaccion({ customId: "paneladmin_levels_formula_preview" });
        expect(await boton(i)).toBe(true);
        const embed = ultimo(i.reply).embeds[0].data;
        expect(embed.title).toContain("Vista previa");
        expect(embed.description).toContain("Fórmula actual");
        expect(embed.description).toContain("**LVL 5**");
        expect(embed.description).toContain("XP acumulado");
    });
});

describe("racha diaria", () => {
    test("un valor no numérico se rechaza sin cambiar nada", async () => {
        xp.setConfig(G, "streak_bonus_pct_per_day", 3);
        const i = interaccion({
            customId: "paneladmin_levels_cfg_streak_modal",
            fields: campos({ enabled: "si", pct_per_day: "mucho", cap_pct: "10" }),
        });
        await modal(i);
        expect(ultimo(i.reply).content).toBe("Valores inválidos.");
        expect(Number(xp.getAllConfig(G).streak_bonus_pct_per_day)).toBe(3);
    });

    test("desactivarla con «no» guarda streak_enabled en 0 y lo confirma", async () => {
        const i = interaccion({
            customId: "paneladmin_levels_cfg_streak_modal",
            fields: campos({ enabled: "no", pct_per_day: "2", cap_pct: "14" }),
        });
        await modal(i);
        expect(xp.getAllConfig(G).streak_enabled).toBe("0");
        expect(ultimo(i.reply).content).toBe("✅ Racha desactivada: +2%/día (máx +14%).");
    });

    test("cualquier respuesta distinta de no/n/0/false la activa", async () => {
        const i = interaccion({
            customId: "paneladmin_levels_cfg_streak_modal",
            fields: campos({ enabled: "si", pct_per_day: "1", cap_pct: "5" }),
        });
        await modal(i);
        expect(xp.getAllConfig(G).streak_enabled).toBe("1");
        expect(ultimo(i.reply).content).toContain("activada");
    });
});

describe("canal de anuncios", () => {
    test("abre el selector de canal con la opción de quitarlo", async () => {
        const i = interaccion({ customId: "paneladmin_levels_cfg_channel" });
        await boton(i);
        const filas = ultimo(i.reply).components;
        expect(filas[0].components[0].data.custom_id).toBe("paneladmin_levels_cfg_channel_select");
        expect(filas[1].components[0].data.custom_id).toBe("paneladmin_levels_cfg_channel_clear");
    });

    test("elegir un canal lo guarda como canal de anuncios", async () => {
        const i = interaccion({ customId: "paneladmin_levels_cfg_channel_select", values: ["777"] });
        expect(await selectCanal(i)).toBe(true);
        expect(xp.getAllConfig(G).xp_announce_channel_id).toBe("777");
        expect(ultimo(i.reply).content).toContain("<#777>");
    });

    test("quitar el canal vacía la configuración", async () => {
        xp.setConfig(G, "xp_announce_channel_id", "777");
        const i = interaccion({ customId: "paneladmin_levels_cfg_channel_clear" });
        await boton(i);
        expect(xp.getAllConfig(G).xp_announce_channel_id).toBe("");
        expect(ultimo(i.update).content).toContain("Canal de anuncios eliminado");
    });

    test("selectCanal ignora otros selectores", async () => {
        expect(await selectCanal(interaccion({ customId: "otro", values: ["1"] }))).toBe(false);
    });
});

describe("enrutado", () => {
    test("un botón o modal que no es suyo devuelve false", async () => {
        expect(await boton(interaccion({ customId: "paneladmin_otra_cosa" }))).toBe(false);
        expect(await modal(interaccion({ customId: "paneladmin_otra_cosa" }))).toBe(false);
    });
});
