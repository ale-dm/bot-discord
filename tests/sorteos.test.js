// 🎁 Sorteos programados (#541): creación (dinero y objeto), participantes, requisitos, cierre con reparto,
// cancelación, avisos, /sorteos, panel admin con sus dos pasos y auditoría.
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const sorteos = require("../src/systems/sorteos");
const comando = require("../src/commands/general/sorteos");
const envios = require("../src/discord/envios/sorteos");
const panel = require("../src/paneles/sorteo");
const { buildSorteosPanel } = require("../src/adminPanel/settings/sorteos");
const { handleSettingsButton } = require("../src/adminPanel/settings/botones");
const { handleSettingsModal } = require("../src/adminPanel/settings/modales");

const G = "g-sorteos";
const CANAL = "canal-sorteos";
const AHORA = Date.UTC(2026, 0, 1);
const HORA = 60 * 60 * 1000;

beforeEach(() => {
    for (const tabla of [
        "sorteos",
        "sorteos_participantes",
        "sorteos_ganadores",
        "banco",
        "historial",
        "inventario",
        "tienda",
        "objeto",
        "xp_users",
        "admin_audit",
    ]) {
        db.prepare(`DELETE FROM ${tabla}`).run();
    }
});
afterEach(() => jest.restoreAllMocks());

function objeto(nombre, unico = 0) {
    return Number(
        db
            .prepare("INSERT INTO objeto (nombre, descripcion, tipo, unico) VALUES (?, ?, 'coleccionable', ?)")
            .run(nombre, "de prueba", unico).lastInsertRowid,
    );
}

function crearDinero({ ganadores = 1, horas = 24, min = 0, rolId = "", valor = 1000, ahora = AHORA } = {}) {
    return sorteos.crear({
        guildId: G,
        channelId: CANAL,
        premioTipo: "dinero",
        premioValor: valor,
        premioNombre: String(valor),
        ganadores,
        rolId,
        nivel: min,
        horas,
        creadorId: "admin",
        ahora,
    });
}

describe("crear sorteos", () => {
    test("crea uno de dinero con sus datos", () => {
        const r = crearDinero({ ganadores: 3, horas: 12 });
        expect(r.ok).toBe(true);
        expect(r.sorteo).toMatchObject({
            guildId: G,
            channelId: CANAL,
            premioTipo: "dinero",
            premioValor: "1000",
            ganadores: 3,
            estado: "activo",
        });
        expect(r.sorteo.fin).toBe(AHORA + 12 * HORA);
    });

    test("rechaza duración, ganadores y premio inválidos", () => {
        expect(crearDinero({ horas: 0 })).toMatchObject({ ok: false });
        expect(crearDinero({ horas: 169 })).toMatchObject({ ok: false });
        expect(crearDinero({ ganadores: 6 })).toMatchObject({ ok: false });
        expect(crearDinero({ ganadores: 5, valor: 3 })).toMatchObject({ ok: false });
    });

    test("acepta un objeto del catálogo y un único solo con un ganador", () => {
        const unico = objeto("Espada única", 1);
        const r = sorteos.crear({
            guildId: G,
            channelId: CANAL,
            premioTipo: "objeto",
            premioValor: unico,
            premioNombre: "Espada única",
            ganadores: 1,
            horas: 1,
            creadorId: "admin",
            ahora: AHORA,
        });
        expect(r.ok).toBe(true);
        expect(r.sorteo.premioNombre).toBe("Espada única");
        expect(
            sorteos.crear({
                guildId: G,
                channelId: CANAL,
                premioTipo: "objeto",
                premioValor: unico,
                premioNombre: "Espada única",
                ganadores: 2,
                horas: 1,
                creadorId: "admin",
                ahora: AHORA,
            }),
        ).toMatchObject({ ok: false });
    });
});

