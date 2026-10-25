// ⚠️ Avisos y strikes de moderación (#542): quién puede avisar, acumulación y caducidad, umbrales que avisan a los admins sin
// sancionar, retirar y limpiar dejando rastro, el comando /avisar (DM, log y auditoría) y la sección del panel admin.
// BD en memoria; Discord falso y DM simulados.
const db = require("../src/core/db");
const guildSettings = require("../src/systems/guildSettings");
const adminAudit = require("../src/systems/adminAudit");
const avisosDm = require("../src/systems/avisosDm");
const moderacion = require("../src/systems/moderacion");
const avisar = require("../src/commands/admin/avisar");
const paneladmin = require("../src/commands/admin/paneladmin");
const { buildConfigHome } = require("../src/adminPanel/settings/vistas");
const { DEFAULT_FLAT, KEY_TYPES } = require("../src/systems/guildSettings/definicion");

const G = "g-moderacion";
const DIA = moderacion.DIA_MS;
const AHORA = 1_800_000_000_000;

const strike = (userId = "ana", ahora = AHORA, staffId = "staff") =>
    moderacion.avisar({ guildId: G, userId, staffId, motivo: "Spam en el general" }, ahora);
const acciones = () => adminAudit.listRecent(G, 100).map((r) => r.action);
const fila = (id) => db.prepare("SELECT * FROM strikes WHERE id = ?").get(id);

function miembro({ permisos = [], roles = [] } = {}) {
    return { permissions: { has: (p) => permisos.includes(p) }, roles: { cache: { has: (r) => roles.includes(r) } } };
}

