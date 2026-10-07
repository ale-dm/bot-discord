// 🏆 Clasificación semanal con premios (F-EC-03, issue #35): el más rico, el más activo (XP ganada desde la anterior) y
// el mejor apostador de la semana (F-AP-03), con datos reales en la BD (en memoria): quién gana, el mensaje, los premios
// pagados (con el impuesto del servidor), una vez por semana los lunes desde las 10:00 de Madrid, y el panel.
const Database = require("better-sqlite3");
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const guildSettings = require("../src/systems/guildSettings");
const clasificacion = require("../src/systems/clasificacionSemanal");
const { beneficioEntre } = require("../src/systems/apuestas/ranking");
const { runMigrations } = require("../src/core/migrations");
const paneladmin = require("../src/commands/admin/paneladmin");

const G = "g-semanal";
// Lunes 12 de octubre de 2026 a las 10:30 en Madrid (08:30 UTC): la semana anterior es del 5 al 11.
const LUNES = Date.UTC(2026, 9, 12, 8, 30);
const SEMANA = { lunes: "2026-10-05", domingo: "2026-10-11" };

db.prepare(
    "INSERT INTO banco (userId, saldo, enMano) VALUES ('rico', 9000, 1000), ('ana', 0, 100), ('luis', 0, 100), ('pepe', 0, 100)",
).run();
// XP: ana tenía 900 al empezar la semana y ahora 1.000 (+100); luis, de 0 a 300 (+300).
db.prepare("INSERT INTO xp_users (guildId, userId, xp_total) VALUES (?, 'ana', 1000), (?, 'luis', 300), ('otro', 'rico', 99999)").run(G, G);
db.prepare("INSERT INTO clasificacion_xp (guildId, userId, xp_total) VALUES (?, 'ana', 900)").run(G);

let n = 0;
function apuesta(userId, inicio, cantidad, premio) {
    const id = `cs-${++n}`;
    db.prepare(
        "INSERT INTO apuestas_partidos (match_id, home_team, away_team, start_time, estado, resultado) VALUES (?, 'A', 'B', ?, 'finalizado', 'home')",
    ).run(id, inicio);
    db.prepare(
        "INSERT INTO apuestas_usuario (user_id, match_id, eleccion, cantidad, cuota, pagado, premio) VALUES (?, ?, 'home', ?, 2, 1, ?)",
    ).run(userId, id, cantidad, premio);
}
apuesta("pepe", "2026-10-07T18:00:00.000Z", 100, 300); // +200
apuesta("marta", "2026-10-08T18:00:00.000Z", 100, 150); // +50
apuesta("marta", "2026-10-05T00:30:00.000Z", 100, 0); // -100 (el lunes 5 a las 02:30 en Madrid: cuenta)
apuesta("pepe", "2026-10-11T22:30:00.000Z", 10, 10000); // el 12 a las 00:30 en Madrid: es de esta semana, no cuenta
apuesta("pepe", "2026-10-04T21:30:00.000Z", 10, 10000); // el domingo 4 en Madrid: de la semana anterior, no cuenta
const q = db
    .prepare("INSERT INTO quinielas (deporte, jornada, estado, creada_en, cerrada_en) VALUES ('laliga', 'J', 'cerrada', ?, ?)")
    .run("2026-10-01T10:00:00.000Z", "2026-10-11T21:30:00.000Z").lastInsertRowid; // domingo 11 a las 23:30 en Madrid
db.prepare(
    "INSERT INTO quiniela_apuestas (quiniela_id, user_id, predicciones, cantidad, premio, pagado, creada_en) VALUES (?, 'marta', '1', 50, 400, 1, 'x')",
).run(q); // +350

test("el beneficio de cada uno en lo resuelto esa semana, en hora de Madrid", () => {
    expect(beneficioEntre(SEMANA.lunes, SEMANA.domingo)).toEqual([
        { userId: "marta", beneficio: 300, resueltas: 3 },
        { userId: "pepe", beneficio: 200, resueltas: 1 },
    ]);
});

