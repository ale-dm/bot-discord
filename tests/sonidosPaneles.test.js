// 🔊 Sonidos avanzados, la parte de Discord: el panel de /sonidos (buscar, categorías, aleatorio, más usados, 🔒), lo que pasa al
// pulsar (roles, cooldown, cola), el sonido de entrada de /conectar y los ajustes de /paneladmin → 🔊 Sonidos. Todo simulado.
const db = require("../src/core/db");
const guildSettings = require("../src/systems/guildSettings");
const sonidos = require("../src/systems/sonidos");
const ajustes = require("../src/systems/sonidos/ajustes");
const eventos = require("../src/systems/sonidos/eventos");
const { pantallaSonidos } = require("../src/paneles/sonidos");
const sonidosCmd = require("../src/commands/voz/sonidos");
const conectar = require("../src/commands/voz/conectar");
const admin = require("../src/adminPanel/sonidos");

const G = "g-sonidos-paneles";
const EFIMERO = 64;
let contador = 0;

function nuevo(nombre, categoria) {
    const id = db
        .prepare("INSERT INTO sonidos (guildId, nombre, archivo, creado_por, creado_en) VALUES (?, ?, ?, 'a', 0)")
        .run(G, nombre, `${nombre}.mp3`).lastInsertRowid;
    if (categoria) ajustes.fijarCategoria(G, id, categoria);
    return id;
}
const botones = (payload) => payload.components.flatMap((f) => f.components.map((b) => b.data));
const etiquetas = (payload) => botones(payload).map((b) => b.label);

beforeEach(() => {
    db.prepare("DELETE FROM sonido_roles WHERE sonidoId IN (SELECT id FROM sonidos WHERE guildId = ?)").run(G);
    db.prepare("DELETE FROM sonidos_eventos WHERE guildId = ?").run(G);
    db.prepare("DELETE FROM sonidos WHERE guildId = ?").run(G);
    guildSettings.setManySettings(G, { "sonidos.apagado": false, "sonidos.silencio_desde": "", "sonidos.silencio_hasta": "" });
});
afterEach(() => jest.restoreAllMocks());

describe("el panel de /sonidos", () => {
    test("buscar «gol» muestra solo los que lo contienen, y se puede volver a la lista completa", () => {
        nuevo("Gol de Messi");
        nuevo("GOLazo");
        nuevo("Risa");
        const filtrado = pantallaSonidos(G, 0, { texto: "gol" });
        expect(etiquetas(filtrado)).toEqual(["🔊 Gol de Messi", "🔊 GOLazo", "❌ Quitar búsqueda", "🎲 Aleatorio", "🏆 Más usados"]);
        expect(filtrado.embeds[0].data.footer.text).toMatch(/2 sonidos · nombre con «gol»/);
        expect(botones(filtrado).find((b) => b.label === "❌ Quitar búsqueda").custom_id).toBe("sonido_limpiar|");
        expect(etiquetas(pantallaSonidos(G, 0))).toContain("🔍 Buscar");
        expect(pantallaSonidos(G, 0).embeds[0].data.footer.text).toMatch(/3 sonidos$/);
    });

    test("una búsqueda sin resultados avisa, quita la paginación y deja quitar la búsqueda", () => {
        nuevo("Risa");
        const p = pantallaSonidos(G, 7, { texto: "zzz" });
        expect(p.embeds[0].data.description).toMatch(/No hay sonidos con nombre con «zzz»/);
        expect(etiquetas(p)).toEqual(["❌ Quitar búsqueda", "🎲 Aleatorio", "🏆 Más usados"]);
        expect(p.embeds[0].data.footer).toBeUndefined();
    });

    test("con categorías sale el menú, 15 sonidos por página, y el filtro viaja en los botones de página", () => {
        for (let i = 0; i < 16; i++) nuevo(`Meme ${String(i).padStart(2, "0")}`, "memes");
        nuevo("Suelto");
        const p = pantallaSonidos(G, 0);
        const menu = p.components[0].components[0];
        expect(menu.data.custom_id).toBe("sonido_categoria");
        expect(menu.options.map((o) => o.data.label)).toEqual(["Todas", "memes", "Sin categoría"]);
        expect(botones(p).filter((b) => b.custom_id.startsWith("sonido_play_"))).toHaveLength(15);

        const memes = pantallaSonidos(G, 0, { categoria: "memes", texto: "meme" });
        expect(memes.components[0].components[0].options.find((o) => o.data.default).data.value).toBe("memes");
        expect(
            botones(memes)
                .filter((b) => b.custom_id.startsWith("sonido_pagina_"))
                .map((b) => b.custom_id),
        ).toEqual(["sonido_pagina_-1|memes|meme", "sonido_pagina_1|memes|meme"]);
        expect(
            pantallaSonidos(G, 0, { categoria: "Sin categoría" })
                .components.at(-2)
                .components.map((b) => b.data.label),
        ).toEqual(["🔊 Suelto"]);
    });

    test("los sonidos con roles llevan 🔒", () => {
        const id = nuevo("Interno");
        nuevo("Abierto");
        ajustes.fijarRoles(id, ["r1"]);
        expect(etiquetas(pantallaSonidos(G, 0))).toEqual(expect.arrayContaining(["🔒 Interno", "🔊 Abierto"]));
    });

    test("sin ningún sonido en el servidor no hay botones", () => {
        expect(pantallaSonidos(G, 0).components).toEqual([]);
    });
});

