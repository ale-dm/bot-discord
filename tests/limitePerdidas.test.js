// 🛡️ Límite de pérdidas personal (#319): las reglas (poner, bajar, subir con 24 h, quitar, pérdidas netas del periodo), que el casino
// y las apuestas no dejen apostar al pasarse, y la pantalla de /perfil → 💰 Economía. BD en memoria; el reloj se pasa a mano.
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const limite = require("../src/systems/limitePerdidas");
const cas = require("../src/systems/casinoTransactions");
const limitesApuestas = require("../src/systems/apuestas/limites");
const quinielaReglas = require("../src/systems/apuestas/quinielaReglas");
const panel = require("../src/paneles/limitePerdidas");
const economia = require("../src/paneles/economia");
const handlers = require("../src/perfil/dinero");

const HORA = 3600_000;
// Miércoles 14 de octubre de 2026, 12:00 en Madrid (10:00 UTC, horario de verano).
const AHORA = Date.UTC(2026, 9, 14, 10, 0, 0);
let n = 0;
const nuevo = () => `lp-${++n}`;
function apunta(userId, tipo, cantidad, fecha = AHORA) {
    db.prepare("INSERT INTO historial (userId, fecha, descripcion, cantidad, tipo) VALUES (?, ?, 'x', ?, ?)").run(
        userId,
        new Date(fecha).toISOString(),
        cantidad,
        tipo,
    );
}

describe("poner, bajar, subir y quitar", () => {
    test("sin límite, ponerlo vale al momento; los datos tienen que ser válidos", () => {
        const u = nuevo();
        expect(limite.estado(u, AHORA)).toBeNull();
        for (const malo of [0, -5, 1.5, "abc", "", 2_000_000_000]) expect(limite.fijar(u, malo, "dia", AHORA).ok).toBe(false);
        expect(limite.fijar(u, 100, "mes", AHORA).motivo).toMatch(/por día o por semana/);
        expect(limite.fijar(u, "500", "dia", AHORA)).toEqual({ ok: true, inmediato: true });
        expect(limite.estado(u, AHORA)).toEqual({ limite: 500, periodo: "dia", pendiente: null });
    });

    test("bajarlo vale al momento (también cambiando de periodo si cabe menos en una semana)", () => {
        const u = nuevo();
        limite.fijar(u, 100, "dia", AHORA); // 700 a la semana
        expect(limite.fijar(u, 50, "dia", AHORA).inmediato).toBe(true);
        expect(limite.fijar(u, 300, "semana", AHORA).inmediato).toBe(true); // 300 < 350
        expect(limite.estado(u, AHORA)).toMatchObject({ limite: 300, periodo: "semana", pendiente: null });
    });

    test("subirlo tarda 24 horas: mientras tanto sigue el de ahora, y después pasa al nuevo", () => {
        const u = nuevo();
        limite.fijar(u, 100, "dia", AHORA);
        const r = limite.fijar(u, 500, "dia", AHORA);
        expect(r).toEqual({ ok: true, inmediato: false, aplicaEn: AHORA + 24 * HORA });
        expect(limite.estado(u, AHORA + 23 * HORA)).toEqual({
            limite: 100,
            periodo: "dia",
            pendiente: { limite: 500, periodo: "dia", aplicaEn: AHORA + 24 * HORA },
        });
        expect(limite.estado(u, AHORA + 24 * HORA)).toEqual({ limite: 500, periodo: "dia", pendiente: null });
        expect(limite.estado(u, AHORA + 25 * HORA).limite).toBe(500); // y queda guardado
    });

    test("pasar a un periodo más holgado también espera, y bajar después cancela lo pendiente", () => {
        const u = nuevo();
        limite.fijar(u, 100, "dia", AHORA);
        expect(limite.fijar(u, 1000, "semana", AHORA).inmediato).toBe(false); // 1000 a la semana > 700
        expect(limite.fijar(u, 80, "dia", AHORA + HORA).inmediato).toBe(true);
        expect(limite.estado(u, AHORA + 30 * HORA)).toEqual({ limite: 80, periodo: "dia", pendiente: null });
    });

    test("quitarlo también tarda 24 horas, no reinicia la espera si se pide otra vez, y sin límite lo dice", () => {
        const u = nuevo();
        expect(limite.quitar(u, AHORA).motivo).toMatch(/ningún límite/);
        limite.fijar(u, 100, "dia", AHORA);
        expect(limite.quitar(u, AHORA)).toEqual({ ok: true, aplicaEn: AHORA + 24 * HORA });
        expect(limite.quitar(u, AHORA + 5 * HORA)).toEqual({ ok: true, aplicaEn: AHORA + 24 * HORA });
        expect(limite.estado(u, AHORA + 10 * HORA)).toMatchObject({ limite: 100, pendiente: { limite: 0 } });
        expect(limite.estado(u, AHORA + 24 * HORA)).toBeNull();
        expect(limite.motivoDeBloqueo(u, 1e9, AHORA + 24 * HORA)).toBeNull();
    });
});