test("quién gana cada premio", () => {
    expect(clasificacion.semanaAnterior(LUNES)).toEqual(SEMANA);
    // Un domingo por la noche, la semana anterior todavía es la otra.
    expect(clasificacion.semanaAnterior(Date.UTC(2026, 9, 11, 21))).toEqual({ lunes: "2026-09-28", domingo: "2026-10-04" });
    expect(clasificacion.ganadores(G, SEMANA)).toEqual({
        rico: { userId: "rico", total: 10000 },
        activo: { userId: "luis", xp: 300 },
        apostador: { userId: "marta", beneficio: 300, resueltas: 3 },
    });
    // Sin XP nueva ni beneficio, no hay más activo ni mejor apostador.
    expect(clasificacion.ganadores("g-vacio", { lunes: "2026-01-05", domingo: "2026-01-11" })).toMatchObject({
        activo: null,
        apostador: null,
    });
});

describe("publicación", () => {
    const canal = { isTextBased: () => true, send: jest.fn(async () => {}) };
    const servidor = (id) => ({ id, name: id, channels: { cache: new Map([["canal-1", canal]]), fetch: async () => null } });
    const client = { guilds: { cache: new Map([G, "g-sin-canal"].map((id) => [id, servidor(id)])) } };

    test("solo los lunes desde las 10:00 de Madrid, y nada sin canal", async () => {
        expect(await clasificacion.publicarSiToca(client, LUNES)).toBe(0); // aún sin canal
        guildSettings.setSetting(G, "clasificacion.canal", "canal-1");
        expect(await clasificacion.publicarSiToca(client, Date.UTC(2026, 9, 12, 7, 30))).toBe(0); // 09:30
        expect(await clasificacion.publicarSiToca(client, Date.UTC(2026, 9, 13, 8, 30))).toBe(0); // martes
        expect(canal.send).not.toHaveBeenCalled();
    });

    test("publica, paga el premio a cada uno (con el impuesto) y empieza a contar la XP de nuevo", async () => {
        const antes = { rico: dinero.efectivo("rico"), luis: dinero.efectivo("luis"), marta: dinero.efectivo("marta") };
        expect(await clasificacion.publicarSiToca(client, LUNES)).toBe(1);
        const msg = canal.send.mock.calls[0][0];
        expect(msg.content).toBe(
            "🏆 **Clasificación semanal** · del 5 de octubre al 11 de octubre\n\n" +
                "💰 **El más rico**: <@rico> (10.000 🪙 entre efectivo y banco)\n" +
                "💬 **El más activo**: <@luis> (+300 XP esta semana)\n" +
                "⚽ **El mejor apostador**: <@marta> (+300 🪙 en 3 apuestas)\n\n" +
                "Cada premio: **500** 🪙 al efectivo.",
        );
        expect(msg.allowedMentions.users.sort()).toEqual(["luis", "marta", "rico"]);
        // 500 de premio menos el 5 % del impuesto por defecto del servidor.
        expect(dinero.efectivo("rico")).toBe(antes.rico + 475);
        expect(dinero.efectivo("luis")).toBe(antes.luis + 475);
        expect(dinero.efectivo("marta")).toBe(antes.marta + 475);
        const [impuesto, premio] = dinero.movimientos("luis", { limite: 2 }).filas;
        expect(premio).toMatchObject({ descripcion: "Clasificación semanal: el más activo", cantidad: 500, tipo: "premio" });
        expect(impuesto).toMatchObject({ cantidad: -25, tipo: "impuesto" });
        // La XP de ahora es el punto de partida de la siguiente semana.
        expect(db.prepare("SELECT userId, xp_total FROM clasificacion_xp WHERE guildId = ? ORDER BY userId").all(G)).toEqual([
            { userId: "ana", xp_total: 1000 },
            { userId: "luis", xp_total: 300 },
        ]);
        expect(clasificacion.ganadores(G, SEMANA).activo).toBeNull();

        // Una hora después (o tras reiniciar), nada nuevo.
        expect(await clasificacion.publicarSiToca(client, LUNES + 3600 * 1000)).toBe(0);
        expect(canal.send).toHaveBeenCalledTimes(1);
        expect(dinero.efectivo("rico")).toBe(antes.rico + 475);
    });

    test("si el canal falla no se paga nada (y se reintenta)", async () => {
        const roto = { isTextBased: () => true, send: jest.fn(async () => Promise.reject(new Error("Missing Access"))) };
        const guild = { id: "g-roto", name: "roto", channels: { cache: new Map([["canal-roto", roto]]) } };
        guildSettings.setSetting("g-roto", "clasificacion.canal", "canal-roto");
        const antes = dinero.efectivo("rico");
        await expect(clasificacion.publicar(guild, { semana: SEMANA })).rejects.toThrow("Missing Access");
        expect(dinero.efectivo("rico")).toBe(antes);
        expect(guildSettings.getSettings("g-roto").clasificacion.ultima_semana).toBe("");
    });
});