describe("pulsar en /sonidos", () => {
    function interaccion(
        customId,
        { member = { voice: { channel: null }, roles: { cache: new Set() } }, admin: esAdmin = false, extra = {} } = {},
    ) {
        return {
            customId,
            guildId: G,
            member,
            memberPermissions: { has: () => esAdmin },
            user: { id: `persona${++contador}`, tag: "p#1" },
            values: [],
            reply: jest.fn(async () => {}),
            update: jest.fn(async () => {}),
            deferReply: jest.fn(async () => {}),
            editReply: jest.fn(async () => {}),
            showModal: jest.fn(async () => {}),
            isStringSelectMenu: () => customId === "sonido_categoria",
            ...extra,
        };
    }
    const sonar = (impl) =>
        jest.spyOn(sonidos, "reproducir").mockImplementation(impl ?? (async (g, c, s, d) => (d.alEmpezar(), { ok: true })));

    test("el menú de categorías filtra desde la primera página, y «Todas» quita el filtro", async () => {
        nuevo("Meme", "memes");
        nuevo("Otro");
        const i = interaccion("sonido_categoria", { extra: { values: ["memes"] } });
        await sonidosCmd.handleButton({}, i);
        expect(etiquetas(i.update.mock.calls[0][0])).toContain("🔊 Meme");
        expect(etiquetas(i.update.mock.calls[0][0])).not.toContain("🔊 Otro");
        const todas = interaccion("sonido_categoria", { extra: { values: ["*"] } });
        await sonidosCmd.handleButton({}, todas);
        expect(etiquetas(todas.update.mock.calls[0][0])).toEqual(expect.arrayContaining(["🔊 Meme", "🔊 Otro"]));
    });

    test("🔍 abre el formulario con la categoría, y al enviarlo el panel se filtra", async () => {
        nuevo("Gol", "fútbol");
        nuevo("Golazo");
        const abre = interaccion("sonido_buscar|fútbol");
        await sonidosCmd.handleButton({}, abre);
        expect(abre.showModal.mock.calls[0][0].toJSON().custom_id).toBe("sonido_modal_buscar|fútbol");

        const envia = interaccion("sonido_modal_buscar|fútbol", { extra: { fields: { getTextInputValue: () => "  GOL | " } } });
        await sonidosCmd.handleModal({}, envia);
        const panel = envia.update.mock.calls[0][0];
        expect(etiquetas(panel)).toContain("🔊 Gol");
        expect(etiquetas(panel)).not.toContain("🔊 Golazo");
        expect(panel.embeds[0].data.footer.text).toMatch(/categoría «fútbol» y nombre con «GOL»/);
    });

    test("la paginación y quitar la búsqueda conservan lo que toca del filtro", async () => {
        nuevo("Gol", "fútbol");
        const pagina = interaccion("sonido_pagina_0|fútbol|gol");
        await sonidosCmd.handleButton({}, pagina);
        expect(pagina.update.mock.calls[0][0].embeds[0].data.footer.text).toMatch(/categoría «fútbol» y nombre con «gol»/);
        const limpiar = interaccion("sonido_limpiar|fútbol");
        await sonidosCmd.handleButton({}, limpiar);
        expect(limpiar.update.mock.calls[0][0].embeds[0].data.footer.text).toMatch(/categoría «fútbol»$/);
    });

    test("🏆 enseña los más usados en privado", async () => {
        const id = nuevo("Famoso");
        ajustes.contar(id);
        ajustes.contar(id);
        const i = interaccion("sonido_top");
        await sonidosCmd.handleButton({}, i);
        expect(i.reply.mock.calls[0][0].content).toMatch(/Los sonidos más usados\*\*\n\*\*1\.\*\* Famoso — 2 veces/);
        expect(i.reply.mock.calls[0][0].flags).toBe(EFIMERO);
    });

    test("🎲 toca uno al azar de los que puede usar, y con la lista vacía avisa en vez de fallar", async () => {
        const vacio = interaccion("sonido_azar");
        await sonidosCmd.handleButton({}, vacio);
        expect(vacio.reply.mock.calls[0][0].content).toMatch(/Todavía no hay sonidos/);

        const [a, b] = [nuevo("Abierto"), nuevo("Cerrado")];
        ajustes.fijarRoles(b, ["r1"]);
        const reproducir = sonar();
        for (let n = 0; n < 5; n++) {
            await sonidosCmd.handleButton({}, interaccion("sonido_azar"));
        }
        expect(reproducir).toHaveBeenCalledTimes(5);
        expect(reproducir.mock.calls.every((c) => c[2].id === a)).toBe(true); // el 🔒 no sale a quien no tiene el rol
    });

    test("un sonido con roles avisa en privado a quien no los tiene, y suena a quien sí", async () => {
        const id = nuevo("Equipo");
        ajustes.fijarRoles(id, ["rol-a", "rol-b"]);
        const reproducir = sonar();
        const sin = interaccion(`sonido_play_${id}`);
        await sonidosCmd.handleButton({}, sin);
        expect(sin.reply.mock.calls[0][0].content).toBe("🔒 Ese sonido es solo para <@&rol-a>, <@&rol-b>.");
        expect(sin.deferReply).not.toHaveBeenCalled();
        expect(reproducir).not.toHaveBeenCalled();

        const con = interaccion(`sonido_play_${id}`, {
            member: { voice: { channel: { name: "General" } }, roles: { cache: new Set(["rol-b"]) } },
        });
        await sonidosCmd.handleButton({}, con);
        expect(reproducir).toHaveBeenCalledTimes(1);
        expect(con.editReply).toHaveBeenCalledWith("🔊 Sonando **Equipo** en General.");
    });

    test("dos sonidos seguidos de la misma persona en menos de 10 s: el segundo se rechaza, salvo a los admins", async () => {
        const id = nuevo("Seguido");
        const reproducir = sonar();
        const primera = interaccion(`sonido_play_${id}`);
        await sonidosCmd.handleButton({}, primera);
        const otra = interaccion(`sonido_play_${id}`);
        otra.user = primera.user;
        await sonidosCmd.handleButton({}, otra);
        expect(otra.reply.mock.calls[0][0].content).toMatch(/^⏱️ Espera \d+ s antes de pedir otro sonido\.$/);
        expect(reproducir).toHaveBeenCalledTimes(1);

        const admin1 = interaccion(`sonido_play_${id}`, { admin: true });
        await sonidosCmd.handleButton({}, admin1);
        const admin2 = interaccion(`sonido_play_${id}`, { admin: true });
        admin2.user = admin1.user;
        await sonidosCmd.handleButton({}, admin2);
        expect(reproducir).toHaveBeenCalledTimes(3);
    });

    test("un sonido que no se pudo tocar no deja a la persona en cooldown", async () => {
        const id = nuevo("Fallido");
        sonar(async () => ({ ok: false, motivo: "Entra en un canal de voz." }));
        const i = interaccion(`sonido_play_${id}`);
        await sonidosCmd.handleButton({}, i);
        const otra = interaccion(`sonido_play_${id}`);
        otra.user = i.user;
        await sonidosCmd.handleButton({}, otra);
        expect(otra.reply).not.toHaveBeenCalled();
        expect(otra.editReply).toHaveBeenCalledWith("❌ Entra en un canal de voz.");
    });

    test("si suena otro, se dice el puesto en la cola y luego pasa a «Sonando»", async () => {
        const id = nuevo("Turno");
        sonar(async (g, c, s, d) => {
            d.alEncolar(2);
            d.alEmpezar();
            return { ok: true };
        });
        const i = interaccion(`sonido_play_${id}`, { member: { voice: { channel: { name: "General" } }, roles: { cache: new Set() } } });
        await sonidosCmd.handleButton({}, i);
        expect(i.editReply.mock.calls.map((c) => c[0])).toEqual(["📋 **Turno** en cola, puesto 2.", "🔊 Sonando **Turno** en General."]);
    });
});

