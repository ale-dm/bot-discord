// 🗳️ Elecciones en Discord: publicar el panel, el ciclo completo con el cron (anuncios, programas por DM solo a quien puede
// votar y no lo tiene apagado, rol al presidente y limpieza al acabar el mandato), votar con botones en secreto o en público,
// los poderes de /presidente con sus protecciones (admins, staff, bots, roles más altos, espera, máximo de minutos, canales)
// y la sección del panel admin. BD en memoria y un servidor de Discord falso.
const db = require("../src/core/db");
const guildSettings = require("../src/systems/guildSettings");
const avisosDm = require("../src/systems/avisosDm");
const adminAudit = require("../src/systems/adminAudit");
const { ajustes, fases, candidatos, repo, presidencia: repoP } = require("../src/systems/elecciones");
const envios = require("../src/discord/envios/elecciones");
const acciones = require("../src/discord/envios/presidencia");
const eleccionesCmd = require("../src/commands/general/elecciones");
const presidenteCmd = require("../src/commands/general/presidente");
const { mensajeEleccion } = require("../src/paneles/elecciones/panel");
const paneladmin = require("../src/commands/admin/paneladmin");

const G = "g-elec-discord";
const DIA = ajustes.DIA_MS;
const AHORA = 1_800_000_000_000;
const VETERANO = AHORA - 100 * DIA;

let guild;
let client;
let canalElecciones;

function miembro(id, { bot = false, admin = false, posicion = 1, enVoz = "voz-1", unidoEn = VETERANO, roles = [] } = {}) {
    const cache = new Set(roles);
    const voice = { channelId: enVoz };
    Object.assign(voice, {
        setChannel: jest.fn(async (c) => (voice.channelId = c.id)),
        disconnect: jest.fn(async () => (voice.channelId = null)),
        setMute: jest.fn(async () => {}),
        setDeaf: jest.fn(async () => {}),
    });
    return {
        id,
        displayName: `Nombre ${id}`,
        joinedTimestamp: unidoEn,
        user: { id, bot, send: jest.fn(async () => {}) },
        permissions: { has: (p) => admin && p === "Administrator" },
        roles: {
            highest: { position: posicion },
            cache: { has: (r) => cache.has(r) },
            add: jest.fn(async (role) => cache.add(role.id)),
            remove: jest.fn(async (role) => cache.delete(role.id)),
        },
        voice,
    };
}

function montar(ids = ["a", "b", "c", "votante"], extra = {}) {
    const ms = new Map(ids.map((id) => [id, miembro(id)]));
    for (const [id, opciones] of Object.entries(extra)) ms.set(id, miembro(id, opciones));
    const canales = new Map();
    let n = 0;
    canalElecciones = { id: "c-elec", send: jest.fn(async () => ({ id: `msg-${++n}` })), messages: { edit: jest.fn(async () => {}) } };
    guild = {
        id: G,
        name: "Servidor",
        roles: { cache: new Map([["rol-pres", { id: "rol-pres", position: 5, managed: false, name: "Presidente" }]]) },
        members: {
            me: { roles: { highest: { position: 10 } }, permissions: { has: () => true } },
            fetch: jest.fn(async (arg) => {
                if (arg === undefined) return ms;
                if (typeof arg === "string") return ms.get(arg) || Promise.reject(new Error("Unknown Member"));
                return new Map(arg.user.filter((id) => ms.has(id)).map((id) => [id, ms.get(id)]));
            }),
        },
        channels: {
            create: jest.fn(async ({ name, parent }) => {
                const canal = { id: `nuevo-${++n}`, name, parent, delete: jest.fn(async () => canales.delete(canal.id)) };
                canales.set(canal.id, canal);
                return canal;
            }),
            fetch: jest.fn(async (id) => canales.get(id) || null),
        },
    };
    client = { user: { id: "bot" }, guilds: { cache: new Map([[G, guild]]) }, channels: { fetch: jest.fn(async () => canalElecciones) } };
    return ms;
}

const m = (id) => guild.members.fetch(id);
const ids = (p) => p.components.flatMap((f) => f.toJSON().components.map((c) => c.custom_id));
const ultimo = (mock) => mock.mock.calls.at(-1)[0];