describe("participar", () => {
    test("entra, sale y no deja entrar cuando ya ha terminado", () => {
        const s = crearDinero().sorteo;
        expect(sorteos.participar(s.id, "u1", AHORA)).toEqual({ ok: true, dentro: true });
        expect(sorteos.cuentaParticipantes(s.id)).toBe(1);
        expect(sorteos.participar(s.id, "u1", AHORA)).toEqual({ ok: true, dentro: false });
        expect(sorteos.cuentaParticipantes(s.id)).toBe(0);
        expect(sorteos.participar(s.id, "u1", s.fin + 1)).toMatchObject({ ok: false });
        sorteos.cancelar(s.id);
        expect(sorteos.participar(s.id, "u2", AHORA)).toMatchObject({ ok: false });
    });
});

describe("cerrar y repartir", () => {
    test("reparte el dinero entre los ganadores y no paga dos veces", () => {
        const s = crearDinero({ ganadores: 3, valor: 100 }).sorteo;
        const r = sorteos.cerrar(s.id, ["a", "b", "c"], s.fin);
        expect(r.ganadores.map((g) => g.cantidad).sort()).toEqual([33, 33, 34]);
        expect(r.ganadores.reduce((n, g) => n + g.cantidad, 0)).toBe(100);
        expect(sorteos.porId(s.id).estado).toBe("cerrado");
        const saldo = dinero.efectivo("a") + dinero.efectivo("b") + dinero.efectivo("c");
        expect(saldo).toBe(3000 + 100);
        expect(sorteos.cerrar(s.id, ["a", "b", "c"], s.fin)).toBeNull();
        expect(dinero.efectivo("a") + dinero.efectivo("b") + dinero.efectivo("c")).toBe(saldo);
    });

    test("un objeto único se entrega a una sola persona", () => {
        const item = objeto("Trofeo", 1);
        const s = sorteos.crear({
            guildId: G,
            channelId: CANAL,
            premioTipo: "objeto",
            premioValor: item,
            premioNombre: "Trofeo",
            ganadores: 1,
            horas: 1,
            creadorId: "admin",
            ahora: AHORA,
        }).sorteo;
        const r = sorteos.cerrar(s.id, ["a", "b"], s.fin);
        expect(r.ganadores).toHaveLength(1);
        expect(db.prepare("SELECT COUNT(*) AS n FROM inventario WHERE itemId = ?").get(item).n).toBe(1);
    });

    test("sin elegibles se cierra sin ganadores", () => {
        const s = crearDinero().sorteo;
        const r = sorteos.cerrar(s.id, [], s.fin);
        expect(r.ganadores).toEqual([]);
        expect(sorteos.porId(s.id).estado).toBe("cerrado");
    });
});

describe("/sorteos y el botón de entrar", () => {
    test("lista los activos", async () => {
        crearDinero({ valor: 500 });
        const i = { guildId: G, reply: jest.fn(async () => {}) };
        await comando.run({}, i);
        const embed = i.reply.mock.calls[0][0].embeds[0].toJSON();
        expect(embed.title).toBe("🎁 Sorteos activos");
        expect(embed.description).toContain("500");
    });

    test("el botón comprueba rol y nivel, y alterna la participación", async () => {
        const s = crearDinero({ rolId: "rol1", min: 5, ahora: Date.now() }).sorteo;
        const sinRol = {
            guildId: G,
            guild: { id: G },
            member: { roles: { cache: new Map() } },
            user: { id: "u1", tag: "u1#0001" },
            customId: `sorteo_entrar_${s.id}`,
            reply: jest.fn(async () => {}),
            message: { edit: jest.fn(async () => {}) },
        };
        await comando.handleButton({}, sinRol);
        expect(sinRol.reply.mock.calls[0][0].content).toContain("Necesitas el rol");

        const conRol = {
            ...sinRol,
            member: { roles: { cache: new Map([["rol1", {}]]) } },
        };
        db.prepare("INSERT INTO xp_users (guildId, userId, xp, nivel, xp_total) VALUES (?, ?, 0, 5, 0)").run(G, "u1");
        await comando.handleButton({}, conRol);
        expect(conRol.reply.mock.calls.at(-1)[0].content).toContain("Estás dentro");
        expect(conRol.message.edit).toHaveBeenCalled();
        expect(sorteos.cuentaParticipantes(s.id)).toBe(1);
    });
});

