// Fase 12 (administración): filtro de la auditoría (#398), consultas auditadas (#402), diff de ajustes (#407), copias de seguridad
// (#417-#419), tareas programadas (#420, #421), alertas por categoría y canal de respaldo (#422, #423), /mensaje programado
// (#424) y modo mantenimiento (#425). BD en memoria real; Discord y node-cron simulados.
const fs = require("fs");
const os = require("os");
const path = require("path");

const dirCopias = fs.mkdtempSync(path.join(os.tmpdir(), "el-duende-fase12-"));
process.env.BACKUP_DIR = dirCopias;
process.env.BACKUP_KEEP = "3";

jest.mock("node-cron", () => ({ schedule: jest.fn(() => ({ getNextRun: () => new Date(Date.now() + 60_000) })) }));

const Database = require("better-sqlite3");
const db = require("../src/core/db");
const adminAudit = require("../src/systems/adminAudit");
const guildSettings = require("../src/systems/guildSettings");
const alertas = require("../src/systems/alertas");
const alertasEnvios = require("../src/discord/envios/alertas");
const backups = require("../src/systems/backups");
const programados = require("../src/systems/mensajesProgramados");
const mantenimiento = require("../src/systems/mantenimiento");
const tareas = require("../src/core/tareasRegistro");
const { runJob } = require("../src/core/interactionLog");
const { buildAuditPayload, handleAuditButton, handleAuditSelect } = require("../src/adminPanel/audit");
const { guardarAuditado } = require("../src/adminPanel/settings/guardar");
const { handleSettingsModal } = require("../src/adminPanel/settings/modales");
const { handleBankButton, handleBankModal } = require("../src/adminPanel/bank");
const { handlePerfilesStringSelect } = require("../src/adminPanel/perfilesDuende");
const extras = require("../src/adminPanel/sistemaExtras");
const mensaje = require("../src/commands/admin/mensaje");
const perfiles = require("../src/systems/duende/perfiles");
const { momentoMadrid } = require("../src/core/zonaMadrid");

let n = 0;
const nuevoServidor = () => `g-fase12-${++n}`;
const ADMIN = { has: (p) => p === "Administrator" };
const NO_ADMIN = { has: () => false };
const ACTOR = "100000000000000001";

function interaccion(extra = {}) {
    return {
        customId: "",
        guildId: "g-base",
        user: { id: ACTOR, username: "admin", tag: "admin#0001" },
        memberPermissions: ADMIN,
        reply: jest.fn(async () => {}),
        update: jest.fn(async () => {}),
        deferUpdate: jest.fn(async () => {}),
        editReply: jest.fn(async () => {}),
        showModal: jest.fn(async () => {}),
        values: [],
        ...extra,
    };
}
const filasAuditoria = (guildId, familia = null) => adminAudit.listRecent(guildId, 100, familia);
const ultimo = (mock) => mock.mock.calls.at(-1)[0];