beforeEach(() => {
    for (const t of ["elecciones_votos", "elecciones_candidatos", "presidencia_acciones", "presidencia_canales", "presidencia_sanciones"]) {
        db.prepare(`DELETE FROM ${t}`).run();
    }
    db.prepare("DELETE FROM elecciones").run();
    db.prepare("DELETE FROM guild_settings WHERE guildId = ?").run(G);
    db.prepare("DELETE FROM preferencias_dm").run();
    db.prepare("DELETE FROM admin_audit WHERE guildId = ?").run(G);
    guildSettings.invalidarAjustes(G);
    guildSettings.setSetting(G, "elecciones.canal", "c-elec");
    guildSettings.setSetting(G, "elecciones.rol_presidente", "rol-pres");
    montar();
});

/** Abre, inscribe a `quienes` y vota hasta que `ganador` es presidente. */
async function hastaElMandato(quienes = ["a", "b"], ganador = "a") {
    const r = await envios.abrirYPublicar(client, G, "admin", AHORA);
    for (const u of quienes) candidatos.inscribir({ guildId: G, userId: u, esBot: false, unidoEn: VETERANO, ahora: AHORA });
    const fin = () => repo.activa(G).fase_fin;
    await envios.revisar(client, fin(), { pausaMs: 0 }); // → programas
    await envios.revisar(client, fin(), { pausaMs: 0 }); // → generales
    const votacion = repo.activa(G);
    repo.guardarVoto({
        eleccionId: votacion.id,
        fase: "generales",
        votanteId: "votante",
        candidatoId: ganador,
        publico: false,
        ahora: AHORA,
    });
    await envios.revisar(client, fin(), { pausaMs: 0 }); // → mandato
    return r.eleccion;
}

describe("ciclo con el cron", () => {
    test("sin canal configurado no se pueden abrir; con canal se publica el panel de inscripción", async () => {
        guildSettings.setSetting(G, "elecciones.canal", "");
        expect(await envios.abrirYPublicar(client, G, "admin", AHORA)).toMatchObject({ ok: false });
        guildSettings.setSetting(G, "elecciones.canal", "c-elec");
        const r = await envios.abrirYPublicar(client, G, "admin", AHORA);
        expect(r.ok).toBe(true);
        expect(ids(ultimo(canalElecciones.send))).toEqual([`elec_inscribir_${r.eleccion.id}`, `elec_retirar_${r.eleccion.id}`]);
        expect(repo.obtener(r.eleccion.id)).toMatchObject({ channelId: "c-elec", messageId: "msg-1" });
    });

    test("al empezar las generales el programa llega por DM solo a quien puede votar y no lo tiene apagado", async () => {
        const ms = montar(["a", "b", "votante", "callado"], { robot: { bot: true }, novato: { unidoEn: AHORA + 4 * DIA } });
        avisosDm.fijar("callado", "elecciones", false);
        await envios.abrirYPublicar(client, G, "admin", AHORA);
        ["a", "b"].forEach((u) => candidatos.inscribir({ guildId: G, userId: u, esBot: false, unidoEn: VETERANO, ahora: AHORA }));
        await envios.revisar(client, repo.activa(G).fase_fin, { pausaMs: 0 });
        candidatos.guardarPrograma({ guildId: G, userId: "a", titulo: "Plan A", texto: "Más canales de voz para todos." });
        await envios.revisar(client, repo.activa(G).fase_fin, { pausaMs: 0 });
        expect(repo.activa(G).estado).toBe("generales");
        const recibieron = [...ms.values()].filter((x) => x.user.send.mock.calls.length).map((x) => x.id);
        expect(recibieron.sort()).toEqual(["a", "b", "votante"]);
        const dm = ultimo(ms.get("votante").user.send);
        expect(dm.embeds.map((e) => e.toJSON().title)).toEqual(["📜 Plan A", "📜 Sin programa"]);
        expect(canalElecciones.send.mock.calls.some(([p]) => /Empiezan las elecciones generales/.test(p.content))).toBe(true);
    });

    test("el ganador recibe el rol de presidente y al acabar el mandato lo pierde, con sus canales y castigos", async () => {
        guildSettings.setSetting(G, "elecciones.categoria_presidente", "cat-pres");
        const eleccion = await hastaElMandato();
        const presidente = await m("a");
        expect(presidente.roles.cache.has("rol-pres")).toBe(true);
        const ctx = { guild, eleccion: repo.activa(G), presidente, ahora: AHORA };
        expect((await acciones.crearCanal(ctx, "despacho", "texto")).ok).toBe(true);
        expect((await acciones.sancionar(ctx, await m("b"), "silencio", 10)).ok).toBe(true);
        await envios.revisar(client, repo.activa(G).fase_fin, { pausaMs: 0 });
        expect(repo.obtener(eleccion.id).estado).toBe("cerrada");
        expect(presidente.roles.cache.has("rol-pres")).toBe(false);
        expect(repoP.canalesActivos(eleccion.id)).toHaveLength(0);
        expect((await m("b")).voice.setMute).toHaveBeenLastCalledWith(false, expect.any(String));
    });

    test("con reinicio automático, al acabar el mandato se abren otras elecciones", async () => {
        guildSettings.setSetting(G, "elecciones.auto_reiniciar", true);
        const eleccion = await hastaElMandato();
        await envios.revisar(client, repo.activa(G).fase_fin, { pausaMs: 0 });
        expect(repo.activa(G)).toMatchObject({ estado: "inscripcion" });
        expect(repo.activa(G).id).not.toBe(eleccion.id);
    });
});