describe("las pérdidas del periodo", () => {
    test("son netas, de casino y apuestas, y de hoy (o de la semana) en hora de Madrid", () => {
        const u = nuevo();
        apunta(u, "casino", -300);
        apunta(u, "apuestas", -100);
        apunta(u, "casino", 50); // una ganancia resta
        apunta(u, "tienda", -999); // lo que no es juego no cuenta
        apunta(u, "casino", -500, AHORA - 24 * HORA); // ayer (martes, misma semana)
        apunta(u, "apuestas", -700, Date.UTC(2026, 9, 11, 10)); // el domingo anterior: otra semana
        expect(limite.perdidasDelPeriodo(u, "dia", AHORA)).toBe(350);
        expect(limite.perdidasDelPeriodo(u, "semana", AHORA)).toBe(850);
    });

    test("el día cambia a medianoche de Madrid, no de UTC", () => {
        const u = nuevo();
        apunta(u, "casino", -200, Date.UTC(2026, 9, 13, 22, 30)); // 00:30 del miércoles en Madrid
        apunta(u, "casino", -400, Date.UTC(2026, 9, 13, 21, 30)); // 23:30 del martes en Madrid
        expect(limite.perdidasDelPeriodo(u, "dia", AHORA)).toBe(200);
    });

    test("si va ganando, no hay pérdidas; y una apuesta sin resolver cuenta hasta que se cobra", () => {
        const u = nuevo();
        apunta(u, "casino", 900);
        apunta(u, "apuestas", -100);
        expect(limite.perdidasDelPeriodo(u, "dia", AHORA)).toBe(0);
        const v = nuevo();
        apunta(v, "apuestas", -100); // apostada
        expect(limite.perdidasDelPeriodo(v, "dia", AHORA)).toBe(100);
        apunta(v, "apuestas", 250); // cobrada
        expect(limite.perdidasDelPeriodo(v, "dia", AHORA)).toBe(0);
    });
});