describe("/conectar con sonido de entrada (#301)", () => {
    const interaccion = (sonido, canal = { id: "c1", name: "General" }) => ({
        guildId: G,
        user: { id: "ana" },
        member: { voice: { channel: canal }, roles: { cache: new Set() } },
        options: { getChannel: () => canal, getString: () => sonido },
        reply: jest.fn(async () => {}),
        deferReply: jest.fn(async () => {}),
        editReply: jest.fn(async () => {}),
    });
    const entrar = () =>
        jest
            .spyOn(require("../src/systems/presencia"), "conectar")
            .mockResolvedValue({ ok: true, canal: "General", expira: Date.now() + 60000 });

    test("la opción sonido admite autocompletado con los sonidos que encajan", async () => {
        nuevo("Gol");
        nuevo("Golazo");
        nuevo("Risa");
        expect(conectar.data.options.find((o) => o.name === "sonido").toJSON().autocomplete).toBe(true);
        const respond = jest.fn(async () => {});
        await conectar.autocomplete({}, { guildId: G, options: { getFocused: () => "gol" }, respond });
        expect(respond.mock.calls[0][0].map((o) => o.name)).toEqual(["Gol", "Golazo"]);
        expect(typeof respond.mock.calls[0][0][0].value).toBe("string");
    });

    test("el autocompletado nunca pasa de las 25 opciones de Discord", async () => {
        for (let i = 0; i < 30; i++) nuevo(`Sonido ${String(i).padStart(2, "0")}`);
        const respond = jest.fn(async () => {});
        await conectar.autocomplete({}, { guildId: G, options: { getFocused: () => "" }, respond });
        expect(respond.mock.calls[0][0]).toHaveLength(25);
    });

    test("sin sonido, entra sin tocar nada; con sonido, lo toca una vez sin cola y sin esperar a que acabe", async () => {
        entrar();
        const reproducir = jest.spyOn(sonidos, "reproducir").mockResolvedValue({ ok: true });
        await conectar.run(null, interaccion(null));
        expect(reproducir).not.toHaveBeenCalled();

        const id = nuevo("Entrada");
        const i = interaccion(String(id));
        await conectar.run(null, i);
        expect(reproducir).toHaveBeenCalledTimes(1);
        expect(reproducir).toHaveBeenCalledWith(G, null, expect.objectContaining({ id }), { sinCola: true });
        expect(i.editReply.mock.calls[0][0]).toMatch(/Conectado a \*\*General\*\*/);
    });

    test("si el sonido ya no existe, no se puede tocar o es de otros roles, la conexión sigue igual y se avisa", async () => {
        entrar();
        const reproducir = jest.spyOn(sonidos, "reproducir").mockResolvedValue({ ok: false, motivo: "silencio" });
        const roto = interaccion("999999");
        await conectar.run(null, roto);
        expect(roto.editReply.mock.calls[0][0]).toMatch(/Conectado.*Ese sonido ya no existe/s);

        const cerrado = nuevo("Cerrado");
        ajustes.fijarRoles(cerrado, ["r1"]);
        const sinRol = interaccion(String(cerrado));
        await conectar.run(null, sinRol);
        expect(sinRol.editReply.mock.calls[0][0]).toMatch(/Conectado.*solo para algunos roles/s);
        expect(reproducir).not.toHaveBeenCalled();

        const normal = nuevo("Normal");
        const i = interaccion(String(normal));
        await conectar.run(null, i);
        await Promise.resolve();
        expect(i.editReply.mock.calls[0][0]).toMatch(/Conectado/); // el motivo del fallo solo va al log
    });
});