describe("#398 filtro de la auditoría por familia", () => {
    test("listRecent con familia solo devuelve las acciones que empiezan por ella", () => {
        const g = nuevoServidor();
        for (const action of ["bank.balance.modify", "settings.tienda.update", "bank.reset", "banco.otra"]) {
            adminAudit.logAdminAction({ guildId: g, actorId: ACTOR, action });
        }
        expect(filasAuditoria(g, "bank").map((r) => r.action)).toEqual(["bank.reset", "bank.balance.modify"]);
        expect(filasAuditoria(g)).toHaveLength(4);
        // Una familia con caracteres raros no se usa como patrón.
        expect(filasAuditoria(g, "%")).toHaveLength(4);
    });

    test("el select aplica el filtro, el pie lo indica y ◀ ▶ y 🔄 lo conservan", async () => {
        const g = nuevoServidor();
        for (let i = 0; i < 25; i++) adminAudit.logAdminAction({ guildId: g, actorId: ACTOR, action: `bank.x${i}` });
        for (let i = 0; i < 5; i++) adminAudit.logAdminAction({ guildId: g, actorId: ACTOR, action: `settings.y${i}` });

        const sel = interaccion({ guildId: g, customId: "paneladmin_audit_filtro", values: ["bank"] });
        expect(await handleAuditSelect(sel)).toBe(true);
        const payload = ultimo(sel.update);
        expect(payload.embeds[0].data.footer.text).toBe("Página 1/3 · Filtro: 🏦 Banco");
        expect(payload.embeds[0].data.description).not.toMatch(/settings/);
        const ids = payload.components[0].components.map((b) => b.data.custom_id);
        expect(ids).toEqual([
            "paneladmin_audit_page_-1_bank",
            "paneladmin_audit_refresh_bank",
            "paneladmin_audit_page_1_bank",
            "paneladmin_home",
        ]);

        const sig = interaccion({ guildId: g, customId: "paneladmin_audit_page_1_bank" });
        await handleAuditButton(sig);
        expect(ultimo(sig.update).embeds[0].data.footer.text).toBe("Página 2/3 · Filtro: 🏦 Banco");
        const refresco = interaccion({ guildId: g, customId: "paneladmin_audit_refresh_bank" });
        await handleAuditButton(refresco);
        expect(ultimo(refresco.update).embeds[0].data.footer.text).toBe("Página 1/3 · Filtro: 🏦 Banco");
    });

    test("sin filtro la vista es la de siempre (todas, sin texto de filtro) y 'todas' lo quita", async () => {
        const g = nuevoServidor();
        adminAudit.logAdminAction({ guildId: g, actorId: ACTOR, action: "bank.a" });
        adminAudit.logAdminAction({ guildId: g, actorId: ACTOR, action: "logs.b" });
        const payload = buildAuditPayload(g);
        expect(payload.embeds[0].data.footer.text).toBe("Página 1/1");
        const sel = interaccion({ guildId: g, customId: "paneladmin_audit_filtro", values: ["todas"] });
        await handleAuditSelect(sel);
        expect(ultimo(sel.update).embeds[0].data.footer.text).toBe("Página 1/1");
    });
});

describe("#402 consultas sensibles auditadas", () => {
    test("abrir el historial global deja una fila; pasar de página no", async () => {
        const g = nuevoServidor();
        await handleBankButton(interaccion({ guildId: g, customId: "paneladmin_bank_historialglobal" }));
        await handleBankButton(interaccion({ guildId: g, customId: "paneladmin_bank_historialglobal_page_1" }));
        const filas = filasAuditoria(g, "consulta");
        expect(filas.map((f) => f.action)).toEqual(["consulta.historial_global"]);
        expect(filas[0].actorId).toBe(ACTOR);
    });

    test("buscar un usuario guarda su ID, no lo que se vio", async () => {
        const g = nuevoServidor();
        const i = interaccion({
            guildId: g,
            customId: "paneladmin_bank_buscarusuario_modal",
            fields: { getSelectedUsers: () => new Map([["200000000000000002", {}]]) },
            guild: { members: { fetch: async (id) => ({ id, user: { tag: "x#1" } }) } },
        });
        await handleBankModal(i);
        const [fila] = filasAuditoria(g, "consulta");
        expect(fila).toMatchObject({ action: "consulta.buscar_usuario", details: { userId: "200000000000000002" } });
    });

    test("abrir una ficha de perfil del Duende deja el perfil y el ID, sin el contenido", async () => {
        const g = nuevoServidor();
        const p = perfiles.asegurarPerfil({ id: "300000000000000003", username: "luis" }, "Luis");
        perfiles.anotar({ id: "300000000000000003", username: "luis" }, "nota secreta de Luis");
        const i = interaccion({ guildId: g, customId: "paneladmin_perfiles_pick", values: [String(p.id)] });
        await handlePerfilesStringSelect(i);
        const [fila] = filasAuditoria(g, "consulta");
        expect(fila.action).toBe("consulta.perfil");
        expect(fila.details).toEqual({ perfilId: p.id, discordId: "300000000000000003" });
        expect(JSON.stringify(fila.details)).not.toMatch(/secreta/);
    });
});