describe("cierre automático y avisos", () => {
    function canalFalso() {
        const mensaje = { edit: jest.fn(async () => {}) };
        return {
            id: CANAL,
            send: jest.fn(async () => ({ id: "mensaje-nuevo" })),
            messages: { fetch: jest.fn(async () => mensaje) },
            mensaje,
        };
    }

    function cliente({ canal, miembros = new Map() } = {}) {
        const guild = {
            id: G,
            members: { fetch: jest.fn(async (id) => miembros.get(id) || null) },
            channels: { cache: new Map([[CANAL, canal]]), fetch: jest.fn(async () => canal) },
        };
        return {
            guilds: { cache: new Map([[G, guild]]), fetch: jest.fn(async () => guild) },
            users: { fetch: jest.fn(async () => ({ send: jest.fn() })) },
        };
    }

    test("cierra, edita el mensaje, anuncia y avisa por DM a quien sigue cumpliendo", async () => {
        const s = crearDinero({ valor: 1000, rolId: "rol1" }).sorteo;
        sorteos.guardarMensaje(s.id, "msg-1");
        sorteos.participar(s.id, "con-rol", s.inicio);
        sorteos.participar(s.id, "sin-rol", s.inicio);
        const canal = canalFalso();
        const client = cliente({
            canal,
            miembros: new Map([
                ["con-rol", { id: "con-rol", roles: { cache: new Map([["rol1", {}]]) } }],
                ["sin-rol", { id: "sin-rol", roles: { cache: new Map() } }],
            ]),
        });
        await envios.revisar(client, s.fin);
        expect(sorteos.porId(s.id).estado).toBe("cerrado");
        expect(canal.mensaje.edit).toHaveBeenCalled();
        expect(canal.send).toHaveBeenCalled();
        expect(client.users.fetch).toHaveBeenCalledWith("con-rol");
        expect(client.users.fetch).not.toHaveBeenCalledWith("sin-rol");
    });

    test("si el servidor ya no está, el sorteo se cierra sin ganadores", async () => {
        const s = crearDinero().sorteo;
        sorteos.participar(s.id, "u1", s.inicio);
        const client = { guilds: { cache: new Map(), fetch: jest.fn(async () => null) }, users: { fetch: jest.fn() } };
        await envios.revisar(client, s.fin);
        expect(sorteos.porId(s.id).estado).toBe("cerrado");
        expect(sorteos.ganadoresDe(s.id)).toEqual([]);
    });
});