describe("votar con botones", () => {
    const boton = (customId, extra = {}) => ({
        customId,
        guildId: G,
        guild,
        user: { id: "votante", bot: false },
        member: { joinedTimestamp: VETERANO },
        reply: jest.fn(async () => {}),
        update: jest.fn(async () => {}),
        showModal: jest.fn(async () => {}),
        ...extra,
    });

    async function enPrimarias() {
        await envios.abrirYPublicar(client, G, "admin", Date.now());
        for (const u of ["a", "b", "c", "d", "e"]) candidatos.inscribir({ guildId: G, userId: u, esBot: false, unidoEn: VETERANO });
        fases.adelantar(G, Date.now());
        await envios.revisar(client, Date.now(), { pausaMs: 0 });
        return repo.activa(G);
    }

    test("🗳️ Votar → elegir candidato → 📢 público deja el voto guardado y visible en el panel", async () => {
        const e = await enPrimarias();
        expect(e.estado).toBe("primarias");
        const i1 = boton(`elec_votar_${e.id}`);
        await eleccionesCmd.handleButton(client, i1);
        const paso1 = ultimo(i1.reply);
        expect(paso1.components[0].toJSON().components[0].options.map((o) => o.label)).toContain("Nombre a");

        const i2 = boton(`elec_elegir_${e.id}`, { values: ["c"] });
        await eleccionesCmd.handleSelect(client, i2);
        expect(ids(ultimo(i2.update))).toEqual([`elec_modo_${e.id}_c_s`, `elec_modo_${e.id}_c_p`, `elec_votar_${e.id}`]);

        const i3 = boton(`elec_modo_${e.id}_c_p`);
        await eleccionesCmd.handleButton(client, i3);
        expect(ultimo(i3.update).content).toMatch(/Has votado a <@c> \(📢 público\)/);
        expect(repo.votoDe(e.id, "primarias", "votante")).toMatchObject({ candidatoId: "c", publico: 1 });
        const panel = canalElecciones.messages.edit.mock.calls.at(-1)[1];
        const campos = panel.embeds[0].toJSON().fields;
        expect(campos.find((f) => f.name === "📢 Últimos votos públicos").value).toBe("<@votante> → <@c>");
    });

    test("un voto secreto suma en el recuento pero no sale en el panel", async () => {
        const e = await enPrimarias();
        await eleccionesCmd.handleButton(client, boton(`elec_modo_${e.id}_c_s`));
        const campos = mensajeEleccion(repo.activa(G)).embeds[0].toJSON().fields;
        expect(campos.find((f) => f.name === "Recuento").value).toMatch(/^1 voto · 0 📢 públicos/);
        expect(campos.some((f) => f.name === "📢 Últimos votos públicos")).toBe(false);
    });

    test("los botones de unas elecciones que ya acabaron no hacen nada", async () => {
        const i = boton("elec_votar_999");
        await eleccionesCmd.handleButton(client, i);
        expect(ultimo(i.reply).content).toMatch(/ya han terminado/);
    });

    test("el panel de cada fase respeta los límites de Discord", async () => {
        const e = await enPrimarias();
        for (const estado of ["inscripcion", "primarias", "programas", "generales", "mandato", "cerrada"]) {
            const p = mensajeEleccion({ ...e, estado, presidenteId: "a" });
            expect(p.components.length).toBeLessThanOrEqual(5);
            expect(p.components.every((f) => f.components.length <= 5)).toBe(true);
            expect(new Set(ids(p)).size).toBe(ids(p).length);
        }
    });
});