describe("no deja apostar al pasarse", () => {
    test("sin límite, o dentro de él, se puede", () => {
        const u = nuevo();
        expect(limite.motivoDeBloqueo(u, 1_000_000, AHORA)).toBeNull();
        limite.fijar(u, 500, "dia", AHORA);
        apunta(u, "casino", -300);
        expect(limite.motivoDeBloqueo(u, 200, AHORA)).toBeNull();
    });

    test("con el límite alcanzado, no hasta mañana; si la apuesta lo pasaría, dice lo que queda", () => {
        const u = nuevo();
        limite.fijar(u, 500, "dia", AHORA);
        apunta(u, "casino", -300);
        expect(limite.motivoDeBloqueo(u, 250, AHORA)).toBe(
            "Tu límite de pérdidas es de **500** 🪙 por día y llevas perdidos **300** 🪙: esta apuesta lo pasaría. Como mucho puedes apostar **200** 🪙 más hasta mañana.",
        );
        apunta(u, "apuestas", -200);
        expect(limite.motivoDeBloqueo(u, 10, AHORA)).toBe(
            "Tu límite de pérdidas es de **500** 🪙 por día y ya lo has alcanzado: no puedes apostar hasta mañana (hora de Madrid).",
        );
        // Al día siguiente vuelve a poder.
        expect(limite.motivoDeBloqueo(u, 10, AHORA + 24 * HORA)).toBeNull();
    });

    test("el límite semanal dice «el lunes» y es solo de quien lo puso", () => {
        const u = nuevo();
        const otra = nuevo();
        limite.fijar(u, 100, "semana", AHORA);
        apunta(u, "casino", -100);
        apunta(otra, "casino", -100);
        expect(limite.motivoDeBloqueo(u, 10, AHORA)).toMatch(/por semana y ya lo has alcanzado: no puedes apostar hasta el lunes/);
        expect(limite.motivoDeBloqueo(otra, 10, AHORA)).toBeNull();
    });

    test("el casino lo respeta: no cobra nada ni gasta cooldown ni cupo", () => {
        const u = nuevo();
        dinero.asegurarCuenta(u);
        db.prepare("UPDATE banco SET enMano = 1000 WHERE userId = ?").run(u);
        limite.fijar(u, 100, "dia");
        apunta(u, "casino", -100, Date.now());
        const r = cas.descontarApuesta(u, 50, null, "blackjack");
        expect(r.exito).toBe(false);
        expect(r.mensaje).toMatch(/^🛑 Tu límite de pérdidas es de \*\*100\*\* 🪙 por día y ya lo has alcanzado/);
        expect(dinero.efectivo(u)).toBe(1000);
        // Sin el límite (ya quitado o de otra persona) juega con normalidad.
        const libre = nuevo();
        dinero.asegurarCuenta(libre);
        db.prepare("UPDATE banco SET enMano = 1000 WHERE userId = ?").run(libre);
        expect(cas.descontarApuesta(libre, 50, null, "blackjack").exito).toBe(true);
    });

    test("las apuestas, las combinadas y la quiniela lo respetan, antes que los límites del servidor", () => {
        const u = nuevo();
        dinero.asegurarCuenta(u);
        db.prepare("UPDATE banco SET enMano = 5000 WHERE userId = ?").run(u);
        limite.fijar(u, 100, "dia");
        apunta(u, "apuestas", -80, Date.now());
        expect(limitesApuestas.comprobar("g-limite", u, 50, { matchId: "m1" })).toMatch(
            /esta apuesta lo pasaría\. Como mucho puedes apostar \*\*20\*\*/,
        );
        expect(limitesApuestas.comprobar("g-limite", u, 20)).toBeNull();
        const aviso = quinielaReglas.avisoDeApuesta({
            userId: u,
            guildId: "g-limite",
            quinielaId: 98765,
            partidos: 3,
            pronosticos: "1X2",
            cantidad: 50,
        });
        expect(aviso).toMatch(/^🚦 Tu límite de pérdidas/);
    });
});