describe("#407 ajustes con valor anterior y nuevo", () => {
    test("solo los campos que cambian, con antes y después", () => {
        const g = nuevoServidor();
        const cambios = guardarAuditado(g, ACTOR, "settings.tienda.update", { "tienda.buy_cooldown_sec": 30, "tienda.daily_limit": 0 });
        expect(cambios).toEqual({ "tienda.buy_cooldown_sec": { antes: 0, despues: 30 } });
        const [fila] = filasAuditoria(g, "settings");
        expect(fila.details).toEqual({ cambios });
    });

    test("un envío sin cambios queda marcado 'sin cambios'", () => {
        const g = nuevoServidor();
        guardarAuditado(g, ACTOR, "settings.tienda.update", { "tienda.buy_cooldown_sec": 30 });
        guardarAuditado(g, ACTOR, "settings.tienda.update", { "tienda.buy_cooldown_sec": "30" });
        expect(filasAuditoria(g, "settings")[0].details).toEqual({ sinCambios: true });
    });

    test("los campos con nombre de secreto siguen enmascarados", () => {
        const g = nuevoServidor();
        guardarAuditado(g, ACTOR, "settings.seerr", { "seerr.api_key": "clave-real" });
        const detalle = JSON.stringify(filasAuditoria(g, "settings")[0].details);
        expect(detalle).not.toMatch(/clave-real/);
        expect(detalle).toMatch(/\*\*\*/);
    });

    test("un modal de Config Global (casino RTP) audita su diff", async () => {
        const g = nuevoServidor();
        const campos = { bj: "95", slots: "100", ruleta: "100", adivinar: "100", rasca: "100" };
        const i = interaccion({ guildId: g, customId: "paneladmin_cfg_casino_rtp_modal", fields: { getTextInputValue: (k) => campos[k] } });
        await handleSettingsModal(i);
        expect(filasAuditoria(g, "settings")[0]).toMatchObject({
            action: "settings.casino.rtp",
            details: { cambios: { "casino.rtp_blackjack": { antes: 100, despues: 95 } } },
        });
    });

    test("la regla de un comando guarda la anterior y la nueva", async () => {
        const g = nuevoServidor();
        const fields = {
            getTextInputValue: () => "/tienda",
            getRadioGroup: () => "0",
            getSelectedChannels: () => new Map([["400000000000000004", {}]]),
            getSelectedRoles: () => new Map(),
        };
        await handleSettingsModal(interaccion({ guildId: g, customId: "paneladmin_cfg_acl_modal", fields }));
        const [fila] = filasAuditoria(g, "settings");
        expect(fila.details).toEqual({
            command: "tienda",
            cambios: {
                enabled: { antes: true, despues: false },
                allowedChannels: { antes: [], despues: ["400000000000000004"] },
            },
        });
    });
});