test("la migración 022 parte de la XP que ya tenía cada uno", () => {
    const otra = new Database(":memory:");
    runMigrations(otra);
    otra.prepare("DELETE FROM schema_migrations WHERE version = 22").run();
    otra.exec("DROP TABLE clasificacion_xp");
    otra.prepare("INSERT INTO xp_users (guildId, userId, xp_total) VALUES ('g', 'u', 1234)").run();
    runMigrations(otra);
    expect(otra.prepare("SELECT * FROM clasificacion_xp").all()).toEqual([{ guildId: "g", userId: "u", xp_total: 1234 }]);
});

describe("/paneladmin → ⚙️ Config Global → 🏆 Semanal", () => {
    const P = "g-panel-semanal";
    const interaccion = (extra) => ({
        guildId: P,
        guild: { id: P },
        user: { id: "admin", tag: "admin" },
        member: { permissions: { has: () => true } },
        isFromMessage: () => true,
        reply: jest.fn(async () => {}),
        update: jest.fn(async () => {}),
        showModal: jest.fn(async () => {}),
        ...extra,
    });
    const campo = (payload, nombre) => payload.embeds[0].data.fields.find((f) => f.name === nombre).value;

    test("Config Global tiene el botón y la pantalla dice quién ganaría", async () => {
        const home = interaccion({ customId: "paneladmin_cfg_home" });
        await paneladmin.handleButton(null, home);
        const botones = home.update.mock.calls[0][0].components.flatMap((r) => r.toJSON().components.map((c) => c.custom_id));
        expect(botones).toContain("paneladmin_semanal_home");

        const semanal = interaccion({ customId: "paneladmin_semanal_home" });
        await paneladmin.handleButton(null, semanal);
        const payload = semanal.update.mock.calls[0][0];
        expect(campo(payload, "📢 Canal")).toBe("Ninguno: no se publica ni se paga nada");
        expect(campo(payload, "🪙 Premio")).toBe("**500** 🪙 por categoría");
        expect(campo(payload, "👀 Si fuera ahora")).toMatch(/^💰 <@rico>/);
    });

    test("canal y premio", async () => {
        await paneladmin.handleChannelSelect(
            null,
            interaccion({ customId: "paneladmin_semanal_canal_select", values: ["123456789012345678"] }),
        );
        expect(guildSettings.getSettings(P).clasificacion.canal).toBe("123456789012345678");

        const boton = interaccion({ customId: "paneladmin_semanal_premio" });
        await paneladmin.handleButton(null, boton);
        expect(boton.showModal.mock.calls[0][0].toJSON().components[0].components[0].value).toBe("500");

        const mal = interaccion({ customId: "paneladmin_semanal_premio_modal", fields: { getTextInputValue: () => "-5" } });
        await paneladmin.handleModal(null, mal);
        expect(mal.reply.mock.calls[0][0].content).toMatch(/número entero de 0 a 1\.000\.000/);

        const ok = interaccion({ customId: "paneladmin_semanal_premio_modal", fields: { getTextInputValue: () => "2000" } });
        await paneladmin.handleModal(null, ok);
        expect(guildSettings.getSettings(P).clasificacion.premio).toBe(2000);
        expect(campo(ok.update.mock.calls[0][0], "📢 Canal")).toBe("<#123456789012345678>");

        const quitar = interaccion({ customId: "paneladmin_semanal_canal_quitar" });
        await paneladmin.handleButton(null, quitar);
        expect(guildSettings.getSettings(P).clasificacion.canal).toBe("");
    });
});