beforeEach(() => {
    db.prepare("DELETE FROM strikes").run();
    db.prepare("DELETE FROM admin_audit WHERE guildId = ?").run(G);
    for (const clave of Object.keys(DEFAULT_FLAT).filter((k) => k.startsWith("moderacion.")))
        guildSettings.setSetting(G, clave, DEFAULT_FLAT[clave]);
    guildSettings.setSetting(G, "alertas.admin_ids", "admin1,admin2");
    jest.spyOn(avisosDm, "sendDm").mockResolvedValue(true);
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe("los ajustes (#542)", () => {
    test("vienen con las decisiones: 90 días y umbrales 3, 5, 7 y 10, sin rol ni canal", () => {
        expect(moderacion.ajustes("g-sin-ajustes-mod")).toMatchObject({
            staffRol: "",
            canalLog: "",
            caducidadDias: 90,
            umbrales: [
                expect.objectContaining({ clave: "aviso", n: 3 }),
                expect.objectContaining({ clave: "mute", n: 5 }),
                expect.objectContaining({ clave: "expulsion", n: 7 }),
                expect.objectContaining({ clave: "ban", n: 10 }),
            ],
        });
        expect(KEY_TYPES["moderacion.umbral_ban"]).toBe("number");
        expect(KEY_TYPES["moderacion.staff_rol"]).toBe("string");
    });

    test.each([
        [{ caducidad: "90", aviso: "3", mute: "5", expulsion: "7", ban: "10" }, true],
        [{ caducidad: "0", aviso: "3", mute: "5", expulsion: "7", ban: "10" }, "caducidad"],
        [{ caducidad: "30", aviso: "3", mute: "3", expulsion: "7", ban: "10" }, "menor a mayor"],
        [{ caducidad: "30", aviso: "0", mute: "5", expulsion: "7", ban: "10" }, "umbral"],
        [{ caducidad: "30", aviso: "3", mute: "5", expulsion: "7", ban: "abc" }, "umbral"],
    ])("validar %j", (campos, esperado) => {
        const r = moderacion.validarAjustes(campos);
        if (esperado === true) expect(r).toEqual({ ok: true, valores: expect.objectContaining({ caducidad_dias: 90, umbral_ban: 10 }) });
        else expect(r.motivo).toEqual(expect.stringContaining(esperado));
    });
});

describe("quién puede avisar (#542)", () => {
    test.each([
        ["con Moderar miembros", { permisos: ["ModerateMembers"] }, true],
        ["un admin", { permisos: ["Administrator"] }, true],
        ["con el rol de staff", { roles: ["staff-rol"] }, true],
        ["cualquier otro", { roles: ["otro"] }, false],
    ])("%s", (_caso, opciones, puede) => {
        guildSettings.setSetting(G, "moderacion.staff_rol", "staff-rol");
        expect(moderacion.puedeAvisar(miembro(opciones), G)).toBe(puede);
    });

    test("sin rol de staff configurado, tener roles no basta", () => {
        expect(moderacion.puedeAvisar(miembro({ roles: [""] }), G)).toBe(false);
        expect(moderacion.puedeAvisar(null, G)).toBe(false);
    });
});

describe("strikes (#542)", () => {
    test("se acumulan por persona y cada uno guarda motivo, staff y fecha", () => {
        strike("ana");
        const r = strike("ana");
        strike("luis");
        expect(r).toMatchObject({ ok: true, vigentes: 2, umbral: null });
        expect(fila(r.id)).toMatchObject({
            userId: "ana",
            staffId: "staff",
            motivo: "Spam en el general",
            creado: AHORA,
            estado: "vigente",
        });
        expect(moderacion.vigentes(G, "luis", AHORA)).toBe(1);
    });

    test("un motivo demasiado corto o largo, o avisarse a uno mismo, no apunta nada", () => {
        expect(moderacion.avisar({ guildId: G, userId: "ana", staffId: "s", motivo: "no" }).ok).toBe(false);
        expect(moderacion.avisar({ guildId: G, userId: "ana", staffId: "s", motivo: "x".repeat(301) }).ok).toBe(false);
        expect(moderacion.avisar({ guildId: G, userId: "s", staffId: "s", motivo: "me porto mal" }).ok).toBe(false);
        expect(db.prepare("SELECT COUNT(*) AS n FROM strikes").get().n).toBe(0);
    });

    test("caducan a los 90 días pero no se borran del historial", () => {
        strike("ana", AHORA - 91 * DIA);
        strike("ana", AHORA - 10 * DIA);
        expect(moderacion.vigentes(G, "ana", AHORA)).toBe(1);
        expect(moderacion.historial(G, "ana", AHORA).map((s) => s.situacion)).toEqual(["vigente", "caducado"]);
    });

    test("la caducidad se puede cambiar", () => {
        guildSettings.setSetting(G, "moderacion.caducidad_dias", 5);
        strike("ana", AHORA - 6 * DIA);
        expect(moderacion.vigentes(G, "ana", AHORA)).toBe(0);
    });

    test("al cruzar cada umbral se sugiere su medida, una vez", () => {
        const umbrales = [];
        for (let i = 0; i < 10; i++) umbrales.push(strike("ana").umbral?.clave ?? null);
        expect(umbrales).toEqual([null, null, "aviso", null, "mute", null, "expulsion", null, null, "ban"]);
        expect(moderacion.medidaPara(G, 8).clave).toBe("expulsion");
        expect(moderacion.medidaPara(G, 2)).toBeNull();
    });

    test("con umbrales propios avisa en los suyos", () => {
        guildSettings.setSetting(G, "moderacion.umbral_aviso", 1);
        guildSettings.setSetting(G, "moderacion.umbral_mute", 2);
        expect(strike().umbral.clave).toBe("aviso");
        expect(strike().umbral.clave).toBe("mute");
    });

    test("retirar uno deja quién y cuándo, deja de contar y no se puede retirar dos veces", () => {
        const { id } = strike();
        strike();
        expect(moderacion.retirar(G, id, "admin", AHORA + 1)).toMatchObject({ id });
        expect(fila(id)).toMatchObject({ estado: "retirado", retiradoPor: "admin", retiradoEn: AHORA + 1 });
        expect(moderacion.vigentes(G, "ana", AHORA)).toBe(1);
        expect(moderacion.retirar(G, id, "admin")).toBeNull();
        expect(moderacion.retirar("otro-servidor", fila(id).id + 1, "admin")).toBeNull();
    });

    test("limpiar retira todos los de esa persona y nada de las demás", () => {
        strike("ana");
        strike("ana");
        strike("luis");
        expect(moderacion.limpiar(G, "ana", "admin")).toBe(2);
        expect(moderacion.vigentes(G, "ana", AHORA)).toBe(0);
        expect(moderacion.vigentes(G, "luis", AHORA)).toBe(1);
        expect(moderacion.historial(G, "ana", AHORA)).toHaveLength(2);
    });

    test("quién tiene strikes vigentes, de más a menos", () => {
        strike("luis");
        strike("ana");
        strike("ana");
        expect(moderacion.conStrikes(G, AHORA)).toEqual([
            { userId: "ana", n: 2 },
            { userId: "luis", n: 1 },
        ]);
    });
});

describe("/avisar (#542)", () => {
    function comando({
        permisos = ["ModerateMembers"],
        roles = [],
        objetivo = { id: "ana", bot: false },
        motivo = "Spam en el general",
    } = {}) {
        const send = jest.fn(async () => {});
        const canalLog = { id: "log", isTextBased: () => true, send };
        const guild = {
            id: G,
            name: "Servidor",
            channels: { cache: new Map([["log", canalLog]]), fetch: jest.fn(async () => null) },
            members: { ban: jest.fn(), kick: jest.fn() },
        };
        return {
            guild,
            send,
            i: {
                guild,
                guildId: G,
                user: { id: "staff" },
                member: miembro({ permisos, roles }),
                options: { getUser: () => objetivo, getString: () => motivo },
                reply: jest.fn(async () => {}),
                deferReply: jest.fn(async () => {}),
                editReply: jest.fn(async () => {}),
            },
        };
    }
    const respuesta = (i) => (i.editReply.mock.calls[0] || i.reply.mock.calls[0])[0].content;

    test("el staff avisa: DM con el motivo, línea en el log, auditoría y la cuenta en la respuesta", async () => {
        guildSettings.setSetting(G, "moderacion.canal_log", "log");
        const { i, send } = comando();
        await avisar.run({}, i);
        expect(avisosDm.sendDm).toHaveBeenCalledWith(
            {},
            "ana",
            expect.objectContaining({ content: expect.stringContaining("Spam en el general") }),
        );
        expect(send.mock.calls[0][0].content).toContain("<@staff> avisa a <@ana>");
        expect(send.mock.calls[0][0].allowedMentions).toEqual({ parse: [] });
        expect(acciones()).toContain("moderacion.aviso");
        expect(respuesta(i)).toContain("Lleva **1** strikes vigentes");
        expect(respuesta(i)).toContain("📩 Le ha llegado el DM");
    });

    test("con el rol de staff también se puede", async () => {
        guildSettings.setSetting(G, "moderacion.staff_rol", "staff-rol");
        const { i } = comando({ permisos: [], roles: ["staff-rol"] });
        await avisar.run({}, i);
        expect(moderacion.vigentes(G, "ana")).toBe(1);
    });

    test("sin permiso no se apunta nada", async () => {
        const { i } = comando({ permisos: [] });
        await avisar.run({}, i);
        expect(respuesta(i)).toContain("⛔");
        expect(db.prepare("SELECT COUNT(*) AS n FROM strikes").get().n).toBe(0);
        expect(avisosDm.sendDm).not.toHaveBeenCalled();
    });

    test("a un bot no se le avisa", async () => {
        const { i } = comando({ objetivo: { id: "bot", bot: true } });
        await avisar.run({}, i);
        expect(respuesta(i)).toContain("bot");
        expect(db.prepare("SELECT COUNT(*) AS n FROM strikes").get().n).toBe(0);
    });

    test("al llegar al umbral avisa a los admins con la medida sugerida y no sanciona", async () => {
        strike();
        strike();
        const { i, guild } = comando();
        await avisar.run({}, i);
        const aAdmins = avisosDm.sendDm.mock.calls.filter(([, id]) => id === "admin1" || id === "admin2");
        expect(aAdmins).toHaveLength(2);
        expect(aAdmins[0][2].content).toContain("⚠️ Aviso serio");
        expect(respuesta(i)).toContain("es una sugerencia, decide el staff");
        expect(guild.members.ban).not.toHaveBeenCalled();
        expect(guild.members.kick).not.toHaveBeenCalled();
    });

    test("si el DM no llega, el strike queda y se dice", async () => {
        avisosDm.sendDm.mockResolvedValue(false);
        guildSettings.setSetting(G, "moderacion.canal_log", "log");
        const { i, send } = comando();
        await avisar.run({}, i);
        expect(moderacion.vigentes(G, "ana")).toBe(1);
        expect(respuesta(i)).toContain("No se le pudo mandar el DM");
        expect(send.mock.calls[0][0].content).toContain("No se le pudo mandar el DM");
    });

    test("sin canal de log o con un canal que ya no existe, el aviso sigue", async () => {
        guildSettings.setSetting(G, "moderacion.canal_log", "borrado");
        const { i } = comando();
        await avisar.run({}, i);
        expect(moderacion.vigentes(G, "ana")).toBe(1);
    });
});

describe("⚠️ Moderación en el panel admin (#542)", () => {
    function interaccion(customId, extra = {}, admin = true) {
        return {
            customId,
            guildId: G,
            guild: { id: G },
            user: { id: "admin", tag: "admin" },
            client: {},
            memberPermissions: { has: () => admin },
            member: { permissions: { has: () => admin } },
            reply: jest.fn(async () => {}),
            update: jest.fn(async () => {}),
            showModal: jest.fn(async () => {}),
            isFromMessage: () => true,
            ...extra,
        };
    }
    const texto = (p) => `${p.content ?? ""} ${JSON.stringify(p.embeds?.[0]?.data ?? {})}`;
    const ids = (p) => p.components.flatMap((f) => f.toJSON().components.map((c) => c.custom_id));

    test("está en ⚙️ Config Global, sin pasar de 5 filas, y su familia en la auditoría", () => {
        const p = buildConfigHome(G);
        expect(p.components.length).toBeLessThanOrEqual(5);
        expect(ids(p)).toContain("paneladmin_mod_home");
    });

    test("sin admin no se abre", async () => {
        const i = interaccion("paneladmin_mod_home", {}, false);
        await paneladmin.handleButton(i.client, i);
        expect(i.reply).toHaveBeenCalledWith(expect.objectContaining({ content: "No tienes permisos." }));
    });

    test("la pantalla muestra ajustes y quién tiene strikes", async () => {
        strike("ana", Date.now());
        const i = interaccion("paneladmin_mod_home");
        await paneladmin.handleButton(i.client, i);
        const t = texto(i.update.mock.calls[0][0]);
        expect(t).toContain("**3** → ⚠️ Aviso serio");
        expect(t).toContain("<@ana> · **1**");
    });

    test("umbrales y caducidad: se guardan válidos (con auditoría) y se rechazan fuera de orden", async () => {
        const campos = { caducidad: "30", aviso: "2", mute: "4", expulsion: "6", ban: "8" };
        const ok = interaccion("paneladmin_mod_ajustes_modal", { fields: { getTextInputValue: (k) => campos[k] } });
        await paneladmin.handleModal(ok.client, ok);
        expect(moderacion.ajustes(G).caducidadDias).toBe(30);
        expect(moderacion.ajustes(G).umbrales.map((u) => u.n)).toEqual([2, 4, 6, 8]);
        expect(adminAudit.listRecent(G, 10).find((a) => a.action === "moderacion.ajustes").details.despues).toMatchObject({
            umbral_ban: 8,
        });

        const mal = interaccion("paneladmin_mod_ajustes_modal", { fields: { getTextInputValue: (k) => ({ ...campos, mute: "1" })[k] } });
        await paneladmin.handleModal(mal.client, mal);
        expect(texto(mal.update.mock.calls[0][0])).toContain("menor a mayor");
        expect(moderacion.ajustes(G).umbrales.map((u) => u.n)).toEqual([2, 4, 6, 8]);
    });

    test("staff y canal de log se eligen con selectores y se auditan", async () => {
        const i = interaccion("paneladmin_mod_staff_modal", {
            fields: { getSelectedRoles: () => new Map([["staff-rol", {}]]), getSelectedChannels: () => new Map([["log", {}]]) },
        });
        await paneladmin.handleModal(i.client, i);
        expect(moderacion.ajustes(G)).toMatchObject({ staffRol: "staff-rol", canalLog: "log" });
        expect(acciones()).toContain("moderacion.staff");
    });

    test("consultar, retirar uno y limpiar con confirmación, todo auditado", async () => {
        const a = strike("ana", Date.now());
        strike("ana", Date.now());
        const consultar = interaccion("paneladmin_mod_consultar_modal", { fields: { getSelectedUsers: () => new Map([["ana", {}]]) } });
        await paneladmin.handleModal(consultar.client, consultar);
        const vista = consultar.update.mock.calls[0][0];
        expect(texto(vista)).toContain("**2** vigentes");
        expect(ids(vista)).toEqual(expect.arrayContaining(["paneladmin_mod_retirar_ana", "paneladmin_mod_limpiar_ana"]));

        const retirar = interaccion("paneladmin_mod_retirar_ana", { values: [String(a.id)] });
        await paneladmin.handleStringSelect(retirar.client, retirar);
        expect(fila(a.id).estado).toBe("retirado");
        expect(acciones()).toContain("moderacion.retirar");

        const limpiar = interaccion("paneladmin_mod_limpiar_ana");
        await paneladmin.handleButton(limpiar.client, limpiar);
        expect(ids(limpiar.update.mock.calls[0][0])).toContain("paneladmin_mod_limpiarsi_ana");
        expect(moderacion.vigentes(G, "ana")).toBe(1);

        const si = interaccion("paneladmin_mod_limpiarsi_ana");
        await paneladmin.handleButton(si.client, si);
        expect(moderacion.vigentes(G, "ana")).toBe(0);
        expect(adminAudit.listRecent(G, 10).find((r) => r.action === "moderacion.limpiar").details).toEqual({
            userId: "ana",
            retirados: 1,
        });
    });
});