describe("#417 #418 #419 copias de seguridad", () => {
    const limpiar = () => {
        for (const f of fs.readdirSync(dirCopias)) fs.rmSync(path.join(dirCopias, f), { force: true });
        alertas._reiniciar();
    };
    beforeEach(limpiar);

    test("hayCopiaDeHoy y la comprobación de arranque: antes de las 04:30 no, después sin copia sí, con copia no", async () => {
        // Un instante de hoy en Madrid a las 03:00 y otro a las 09:00 (se busca el UTC que da esa hora local).
        const madrid = (h, min) => {
            const hoy = backups.fechaLocal().split("-").map(Number);
            for (const desfase of [1, 2]) {
                const t = Date.UTC(hoy[0], hoy[1] - 1, hoy[2], h - desfase, min);
                const m = momentoMadrid(t);
                if (m.hora === h && m.minuto === min) return t;
            }
            throw new Error("no encuentro la hora");
        };
        expect(backups.hayCopiaDeHoy()).toBe(false);
        expect(backups.faltaCopiaAlArrancar(madrid(3, 0))).toBe(false);
        expect(backups.faltaCopiaAlArrancar(madrid(4, 29))).toBe(false);
        expect(backups.faltaCopiaAlArrancar(madrid(4, 30))).toBe(true);
        expect(backups.faltaCopiaAlArrancar(madrid(9, 0))).toBe(true);

        const origen = new Database(":memory:");
        origen.exec("CREATE TABLE t (x); INSERT INTO t VALUES (1);");
        await backups.hacerBackup(origen);
        expect(backups.hayCopiaDeHoy()).toBe(true);
        expect(backups.faltaCopiaAlArrancar(madrid(9, 0))).toBe(false);
    });

    test("una copia dañada se descarta, no rota las sanas y avisa una sola vez al día", async () => {
        for (const d of ["2026-01-01", "2026-01-02", "2026-01-03"]) fs.writeFileSync(path.join(dirCopias, `banco-${d}.db`), "sana");
        const dms = [];
        const client = {
            guilds: { cache: new Map([["g-copia", { id: "g-copia", ownerId: "900000000000000009" }]]) },
            users: { fetch: async (id) => ({ id, send: async (p) => dms.push(p) }) },
        };
        await alertasEnvios.iniciar(client);
        guildSettings.setManySettings("g-copia", { "alertas.enabled": true, "alertas.tipos": "backup" });
        const rota = { backup: async (tmp) => fs.writeFileSync(tmp, "esto no es una base de datos sqlite") };

        const r1 = await backups.hacerBackup(rota);
        const r2 = await backups.hacerBackup(rota);

        expect(r1.integra).toBe(false);
        expect(r2.integra).toBe(false);
        expect(backups.listarBackups().map((b) => b.fichero)).toEqual([
            "banco-2026-01-01.db",
            "banco-2026-01-02.db",
            "banco-2026-01-03.db",
        ]);
        expect(fs.readdirSync(dirCopias).some((f) => f.endsWith(".tmp"))).toBe(false);
        expect(dms).toHaveLength(1);
        expect(dms[0].embeds[0].data.title).toBe("💾 La copia de seguridad ha fallado");
    });

    test("una copia sana conserva el comportamiento de siempre (rota a BACKUP_KEEP)", async () => {
        for (const d of ["2026-01-01", "2026-01-02", "2026-01-03"]) fs.writeFileSync(path.join(dirCopias, `banco-${d}.db`), "vieja");
        const origen = new Database(":memory:");
        origen.exec("CREATE TABLE t (x)");
        const r = await backups.hacerBackup(origen);
        expect(r.integra).toBe(true);
        expect(backups.listarBackups()).toHaveLength(3);
    });

    test("el panel lista las copias, avisa si la de hoy existe y pide confirmación para sustituirla", async () => {
        const origen = new Database(":memory:");
        origen.exec("CREATE TABLE t (x)");
        const vacio = extras.buildCopias();
        expect(vacio.embeds[0].data.description).toMatch(/todavía no existe/);

        await backups.hacerBackup(origen);
        const lleno = extras.buildCopias();
        expect(lleno.embeds[0].data.description).toMatch(new RegExp(`banco-${backups.fechaLocal()}\\.db`));
        expect(lleno.embeds[0].data.description).toMatch(/ya existe/);

        const g = nuevoServidor();
        const pulsa = interaccion({ guildId: g, customId: "paneladmin_sis_copia_hacer" });
        await extras.handleExtrasButton(pulsa);
        expect(ultimo(pulsa.update).components[0].components[0].data.custom_id).toBe("paneladmin_sis_copia_confirmar");
        expect(filasAuditoria(g, "backup")).toHaveLength(0);
    });

    test("hacer copia ahora (sin la de hoy) la hace y la audita con el fichero", async () => {
        const g = nuevoServidor();
        const i = interaccion({ guildId: g, customId: "paneladmin_sis_copia_hacer" });
        await extras.handleExtrasButton(i);
        expect(backups.hayCopiaDeHoy()).toBe(true);
        const [fila] = filasAuditoria(g, "backup");
        expect(fila.action).toBe("backup.manual");
        expect(fila.details).toMatchObject({ fichero: `banco-${backups.fechaLocal()}.db`, sustituida: false, integra: true });
        expect(ultimo(i.editReply).embeds[0].data.description).toMatch(/hecha/);
    });
});