describe("panel admin", () => {
    function canalFalso() {
        return {
            id: CANAL,
            send: jest.fn(async () => ({ id: "msg-publicado" })),
            messages: { fetch: jest.fn(async () => ({ edit: jest.fn() })) },
        };
    }

    function admin(cliente) {
        return {
            guildId: G,
            guild: { id: G },
            user: { id: "admin" },
            reply: jest.fn(async () => {}),
            update: jest.fn(async () => {}),
            showModal: jest.fn(async () => {}),
            client: cliente,
        };
    }

    const canal = canalFalso();
    const cliente = { channels: { fetch: jest.fn(async () => canal) } };

    test("muestra los activos y un botón de cancelar por sorteo", () => {
        const s = crearDinero().sorteo;
        const payload = buildSorteosPanel(G);
        const ids = payload.components.flatMap((f) => f.toJSON().components.map((c) => c.custom_id));
        expect(ids).toContain(`paneladmin_cfg_sorteos_cancel_${s.id}`);
        expect(payload.embeds[0].toJSON().fields[0].value).toContain(`#${s.id}`);
    });

    test("crea un sorteo en dos pasos: primero el borrador y luego publica", async () => {
        const i = admin(cliente);
        i.fields = {
            getTextInputValue: (id) => ({ premio: "1000", horas: "24" })[id] ?? "",
            getSelectedChannels: () => new Map([[CANAL, {}]]),
            getStringSelectValues: () => ["dinero"],
        };
        expect(await handleSettingsModal({ ...i, customId: "paneladmin_cfg_sorteos_new_modal" })).toBe(true);
        expect(i.reply.mock.calls[0][0].components).toBeDefined();

        const ok = admin(cliente);
        expect(await handleSettingsButton({ ...ok, customId: "paneladmin_cfg_sorteos_draft_ok" })).toBe(true);
        expect(sorteos.activos(G)).toHaveLength(1);
        expect(canal.send).toHaveBeenCalled();
        expect(ok.reply.mock.calls[0][0].content).toContain("publicado");
    });

    test("pide ganadores y requisitos en el segundo formulario", async () => {
        const i = admin(cliente);
        i.fields = {
            getTextInputValue: (id) => ({ premio: "1500", horas: "6" })[id] ?? "",
            getSelectedChannels: () => new Map([[CANAL, {}]]),
            getStringSelectValues: () => ["dinero"],
        };
        await handleSettingsModal({ ...i, customId: "paneladmin_cfg_sorteos_new_modal" });

        const req = admin(cliente);
        req.fields = {
            getTextInputValue: (id) => ({ ganadores: "3", nivel: "2" })[id] ?? "",
            getSelectedRoles: () => new Map([["rol1", {}]]),
        };
        expect(await handleSettingsModal({ ...req, customId: "paneladmin_cfg_sorteos_req_modal" })).toBe(true);
        expect(sorteos.activos(G)[0]).toMatchObject({ ganadores: 3, nivel: 2, rolId: "rol1" });
    });

    test("cancela un sorteo y lo audita", async () => {
        const s = crearDinero().sorteo;
        sorteos.guardarMensaje(s.id, "msg-1");
        const i = admin(cliente);
        expect(await handleSettingsButton({ ...i, customId: `paneladmin_cfg_sorteos_cancel_${s.id}` })).toBe(true);
        expect(sorteos.porId(s.id).estado).toBe("cancelado");
        expect(db.prepare("SELECT action FROM admin_audit WHERE guildId = ? ORDER BY id DESC").get(G).action).toBe("sorteos.cancelar");
    });

    test("rechaza un premio que no es un número", async () => {
        const i = admin(cliente);
        i.fields = {
            getTextInputValue: (id) => ({ premio: "mucho", horas: "24" })[id] ?? "",
            getSelectedChannels: () => new Map([[CANAL, {}]]),
            getStringSelectValues: () => ["dinero"],
        };
        await handleSettingsModal({ ...i, customId: "paneladmin_cfg_sorteos_new_modal" });
        const ok = admin(cliente);
        await handleSettingsButton({ ...ok, customId: "paneladmin_cfg_sorteos_draft_ok" });
        expect(ok.reply.mock.calls[0][0].content).toContain("número entero");
        expect(sorteos.activos(G)).toHaveLength(0);
    });
});

describe("mensaje del sorteo", () => {
    test("activo lleva botón y terminado enseña los ganadores", () => {
        const s = crearDinero({ ganadores: 2 }).sorteo;
        const activo = panel.buildSorteo(s, { participantes: 4 });
        expect(activo.components[0].toJSON().components[0].custom_id).toBe(`sorteo_entrar_${s.id}`);
        const fin = panel.buildSorteo(s, { terminado: true, ganadores: [{ userId: "a", cantidad: 500 }] });
        expect(fin.components).toEqual([]);
        expect(fin.embeds[0].toJSON().fields.find((f) => f.name === "🏆 Ganadores").value).toContain("<@a>");
    });
});