describe("/presidente", () => {
    const comando = (sub, opciones = {}, userId = "a") => ({
        guildId: G,
        guild,
        user: { id: userId },
        member: null,
        options: {
            getSubcommand: () => sub,
            getUser: () => (opciones.usuario ? { id: opciones.usuario } : null),
            getChannel: () => opciones.canal || null,
            getInteger: () => opciones.minutos ?? null,
            getString: (n) => opciones[n] ?? null,
        },
        reply: jest.fn(async () => {}),
        deferReply: jest.fn(async () => {}),
        editReply: jest.fn(async () => {}),
    });
    const ejecutar = async (sub, opciones, userId = "a") => {
        const i = comando(sub, opciones, userId);
        i.member = await m(userId).catch(() => null);
        await presidenteCmd.run(client, i);
        const r = i.editReply.mock.calls.at(-1)?.[0] ?? i.reply.mock.calls.at(-1)?.[0];
        return typeof r === "string" ? r : r.content;
    };

    beforeEach(async () => {
        montar(["a", "b", "votante", "c"], {
            jefa: { admin: true },
            moderador: { roles: ["rol-staff"] },
            alto: { posicion: 8 },
            robot: { bot: true },
        });
        guildSettings.setSetting(G, "moderacion.staff_rol", "rol-staff");
        await hastaElMandato();
    });

    test("solo el presidente puede usar sus poderes; el estado lo ve cualquiera", async () => {
        expect(await ejecutar("desconectar", { usuario: "c" }, "b")).toMatch(/Solo el presidente/);
        const i = comando("estado", {}, "b");
        await presidenteCmd.run(client, i);
        expect(ultimo(i.reply).embeds[0].toJSON().description).toMatch(/<@a> es el presidente/);
    });

    test("nunca puede actuar sobre admins, staff, bots, roles más altos ni sobre sí mismo", async () => {
        expect(await ejecutar("desconectar", { usuario: "jefa" })).toMatch(/admins y el staff/);
        expect(await ejecutar("desconectar", { usuario: "moderador" })).toMatch(/admins y el staff/);
        expect(await ejecutar("desconectar", { usuario: "robot" })).toMatch(/bots/);
        expect(await ejecutar("desconectar", { usuario: "alto" })).toMatch(/por encima/);
        expect(await ejecutar("desconectar", { usuario: "a" })).toMatch(/contigo mismo/);
        expect((await m("jefa")).voice.disconnect).not.toHaveBeenCalled();
    });

    test("mueve a alguien de canal y después tiene que esperar para volver a actuar sobre esa persona", async () => {
        const destino = { id: "voz-2", isVoiceBased: () => true };
        expect(await ejecutar("mover", { usuario: "c", canal: destino })).toMatch(/Has movido/);
        expect((await m("c")).voice.setChannel).toHaveBeenCalledWith(destino, expect.any(String));
        expect(await ejecutar("desconectar", { usuario: "c" })).toMatch(/espera 5 min/);
        expect(adminAudit.listRecent(G, 50).map((r) => r.action)).toContain("elecciones.presidente_mover");
    });

    test("silenciar tiene un máximo de minutos y el cron lo revierte al acabar si sigue en voz", async () => {
        expect(await ejecutar("silenciar", { usuario: "c", minutos: 31 })).toMatch(/de 1 a 30 minutos/);
        expect(await ejecutar("silenciar", { usuario: "c", minutos: 10 })).toMatch(/silencio para <@c>/);
        const c = await m("c");
        expect(c.voice.setMute).toHaveBeenCalledWith(true, expect.any(String));
        c.voice.channelId = null;
        expect(await acciones.revertirSanciones(client, Date.now() + 11 * 60000)).toBe(0);
        c.voice.channelId = "voz-1";
        expect(await acciones.revertirSanciones(client, Date.now() + 11 * 60000)).toBe(1);
        expect(c.voice.setMute).toHaveBeenLastCalledWith(false, expect.any(String));
    });

    test("crea canales solo en su categoría, con tope, y solo borra los suyos", async () => {
        expect(await ejecutar("crear-canal", { nombre: "despacho" })).toMatch(/categoría/);
        guildSettings.setSetting(G, "elecciones.categoria_presidente", "cat-pres");
        guildSettings.setSetting(G, "elecciones.max_canales", 1);
        expect(await ejecutar("crear-canal", { nombre: "despacho", tipo: "voz" })).toMatch(/Canal creado/);
        expect(ultimo(guild.channels.create)).toMatchObject({ name: "despacho", parent: "cat-pres" });
        expect(await ejecutar("crear-canal", { nombre: "otro" })).toMatch(/1 de 1 canales/);
        expect(await ejecutar("borrar-canal", { canal: { id: "general" } })).toMatch(/Solo puedes borrar/);
        const [suyo] = repoP.canalesActivos(repo.activa(G).id);
        expect(await ejecutar("borrar-canal", { canal: { id: suyo.channelId } })).toMatch(/borrado/);
        expect(repoP.canalesActivos(repo.activa(G).id)).toHaveLength(0);
    });
});