describe("#420 #421 tareas programadas", () => {
    beforeEach(() => {
        tareas._reiniciar();
        db.prepare("DELETE FROM tareas_ejecuciones").run();
    });

    test("una tarea que nunca ha corrido aparece como 'sin ejecutar'; después, con su última ejecución", async () => {
        tareas.cron.schedule("*/5 * * * *", () => runJob("Tarea de prueba", async () => "hecho"));
        const antes = tareas.listar();
        expect(antes).toHaveLength(1);
        expect(antes[0]).toMatchObject({ nombre: "Tarea de prueba", expr: "*/5 * * * *", ultima: null });
        expect(antes[0].siguiente).toBeGreaterThan(Date.now());
        expect(extras.buildTareas().embeds[0].data.description).toMatch(/sin ejecutar/);

        await tareas.lanzar(0);
        const despues = tareas.listar()[0];
        expect(despues.ultima).toMatchObject({ ok: true });
        // La ejecución está en la base de datos: sobrevive a un reinicio (un registro nuevo la sigue viendo).
        expect(db.prepare("SELECT ok FROM tareas_ejecuciones WHERE nombre = ?").get("Tarea de prueba")).toEqual({ ok: 1 });
    });

    test("una tarea que falla queda como ERROR con su motivo", async () => {
        tareas.cron.schedule("0 * * * *", () =>
            runJob("Tarea rota", async () => {
                throw new Error("se rompió");
            }),
        );
        await tareas.lanzar(0);
        expect(tareas.listar()[0].ultima).toMatchObject({ ok: false, error: "se rompió" });
        expect(extras.buildTareas().embeds[0].data.description).toMatch(/❌ \*\*Tarea rota\*\*.*se rompió/);
    });

    test("una misma tarea no se lanza dos veces a la vez", async () => {
        let liberar;
        const espera = new Promise((r) => (liberar = r));
        let veces = 0;
        tareas.cron.schedule("0 * * * *", () =>
            runJob("Tarea lenta", async () => {
                veces++;
                await espera;
            }),
        );
        const primera = tareas.lanzar(0);
        const segunda = await tareas.lanzar(0);
        expect(segunda.estado).toBe("en_curso");
        expect(extras.buildTareas().embeds[0].data.description).toMatch(/en curso/);
        liberar();
        expect((await primera).estado).toBe("hecha");
        expect(veces).toBe(1);
    });

    test("lanzar desde el panel pide confirmación, ejecuta y audita 'tarea.manual'", async () => {
        const g = nuevoServidor();
        const hecho = jest.fn();
        tareas.cron.schedule("0 * * * 1", () => runJob("Resumen semanal de prueba", async () => hecho()));
        const elige = interaccion({ guildId: g, customId: "paneladmin_sis_tarea_sel", values: ["0"] });
        await extras.handleExtrasSelect(elige);
        const confirmacion = ultimo(elige.update);
        expect(confirmacion.embeds[0].data.description).toMatch(/no se repetirá/);
        expect(hecho).not.toHaveBeenCalled();

        const ok = interaccion({ guildId: g, customId: "paneladmin_sis_tarea_ok_0" });
        await extras.handleExtrasButton(ok);
        expect(hecho).toHaveBeenCalledTimes(1);
        expect(filasAuditoria(g, "tarea")[0]).toMatchObject({ action: "tarea.manual", details: { tarea: "Resumen semanal de prueba" } });
        expect(ultimo(ok.editReply).embeds[0].data.description).toMatch(/lanzada/);
    });

    test("el registro de tareas se exporta como CSV con cabecera", async () => {
        tareas.cron.schedule("0 * * * *", () => runJob("Tarea csv", async () => {}));
        await tareas.lanzar(0);
        const csv = extras.csvDeTareas();
        expect(csv.charCodeAt(0)).toBe(0xfeff);
        expect(csv).toMatch(/tarea;horario;ultima_ejecucion;resultado;ms;error/);
        expect(csv).toMatch(/"Tarea csv";"0 \* \* \* \*";"[^"]+";"OK";/);
    });
});