describe("ajustes de /paneladmin → 🔊 Sonidos", () => {
    const ctx = (customId, extra = {}) => ({
        customId,
        guildId: G,
        user: { id: "admin", tag: "admin#1" },
        values: [],
        reply: jest.fn(async () => {}),
        update: jest.fn(async () => {}),
        showModal: jest.fn(async () => {}),
        ...extra,
    });
    const campos = (valores = {}, roles = []) => ({
        getTextInputValue: (id) => valores[id] ?? "",
        getRadioGroup: (id) => valores[id] ?? "0",
        getSelectedRoles: () => new Map(roles.map((r) => [r, {}])),
    });
    const respuesta = (i) => i.reply.mock.calls[0][0].content;

    test("la pantalla principal tiene horario, eventos y más usados, y dice el estado del silencio", () => {
        const p = admin.buildSonidosHome(G);
        expect(p.components[1].components.map((b) => b.data.custom_id)).toEqual([
            "paneladmin_sonidos_horario",
            "paneladmin_sonidos_eventos",
            "paneladmin_sonidos_ranking",
        ]);
        expect(p.embeds[0].data.description).toMatch(/Sin horario de silencio/);
        guildSettings.setManySettings(G, { "sonidos.silencio_desde": "22:00", "sonidos.silencio_hasta": "08:00" });
        expect(admin.buildSonidosHome(G).embeds[0].data.description).toMatch(/de \*\*22:00\*\* a \*\*08:00\*\* \(hora de Madrid\)/);
        guildSettings.setSetting(G, "sonidos.apagado", true);
        expect(admin.buildSonidosHome(G).embeds[0].data.description).toMatch(/apagados\*\* del todo/);
    });

    test("la lista del panel enseña la categoría de cada sonido", () => {
        nuevo("Gol", "fútbol");
        expect(admin.buildSonidosHome(G).embeds[0].data.description).toMatch(/🔊 Gol · 🏷️ fútbol/);
    });

    test("volumen: el botón abre el formulario con el valor actual y al enviarlo se guarda, con su rango", async () => {
        const id = nuevo("Flojo");
        const abre = ctx(`paneladmin_sonidos_volumen_${id}`);
        expect(await admin.handleSonidosButton(abre)).toBe(true);
        expect(abre.showModal.mock.calls[0][0].toJSON().custom_id).toBe(`paneladmin_sonidos_modal_volumen_${id}`);

        const bien = ctx(`paneladmin_sonidos_modal_volumen_${id}`, { fields: campos({ volumen: "150" }) });
        expect(await admin.handleSonidosModal(bien)).toBe(true);
        expect(respuesta(bien)).toBe("✅ **Flojo** suena al 150 %.");
        expect(sonidos.obtener(G, id).volumen).toBe(150);
        const mal = ctx(`paneladmin_sonidos_modal_volumen_${id}`, { fields: campos({ volumen: "500" }) });
        await admin.handleSonidosModal(mal);
        expect(respuesta(mal)).toMatch(/^❌ El volumen es un número entero entre 25 y 200/);
        expect(sonidos.obtener(G, id).volumen).toBe(150);
    });

    test("categoría: se pone y se quita con el formulario", async () => {
        const id = nuevo("Memez");
        const pone = ctx(`paneladmin_sonidos_modal_categoria_${id}`, { fields: campos({ categoria: "memes" }) });
        await admin.handleSonidosModal(pone);
        expect(respuesta(pone)).toBe("✅ **Memez** está en «memes».");
        const quita = ctx(`paneladmin_sonidos_modal_categoria_${id}`, { fields: campos({ categoria: "" }) });
        await admin.handleSonidosModal(quita);
        expect(respuesta(quita)).toBe("✅ **Memez** sin categoría.");
        expect(sonidos.obtener(G, id).categoria).toBeNull();
    });

    test("roles: el formulario enseña los actuales y al enviarlo se asignan o se quitan", async () => {
        const id = nuevo("Equipo");
        ajustes.fijarRoles(id, ["r1"]);
        const abre = ctx(`paneladmin_sonidos_roles_${id}`);
        await admin.handleSonidosButton(abre);
        const selector = abre.showModal.mock.calls[0][0].toJSON().components[0].component;
        expect(selector.default_values).toEqual([{ id: "r1", type: "role" }]);

        const asigna = ctx(`paneladmin_sonidos_modal_roles_${id}`, { fields: campos({}, ["r2", "r3"]) });
        await admin.handleSonidosModal(asigna);
        expect(respuesta(asigna)).toBe("✅ **Equipo** solo para <@&r2>, <@&r3>.");
        expect(ajustes.rolesDe(id)).toEqual(["r2", "r3"]);
        const quita = ctx(`paneladmin_sonidos_modal_roles_${id}`, { fields: campos({}, []) });
        await admin.handleSonidosModal(quita);
        expect(respuesta(quita)).toBe("✅ **Equipo** vuelve a ser de todos.");
        expect(ajustes.rolesDe(id)).toEqual([]);
    });

    test("un sonido que ya no existe se dice en el botón y en el formulario", async () => {
        const boton = ctx("paneladmin_sonidos_volumen_999999");
        await admin.handleSonidosButton(boton);
        expect(boton.update.mock.calls[0][0].content).toBe("Ese sonido ya no existe.");
        const modal = ctx("paneladmin_sonidos_modal_roles_999999", { fields: campos() });
        await admin.handleSonidosModal(modal);
        expect(respuesta(modal)).toBe("❌ Ese sonido ya no existe.");
    });

    test("horario: guarda las dos horas y el interruptor; con horas mal escritas no cambia nada", async () => {
        const abre = ctx("paneladmin_sonidos_horario");
        await admin.handleSonidosButton(abre);
        expect(abre.showModal.mock.calls[0][0].toJSON().custom_id).toBe("paneladmin_sonidos_modal_horario");

        const bien = ctx("paneladmin_sonidos_modal_horario", { fields: campos({ desde: "22:00", hasta: "8:00", apagado: "0" }) });
        await admin.handleSonidosModal(bien);
        expect(respuesta(bien)).toMatch(/de \*\*22:00\*\* a \*\*08:00\*\*/);
        expect(guildSettings.getSettings(G).sonidos).toMatchObject({ silencio_desde: "22:00", silencio_hasta: "08:00", apagado: false });

        const apaga = ctx("paneladmin_sonidos_modal_horario", { fields: campos({ desde: "22:00", hasta: "08:00", apagado: "1" }) });
        await admin.handleSonidosModal(apaga);
        expect(guildSettings.getSettings(G).sonidos).toMatchObject({ silencio_desde: "22:00", apagado: true }); // el horario se conserva

        const mal = ctx("paneladmin_sonidos_modal_horario", { fields: campos({ desde: "99:00", hasta: "08:00" }) });
        await admin.handleSonidosModal(mal);
        expect(respuesta(mal)).toMatch(/^❌ Escribe las dos horas como HH:MM/);
        expect(guildSettings.getSettings(G).sonidos.silencio_desde).toBe("22:00");

        const quita = ctx("paneladmin_sonidos_modal_horario", { fields: campos({ desde: "", hasta: "", apagado: "0" }) });
        await admin.handleSonidosModal(quita);
        expect(respuesta(quita)).toMatch(/Sin horario de silencio/);
    });

    test("eventos: la pantalla lista los eventos, se elige sonido con un menú paginado y se puede quitar", async () => {
        const id = nuevo("Fanfarria");
        const pantalla = ctx("paneladmin_sonidos_eventos");
        await admin.handleSonidosButton(pantalla);
        const inicial = pantalla.update.mock.calls[0][0];
        expect(inicial.embeds[0].data.description).toMatch(/Logro desbloqueado: sin sonido/);
        expect(inicial.components[1].components.every((b) => b.data.disabled)).toBe(true); // nada que quitar

        const elegir = ctx("paneladmin_sonidos_evento_apuesta_grande");
        await admin.handleSonidosButton(elegir);
        const menu = elegir.update.mock.calls[0][0].components[0].components[0];
        expect(menu.data.custom_id).toBe("paneladmin_sonidos_evento_apuesta_grande_select");
        expect(menu.options.map((o) => o.data.label)).toEqual(["Fanfarria"]);

        const asigna = ctx("paneladmin_sonidos_evento_apuesta_grande_select", { values: [String(id)] });
        expect(await admin.handleSonidosStringSelect(asigna)).toBe(true);
        expect(asigna.update.mock.calls[0][0].content).toMatch(/✅ \*\*Fanfarria\*\* suena con «💰 Apuesta ganada grande/);
        expect(eventos.asociados(G)).toEqual([{ evento: "apuesta_grande", sonidoId: id, nombre: "Fanfarria" }]);

        const quita = ctx("paneladmin_sonidos_evento_quitar_apuesta_grande");
        await admin.handleSonidosButton(quita);
        expect(eventos.asociados(G)).toEqual([]);
    });

    test("eventos: un sonido borrado entre medias se dice; un evento inventado no hace nada", async () => {
        const borrado = ctx("paneladmin_sonidos_evento_logro_select", { values: ["999999"] });
        await admin.handleSonidosStringSelect(borrado);
        expect(borrado.update.mock.calls[0][0].content).toBe("Ese sonido ya no existe.");
        expect(await admin.handleSonidosStringSelect(ctx("paneladmin_sonidos_evento_inventado_select", { values: ["1"] }))).toBe(false);
        expect(await admin.handleSonidosButton(ctx("paneladmin_sonidos_evento_inventado"))).toBe(false);
    });

    test("eventos: el intervalo se guarda como número entero de minutos", async () => {
        const abre = ctx("paneladmin_sonidos_intervalo");
        await admin.handleSonidosButton(abre);
        expect(abre.showModal).toHaveBeenCalled();
        const bien = ctx("paneladmin_sonidos_modal_intervalo", { fields: campos({ minutos: "15" }) });
        await admin.handleSonidosModal(bien);
        expect(respuesta(bien)).toBe("✅ Un evento suena como mucho cada 15 min.");
        expect(guildSettings.getSettings(G).sonidos.eventos_minutos).toBe(15);
        for (const malo of ["", "-1", "abc", "1.5", "2000"]) {
            const mal = ctx("paneladmin_sonidos_modal_intervalo", { fields: campos({ minutos: malo }) });
            await admin.handleSonidosModal(mal);
            expect(respuesta(mal)).toMatch(/^❌ Escribe los minutos/);
        }
        expect(guildSettings.getSettings(G).sonidos.eventos_minutos).toBe(15);
    });

    test("más usados: la pantalla enseña el ranking con la vuelta al panel", async () => {
        const id = nuevo("Famoso");
        ajustes.contar(id);
        const i = ctx("paneladmin_sonidos_ranking");
        await admin.handleSonidosButton(i);
        const p = i.update.mock.calls[0][0];
        expect(p.embeds[0].data.description).toBe("**1.** Famoso — 1 vez");
        expect(p.components[0].components[0].data.custom_id).toBe("paneladmin_sonidos_home");
    });
});