describe("la pantalla de /perfil → 💰 Economía → 🛡️ Límite de pérdidas", () => {
    const interaccion = (userId, customId, extra = {}) => ({
        customId,
        user: { id: userId, username: userId, tag: `${userId}#1` },
        guildId: "g-limite",
        update: jest.fn(async () => {}),
        reply: jest.fn(async () => {}),
        showModal: jest.fn(async () => {}),
        isFromMessage: () => true,
        ...extra,
    });
    const campos = (limiteTexto, periodo) => ({ getTextInputValue: () => limiteTexto, getRadioGroup: () => periodo });
    const botones = (payload) => payload.components[0].components.map((b) => b.data);

    test("la pestaña Economía tiene el botón, solo en tu propio perfil", () => {
        const todos = (viewerId, targetId, propio) =>
            economia
                .buildEconomia({ viewerId, targetId, nombre: "ana" })
                .then((p) => p.components.flatMap((f) => f.components.map((b) => b.data.custom_id)));
        return Promise.all([todos("a", "a", true), todos("a", "b", false)]).then(([mio, ajeno]) => {
            expect(mio).toContain("dinero_limite");
            expect(ajeno).not.toContain("dinero_limite");
        });
    });

    test("sin límite: lo dice y no hay nada que quitar; con límite enseña lo perdido y lo pendiente", () => {
        const u = nuevo();
        const vacio = panel.buildLimite(u);
        expect(vacio.embeds[0].data.fields).toEqual([{ name: "Tu límite", value: "Sin límite", inline: true }]);
        expect(botones(vacio).map((b) => [b.custom_id, !!b.disabled])).toEqual([
            ["dinero_limite_editar", false],
            ["dinero_limite_quitar", true],
            [`perfil_eco_${u}_${u}`, false],
        ]);
        limite.fijar(u, 500, "dia");
        apunta(u, "casino", -120, Date.now());
        limite.fijar(u, 900, "dia");
        const con = panel.buildLimite(u).embeds[0].data.fields;
        expect(con.map((f) => f.name)).toEqual(["Tu límite", "Perdido por día", "⏳ Cambio pendiente"]);
        expect(con[0].value).toBe("**500** 🪙 por día");
        expect(con[1].value).toBe("**120** 🪙");
        expect(con[2].value).toMatch(/Pasará a \*\*900\*\* 🪙 por día <t:\d+:R>/);
    });

    test("el botón abre la pantalla y ✏️ el formulario con lo que ya hay", async () => {
        const u = nuevo();
        limite.fijar(u, 700, "semana");
        const abre = interaccion(u, "dinero_limite");
        await handlers.handleButton(null, abre);
        expect(abre.update.mock.calls[0][0].embeds[0].data.title).toBe("🛡️ Límite de pérdidas");
        const edita = interaccion(u, "dinero_limite_editar");
        await handlers.handleButton(null, edita);
        const modal = edita.showModal.mock.calls[0][0].toJSON();
        expect(modal.custom_id).toBe("dinero_modal_limite");
        expect(modal.components[0].component.value).toBe("700");
        expect(modal.components[1].component.options.find((o) => o.default).value).toBe("semana");
    });

    test("el formulario pone el límite, avisa de la espera al subirlo y rechaza lo que no vale", async () => {
        const u = nuevo();
        const pone = interaccion(u, "dinero_modal_limite", { fields: campos("1.000", "dia") });
        await handlers.handleModal(null, pone);
        expect(pone.update.mock.calls[0][0].embeds[0].data.description).toMatch(
            /^✅ Límite de pérdidas: \*\*1000\*\* 🪙 por día\. Ya está en marcha\./,
        );
        expect(limite.estado(u).limite).toBe(1000);

        const sube = interaccion(u, "dinero_modal_limite", { fields: campos("5000", "dia") });
        await handlers.handleModal(null, sube);
        expect(sube.update.mock.calls[0][0].embeds[0].data.description).toMatch(
            /^⏳ Subir el límite a \*\*5000\*\* 🪙 por día tarda 24 horas/,
        );
        expect(limite.estado(u).limite).toBe(1000);

        const mal = interaccion(u, "dinero_modal_limite", { fields: campos("mucho", "dia") });
        await handlers.handleModal(null, mal);
        expect(mal.update.mock.calls[0][0].embeds[0].data.description).toMatch(/^❌ El límite es un número entero/);
    });

    test("🗑️ Quitar avisa de las 24 horas, y sin límite lo dice", async () => {
        const u = nuevo();
        const sin = interaccion(u, "dinero_limite_quitar");
        await handlers.handleButton(null, sin);
        expect(sin.update.mock.calls[0][0].embeds[0].data.description).toMatch(/^❌ No tienes ningún límite/);
        limite.fijar(u, 100, "dia");
        const quita = interaccion(u, "dinero_limite_quitar");
        await handlers.handleButton(null, quita);
        expect(quita.update.mock.calls[0][0].embeds[0].data.description).toMatch(/^⏳ El límite se quitará dentro de 24 horas/);
        expect(limite.estado(u).pendiente.limite).toBe(0);
        const botonQuitar = botones(quita.update.mock.calls[0][0]).find((b) => b.custom_id === "dinero_limite_quitar");
        expect(botonQuitar.disabled).toBe(true);
    });
});