describe("#422 #423 alertas por categoría y canal de respaldo", () => {
    const G = "g-fase12-alertas";
    const DUENO = "900000000000000010";
    function cliente({ cerrados = false, canal = null } = {}) {
        const dms = [];
        const publicadas = [];
        return {
            dms,
            publicadas,
            guilds: { cache: new Map([[G, { id: G, ownerId: DUENO }]]) },
            users: {
                fetch: async (id) => ({
                    id,
                    send: async (p) => {
                        if (cerrados) throw Object.assign(new Error("Cannot send messages to this user"), { code: 50007 });
                        dms.push(p);
                    },
                }),
            },
            channels: {
                fetch: async (id) => {
                    if (canal === "falla") throw new Error("Unknown Channel");
                    return { id, send: async (p) => publicadas.push({ id, p }) };
                },
            },
        };
    }
    beforeEach(() => {
        alertas._reiniciar();
        guildSettings.setManySettings(G, {
            "alertas.enabled": true,
            "alertas.admin_ids": "",
            "alertas.tipos": "error,gemini,odds,backup",
            "alertas.canal": "",
        });
    });

    test("la categoría se saca del principio de la clave", () => {
        expect(alertas.categoriaDe("error:Backups:x")).toBe("error");
        expect(alertas.categoriaDe("gemini-cuota")).toBe("gemini");
        expect(alertas.categoriaDe("gemini-modelo:flash")).toBe("gemini");
        expect(alertas.categoriaDe("odds-creditos")).toBe("odds");
        expect(alertas.categoriaDe("backup:integridad:2026-10-14")).toBe("backup");
        expect(alertas.categoriaDe("prueba:123")).toBeNull();
    });

    test("una categoría apagada no envía ni cuenta para el límite por hora; las demás siguen", async () => {
        const c = cliente();
        await alertasEnvios.iniciar(c);
        guildSettings.setSetting(G, "alertas.tipos", "error");
        for (let i = 0; i < alertas.MAX_POR_HORA + 3; i++) {
            expect(await alertas.alertar({ clave: `odds-creditos${i}`, titulo: "Odds", detalle: "x" })).toBe(0);
        }
        expect(await alertas.alertar({ clave: "error:Prueba:uno", titulo: "Error", detalle: "x" })).toBe(1);
        expect(c.dms).toHaveLength(1);
    });

    test("con todas las categorías activas todo llega como antes, y la prueba del panel no depende de ellas", async () => {
        const c = cliente();
        await alertasEnvios.iniciar(c);
        guildSettings.setSetting(G, "alertas.tipos", "");
        expect(await alertas.probar("admin")).toBe(1);
        guildSettings.setSetting(G, "alertas.tipos", "error,gemini,odds,backup");
        expect(await alertas.alertar({ clave: "gemini-cuota", titulo: "Gemini", detalle: "x" })).toBe(1);
    });

    test("con los DMs cerrados la alerta se publica en el canal de respaldo", async () => {
        const c = cliente({ cerrados: true });
        await alertasEnvios.iniciar(c);
        guildSettings.setSetting(G, "alertas.canal", "500000000000000005");
        expect(await alertas.alertar({ clave: "error:Prueba:cerrados", titulo: "Error", detalle: "x" })).toBe(0);
        expect(c.publicadas).toHaveLength(1);
        expect(c.publicadas[0].id).toBe("500000000000000005");
        expect(c.publicadas[0].p.embeds[0].data.title).toBe("Error");
    });

    test("si el canal no existe, solo se registra y las siguientes alertas siguen saliendo", async () => {
        const c = cliente({ cerrados: true, canal: "falla" });
        await alertasEnvios.iniciar(c);
        guildSettings.setSetting(G, "alertas.canal", "500000000000000005");
        await expect(alertas.alertar({ clave: "error:Prueba:a", titulo: "A", detalle: "x" })).resolves.toBe(0);
        await expect(alertas.alertar({ clave: "error:Prueba:b", titulo: "B", detalle: "x" })).resolves.toBe(0);
        expect(alertas.estado(G).historial.map((h) => h.titulo)).toEqual(["B", "A"]);
    });

    test("sin canal no se publica en ninguna parte, y si el DM llega no se usa el canal", async () => {
        const cerrado = cliente({ cerrados: true });
        await alertasEnvios.iniciar(cerrado);
        await alertas.alertar({ clave: "error:Prueba:sin canal", titulo: "X", detalle: "x" });
        expect(cerrado.publicadas).toHaveLength(0);

        alertas._reiniciar();
        guildSettings.setSetting(G, "alertas.canal", "500000000000000005");
        const abierto = cliente();
        await alertasEnvios.iniciar(abierto);
        await alertas.alertar({ clave: "error:Prueba:con dm", titulo: "Y", detalle: "x" });
        expect(abierto.dms).toHaveLength(1);
        expect(abierto.publicadas).toHaveLength(0);
    });

    test("un fallo que no es de DMs cerrados no se publica en el canal", async () => {
        const c = cliente();
        c.users.fetch = async () => {
            throw new Error("Unknown User");
        };
        await alertasEnvios.iniciar(c);
        guildSettings.setSetting(G, "alertas.canal", "500000000000000005");
        await alertas.alertar({ clave: "error:Prueba:otro", titulo: "Z", detalle: "x" });
        expect(c.publicadas).toHaveLength(0);
    });
});