describe("panel admin", () => {
    const interaccion = (customId, extra = {}) => ({
        customId,
        guildId: G,
        client,
        user: { id: "admin" },
        memberPermissions: { has: () => true },
        isFromMessage: () => true,
        reply: jest.fn(async () => {}),
        update: jest.fn(async () => {}),
        deferUpdate: jest.fn(async () => {}),
        editReply: jest.fn(async () => {}),
        showModal: jest.fn(async () => {}),
        ...extra,
    });

    test("sin ser admin no se puede usar", async () => {
        const i = interaccion("paneladmin_elec_home", { memberPermissions: { has: () => false } });
        await paneladmin.handleButton(client, i);
        expect(i.update).not.toHaveBeenCalled();
        expect(ultimo(i.reply).content).toMatch(/No tienes permisos/);
    });

    test("abrir publica el panel y lo audita; después solo se puede cancelar con confirmación", async () => {
        const i = interaccion("paneladmin_elec_abrir");
        await paneladmin.handleButton(client, i);
        expect(ultimo(i.editReply).embeds[0].toJSON().description).toMatch(/Elecciones abiertas/);
        expect(canalElecciones.send).toHaveBeenCalled();
        expect(adminAudit.listRecent(G, 10).map((r) => r.action)).toContain("elecciones.abrir");
        const c = interaccion("paneladmin_elec_confirmar_cancelar");
        await paneladmin.handleButton(client, c);
        expect(ids(ultimo(c.update))).toEqual(["paneladmin_elec_si_cancelar", "paneladmin_elec_home"]);
        await paneladmin.handleButton(client, interaccion("paneladmin_elec_si_cancelar"));
        expect(repo.activa(G)).toBeNull();
    });

    test("las duraciones del formulario se validan, se guardan y se auditan", async () => {
        const valores = { inscripcion: "1", primarias: "0,5", programas: "2", generales: "3", mandato: "15" };
        const i = interaccion("paneladmin_elec_duraciones_modal", { fields: { getTextInputValue: (k) => valores[k] } });
        await paneladmin.handleModal(client, i);
        expect(ajustes.ajustes(G).dias).toEqual({ inscripcion: 1, primarias: 0.5, programas: 2, generales: 3, mandato: 15 });
        expect(adminAudit.listRecent(G, 10).map((r) => r.action)).toContain("elecciones.ajustes");
        valores.mandato = "0";
        const mal = interaccion("paneladmin_elec_duraciones_modal", { fields: { getTextInputValue: (k) => valores[k] } });
        await paneladmin.handleModal(client, mal);
        expect(ultimo(mal.update).embeds[0].toJSON().description).toMatch(/❌ La duración de «mandato»/);
        expect(ajustes.ajustes(G).dias.mandato).toBe(15);
    });
});