describe("#424 /mensaje programado", () => {
    const G = "g-fase12-mensajes";
    const destino = { id: "600000000000000006", username: "Raúl", bot: false };
    const enDosDias = () => {
        const m = momentoMadrid(Date.now() + 2 * 24 * 3600 * 1000);
        const [a, mes, d] = m.dia.split("-");
        return { texto: `${d}/${mes}/${a} 12:00`, hora: m };
    };

    function orden({ cuando, canal = null } = {}) {
        return interaccion({
            guildId: G,
            options: { getUser: () => destino, getChannel: () => canal, getString: () => cuando },
        });
    }

    test("una fecha mal escrita o pasada no abre el formulario", async () => {
        for (const cuando of ["mañana", "01/01/2020 10:00"]) {
            const i = orden({ cuando });
            await mensaje.run({}, i);
            expect(i.showModal).not.toHaveBeenCalled();
            expect(ultimo(i.reply).content).toMatch(/❌/);
        }
    });

    test("con fecha válida abre el formulario con el destino y la hora; al enviarlo queda programado y auditado sin el texto", async () => {
        const { texto } = enDosDias();
        const i = orden({ cuando: texto });
        await mensaje.run({}, i);
        const id = i.showModal.mock.calls[0][0].data.custom_id;
        expect(id).toMatch(/^mensaje_modal_prog_600000000000000006_\d+$/);

        const envio = interaccion({
            guildId: G,
            customId: id,
            fields: { getTextInputValue: () => "Mañana hay reunión" },
        });
        await mensaje.handleModal({ users: { fetch: async () => destino } }, envio);

        const [pendiente] = programados.listarPendientes(G);
        expect(pendiente).toMatchObject({ destinoId: destino.id, caracteres: 18 });
        expect(pendiente.text).toBeUndefined();
        const [fila] = filasAuditoria(G, "mensaje");
        expect(fila.action).toBe("mensaje.programado");
        expect(JSON.stringify(fila.details)).not.toMatch(/reunión/);
        programados.cancelar(pendiente.id, G);
    });

    test("cancelar lo borra, borra el texto y queda auditado", async () => {
        const g = nuevoServidor();
        const r = programados.programar({
            guildId: g,
            autorId: ACTOR,
            destinoId: destino.id,
            texto: "secreto",
            enviarEn: Date.now() + 3600_000,
        });
        expect(r.ok).toBe(true);
        const sel = interaccion({ guildId: g, customId: "paneladmin_sis_msgs_cancelar", values: [String(r.id)] });
        await extras.handleExtrasSelect(sel);
        expect(programados.listarPendientes(g)).toHaveLength(0);
        expect(db.prepare("SELECT estado, texto FROM mensajes_programados WHERE id = ?").get(r.id)).toEqual({
            estado: "cancelado",
            texto: null,
        });
        expect(filasAuditoria(g, "mensaje")[0]).toMatchObject({ action: "mensaje.cancelado", details: { id: r.id } });
        // Cancelarlo otra vez no hace nada.
        expect(programados.cancelar(r.id, g)).toBeNull();
    });

    test("sale a su hora; si el bot estaba apagado, sale al arrancar con el aviso; el texto se borra", async () => {
        const g = nuevoServidor();
        const enviados = [];
        const client = { users: { fetch: async (id) => ({ id, send: async (p) => enviados.push({ id, p }) }) } };
        const ahora = Date.now();
        const a = programados.programar({ guildId: g, autorId: ACTOR, destinoId: "d1", texto: "A tiempo", enviarEn: ahora + 1000 }, ahora);
        const b = programados.programar({ guildId: g, autorId: ACTOR, destinoId: "d2", texto: "Tarde", enviarEn: ahora + 2000 }, ahora);
        const futuro = programados.programar(
            { guildId: g, autorId: ACTOR, destinoId: "d3", texto: "Más adelante", enviarEn: ahora + 6 * 3600_000 },
            ahora,
        );

        // Un poco después de la hora: sale tal cual. Mucho después: lleva el aviso de que llega tarde.
        expect(await programados.enviarVencidos(client, ahora + 1500)).toEqual({ enviados: 1, fallidos: 0 });
        expect(enviados[0]).toEqual({ id: "d1", p: { content: "A tiempo" } });
        expect(await programados.enviarVencidos(client, ahora + 3 * 3600_000)).toEqual({ enviados: 1, fallidos: 0 });
        expect(enviados[1].p.content).toMatch(/el bot estaba apagado/);
        expect(enviados[1].p.content).toMatch(/Tarde$/);

        expect(programados.listarPendientes(g).map((m) => m.id)).toEqual([futuro.id]);
        expect(db.prepare("SELECT estado, texto FROM mensajes_programados WHERE id IN (?, ?)").all(a.id, b.id)).toEqual([
            { estado: "enviado", texto: null },
            { estado: "enviado", texto: null },
        ]);
    });

    test("con los DMs cerrados queda como fallido (sin reintentar) y no se pueden programar fechas pasadas", async () => {
        const g = nuevoServidor();
        const client = {
            users: {
                fetch: async () => ({
                    send: async () => {
                        throw Object.assign(new Error("closed"), { code: 50007 });
                    },
                }),
            },
        };
        const ahora = Date.now();
        const r = programados.programar({ guildId: g, autorId: ACTOR, destinoId: "d9", texto: "x", enviarEn: ahora + 10 }, ahora);
        expect(await programados.enviarVencidos(client, ahora + 20)).toEqual({ enviados: 0, fallidos: 1 });
        expect(db.prepare("SELECT estado, texto FROM mensajes_programados WHERE id = ?").get(r.id)).toEqual({
            estado: "fallido",
            texto: null,
        });
        expect(programados.programar({ guildId: g, autorId: ACTOR, destinoId: "d9", texto: "x", enviarEn: ahora - 1 }, ahora).ok).toBe(
            false,
        );
    });

    test("las vistas de mensajes pendientes no enseñan el texto", () => {
        const g = nuevoServidor();
        programados.programar({ guildId: g, autorId: ACTOR, destinoId: "d4", texto: "contenido privado", enviarEn: Date.now() + 3600_000 });
        const vista = JSON.stringify(extras.buildMensajes(g).embeds[0].data);
        expect(vista).toMatch(/17 caracteres/);
        expect(vista).not.toMatch(/contenido privado/);
    });
});

describe("#425 modo mantenimiento", () => {
    const G = "g-fase12-mantenimiento";
    const usuario = (permisos, extra = {}) => ({ guildId: G, memberPermissions: permisos, ...extra });

    test("sin el modo activo nadie se bloquea", () => {
        guildSettings.setSetting(G, "mantenimiento.activo", false);
        expect(mantenimiento.mensajeSiBloquea(usuario(NO_ADMIN))).toBeNull();
    });

    test("con el modo activo un no admin recibe el mensaje configurado y un admin sigue", () => {
        guildSettings.setManySettings(G, { "mantenimiento.activo": true, "mantenimiento.mensaje": "Volvemos a las 18:00" });
        expect(mantenimiento.mensajeSiBloquea(usuario(NO_ADMIN))).toBe("Volvemos a las 18:00");
        expect(mantenimiento.mensajeSiBloquea(usuario(ADMIN))).toBeNull();
        // En un DM (sin servidor) no hay modo mantenimiento que valga.
        expect(mantenimiento.mensajeSiBloquea({ memberPermissions: NO_ADMIN })).toBeNull();
        // Otro servidor no se ve afectado.
        expect(mantenimiento.mensajeSiBloquea({ guildId: "otro-servidor", memberPermissions: NO_ADMIN })).toBeNull();
    });

    test("el botón de Config Global lo enciende y apaga, audita el cambio y el diagnóstico de Sistema lo muestra", async () => {
        const g = nuevoServidor();
        const { handleSettingsButton } = require("../src/adminPanel/settings/botones");
        const i = interaccion({ guildId: g, customId: "paneladmin_cfg_mantenimiento" });
        await handleSettingsButton(i);
        expect(guildSettings.getSettings(g).mantenimiento.activo).toBe(true);
        expect(ultimo(i.update).embeds[0].data.fields.some((f) => f.name === "🛠️ Mantenimiento")).toBe(true);
        expect(filasAuditoria(g, "mantenimiento")[0]).toMatchObject({
            action: "mantenimiento.activar",
            details: { cambios: { "mantenimiento.activo": { antes: false, despues: true } } },
        });

        const { handleSistemaButton } = require("../src/adminPanel/sistema");
        const diag = interaccion({
            guildId: g,
            customId: "paneladmin_sis_home",
            client: { slashCommands: new Map(), guilds: { cache: new Map() } },
        });
        await handleSistemaButton(diag);
        const campo = ultimo(diag.update).embeds[0].data.fields.find((f) => f.name === "🛠️ Mantenimiento");
        expect(campo.value).toMatch(/ACTIVO/);
        await handleSettingsButton(interaccion({ guildId: g, customId: "paneladmin_cfg_mantenimiento" }));
        expect(guildSettings.getSettings(g).mantenimiento.activo).toBe(false);
        expect(filasAuditoria(g, "mantenimiento")[0].action).toBe("mantenimiento.desactivar");
    });
});
