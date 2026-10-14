// ⚽ Apuestas, fase 4 (1): la probabilidad sin margen en la ficha y en el destacado (#370), la cuota apostada frente a la actual en Mis
// jugadas (#375) y cancelar una combinada (#296). BD en memoria.
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const mercados = require("../src/systems/apuestas/mercados");
const jugadas = require("../src/systems/apuestas/misJugadas");
const cancelarCombinada = require("../src/systems/apuestas/cancelarCombinada");
const combinadas = require("../src/systems/apuestas/combinadas");
const { embedPartido } = require("../src/juegos/apuestas/partido");
const { mensajeDestacado } = require("../src/discord/mensajes/destacado");
const { buildMisJugadas, handleSelect, handleButton } = require("../src/paneles/misJugadas");

const HORA = 3600_000;
const futuro = (h) => new Date(Date.now() + h * HORA).toISOString();
let n = 0;
const persona = (efectivo = 1000) => {
    const id = `acc-${++n}`;
    dinero.asegurarCuenta(id);
    db.prepare("UPDATE banco SET enMano = ? WHERE userId = ?").run(efectivo, id);
    return id;
};
function partido(extra = {}) {
    const matchId = `acc-m${++n}`;
    const p = {
        match_id: matchId,
        home_team: "Betis",
        away_team: "Sevilla",
        start_time: futuro(24),
        estado: "abierto",
        deporte: "laliga",
        cuota_home: 2,
        cuota_draw: 4,
        cuota_away: 4,
        ...extra,
    };
    db.prepare(
        `INSERT INTO apuestas_partidos (match_id, home_team, away_team, start_time, estado, deporte, cuota_home, cuota_draw, cuota_away, cuota_mas, cuota_menos, total_linea)
         VALUES (@match_id, @home_team, @away_team, @start_time, @estado, @deporte, @cuota_home, @cuota_draw, @cuota_away, @cuota_mas, @cuota_menos, @total_linea)`,
    ).run({ cuota_mas: null, cuota_menos: null, total_linea: null, ...p });
    return p;
}
const apostar = (userId, matchId, eleccion, cantidad, cuota) =>
    db
        .prepare("INSERT INTO apuestas_usuario (user_id, match_id, eleccion, cantidad, cuota) VALUES (?, ?, ?, ?, ?)")
        .run(userId, matchId, eleccion, cantidad, cuota);

describe("probabilidad implícita sin margen (#370)", () => {
    test("las tres suman 100 % tras quitar el margen, y el margen es la suma de 1/cuota menos 100", () => {
        const p = mercados.probabilidadesSinMargen({ cuota_home: 2, cuota_draw: 4, cuota_away: 4 });
        expect(p.home + p.draw + p.away).toBeCloseTo(100, 10);
        expect(p.margen).toBeCloseTo(0, 10); // 1/2 + 1/4 + 1/4 = 1
        const casa = mercados.probabilidadesSinMargen({ cuota_home: 1.9, cuota_draw: 3.5, cuota_away: 4.2 });
        expect(casa.margen).toBeCloseTo((1 / 1.9 + 1 / 3.5 + 1 / 4.2 - 1) * 100, 10);
        expect(casa.home + casa.draw + casa.away).toBeCloseTo(100, 10);
        expect(casa.home).toBeGreaterThan(casa.away);
    });

    test("si falta alguna cuota (o no es válida) no hay porcentajes", () => {
        expect(mercados.probabilidadesSinMargen({ cuota_home: 2, cuota_draw: null, cuota_away: 3 })).toBeNull();
        expect(mercados.probabilidadesSinMargen({ cuota_home: 2, cuota_draw: 0, cuota_away: 3 })).toBeNull();
        expect(mercados.probabilidadesSinMargen({})).toBeNull();
        expect(mercados.fmtPorcentaje(41.234)).toBe("41,2 %");
    });

    test("la ficha del partido enseña el porcentaje junto a cada cuota y el margen; sin cuotas se ve como antes", () => {
        const sin = { home_team: "A", away_team: "B", cuota_home: 1.9, cuota_draw: 3.5, cuota_away: 4.2 };
        const texto = embedPartido(sin).toJSON().description;
        expect(texto).toMatch(/\*\*A\*\*: cuota `1.9` · 5\d,\d %/);
        expect(texto).toMatch(/\*\*Empate\*\*: cuota `3.5` · \d\d,\d %/);
        expect(texto).toMatch(/📊 Margen de la casa: \*\*\d+,\d %\*\*/);
        const incompleto = embedPartido({ ...sin, cuota_draw: null }).toJSON().description;
        expect(incompleto).not.toMatch(/%/);
        expect(incompleto).toMatch(/\*\*Empate\*\*: cuota `null`\n/);
    });

    test("el partido destacado enseña lo mismo", () => {
        const base = {
            match_id: "x",
            home_team: "A",
            away_team: "B",
            start_time: futuro(5),
            deporte: "laliga",
            cuota_home: 2,
            cuota_draw: 4,
            cuota_away: 4,
        };
        const texto = mensajeDestacado(base).embeds[0].toJSON().description;
        expect(texto).toMatch(/cuota `2` · 50,0 %/);
        expect(texto).toMatch(/📊 Margen de la casa: \*\*0,0 %\*\*/);
        expect(mensajeDestacado({ ...base, cuota_draw: null }).embeds[0].toJSON().description).not.toMatch(/%/);
    });
});

describe("cuota apostada frente a la actual (#375)", () => {
    const pendiente = (userId, eleccion, cuotaApostada, extra) => {
        const p = partido(extra);
        apostar(userId, p.match_id, eleccion, 100, cuotaApostada);
        const [fila] = jugadas.partidosDe(userId, { pendientes: true });
        return fila;
    };
    const texto = (userId) =>
        buildMisJugadas(userId, "activas")
            .embeds[0].toJSON()
            .fields.find((f) => f.name.startsWith("⚽ Partidos")).value;

    test("sube, baja o sigue igual, con la flecha", () => {
        const sube = persona();
        pendiente(sube, "home", 1.8); // ahora 2
        expect(texto(sube)).toMatch(/apostado a 1\.8 · ahora 2 ↑ → 180/);
        const baja = persona();
        pendiente(baja, "draw", 5);
        expect(texto(baja)).toMatch(/apostado a 5 · ahora 4 ↓/);
        const igual = persona();
        pendiente(igual, "away", 4);
        expect(texto(igual)).toMatch(/apostado a 4 · ahora 4 =/);
    });

    test("también en los mercados de goles; el marcador exacto no tiene cuota actual", () => {
        const u = persona();
        const f = pendiente(u, "mas", 1.7, { cuota_mas: 1.9, cuota_menos: 1.9, total_linea: 2.5 });
        expect(jugadas.cuotaActual(f)).toBe(1.9);
        expect(texto(u)).toMatch(/apostado a 1\.7 · ahora 1\.9 ↑/);
        const v = persona();
        const exacto = pendiente(v, "exacto_2-1", 50);
        expect(jugadas.cuotaActual(exacto)).toBeNull();
        expect(texto(v)).toMatch(/@50 →/);
    });

    test("si el partido ya ha empezado, solo sale la cuota apostada", () => {
        const u = persona();
        pendiente(u, "home", 1.8, { start_time: new Date(Date.now() - HORA).toISOString() });
        expect(texto(u)).toMatch(/@1\.8 →/);
        expect(texto(u)).not.toMatch(/ahora/);
    });
});

describe("cancelar una combinada (#296)", () => {
    function combinada(userId, partidos, { cantidad = 200 } = {}) {
        const id = db
            .prepare("INSERT INTO combinadas (user_id, cantidad, cuota, estado, creada_en) VALUES (?, ?, 6, 'abierta', ?)")
            .run(userId, cantidad, new Date().toISOString()).lastInsertRowid;
        for (const p of partidos) {
            db.prepare(
                "INSERT INTO combinada_patas (combinada_id, match_id, eleccion, cuota, resultado) VALUES (?, ?, 'home', 2, 'pendiente')",
            ).run(id, p.match_id);
        }
        db.prepare("UPDATE banco SET enMano = enMano - ? WHERE userId = ?").run(cantidad, userId);
        return Number(id);
    }
    const estado = (id) => db.prepare("SELECT estado, premio FROM combinadas WHERE id = ?").get(id);

    test("antes del primer partido devuelve todo lo apostado, sin comisión, y queda como cancelada", () => {
        const u = persona(1000);
        const id = combinada(u, [partido(), partido({ start_time: futuro(48) })]);
        expect(dinero.efectivo(u)).toBe(800);
        expect(cancelarCombinada.cancelables(u).map((c) => c.id)).toEqual([id]);
        const r = cancelarCombinada.cancelar(u, id);
        expect(r).toMatchObject({ ok: true, devolucion: 200 });
        expect(r.mensaje).toMatch(/sin comisión/);
        expect(dinero.efectivo(u)).toBe(1000);
        expect(estado(id)).toEqual({ estado: "cancelada", premio: 200 });
        const mov = db.prepare("SELECT descripcion, cantidad FROM historial WHERE userId = ? ORDER BY rowid DESC LIMIT 1").get(u);
        expect(mov).toEqual({ descripcion: "Combinada cancelada de 2 partidos (sin comisión)", cantidad: 200 });
        expect(db.prepare("SELECT COUNT(*) AS n FROM combinada_patas WHERE combinada_id = ? AND resultado = 'cancelada'").get(id).n).toBe(
            2,
        );
    });

    test("no se puede dos veces, ni la de otra persona, ni si algún partido ha empezado o ya no está abierto", () => {
        const u = persona(1000);
        const empezado = partido({ start_time: new Date(Date.now() - 60_000).toISOString() });
        const id = combinada(u, [partido(), empezado]);
        expect(cancelarCombinada.cancelar(u, id).ok).toBe(false);
        expect(cancelarCombinada.cancelables(u)).toEqual([]);
        expect(estado(id).estado).toBe("abierta");

        const v = persona(1000);
        const cerrado = partido({ estado: "finalizado" });
        expect(cancelarCombinada.cancelar(v, combinada(v, [partido(), cerrado])).ok).toBe(false);

        const w = persona(1000);
        const ok = combinada(w, [partido(), partido()]);
        expect(cancelarCombinada.cancelar(persona(), ok).ok).toBe(false);
        expect(cancelarCombinada.cancelar(w, ok).ok).toBe(true);
        expect(cancelarCombinada.cancelar(w, ok).ok).toBe(false);
        expect(dinero.efectivo(w)).toBe(1000);
    });

    test("una cancelada no se liquida ni se reembolsa otra vez, y no cambia el beneficio de las estadísticas", () => {
        const u = persona(1000);
        const p1 = partido();
        const id = combinada(u, [p1, partido()]);
        cancelarCombinada.cancelar(u, id);
        expect(combinadas.resolverPartido(p1.match_id, "home", "1-0")).toEqual([]);
        expect(combinadas.caducarPartido(p1.match_id, () => {})).toBe(0);
        expect(dinero.efectivo(u)).toBe(1000);
        expect(jugadas.estadisticasCombinadas(u)).toMatchObject({ apostado: 200, ganado: 200, pendientes: 0, ganadas: 0, perdidas: 0 });
    });

    test("en Mis jugadas: sale en el menú de cancelar, se confirma y después aparece como cancelada en Resueltas", async () => {
        const u = persona(1000);
        const id = combinada(u, [partido(), partido()]);
        const panel = buildMisJugadas(u, "activas");
        const menu = panel.components.find((f) => f.components[0].data.custom_id === `misapuestas_cancelarsel_${u}`).components[0];
        expect(menu.options.map((o) => [o.data.value, o.data.label])).toEqual([[`c${id}`, "🧩 Combinada de 2 partidos"]]);

        const interaccion = (customId, extra = {}) => ({
            customId,
            user: { id: u },
            update: jest.fn(async () => {}),
            reply: jest.fn(async () => {}),
            values: [],
            ...extra,
        });
        const sel = interaccion(`misapuestas_cancelarsel_${u}`, { values: [`c${id}`] });
        await handleSelect(null, sel);
        const confirmar = sel.update.mock.calls[0][0];
        expect(confirmar.embeds[0].data.title).toBe("↩️ ¿Cancelar esta combinada?");
        expect(confirmar.embeds[0].data.description).toMatch(/Te devuelvo la apuesta \*\*entera\*\*/);
        const ok = interaccion(`misapuestas_cancelarokc_${id}_${u}`);
        await handleButton(null, ok);
        expect(ok.update.mock.calls[0][0].content).toMatch(/Combinada cancelada/);
        expect(dinero.efectivo(u)).toBe(1000);
        const resueltas = buildMisJugadas(u, "historial")
            .embeds[0].toJSON()
            .fields.find((f) => f.name.startsWith("🧩")).value;
        expect(resueltas).toMatch(/🚫 Cancelada \(devuelta entera\)/);
    });

    test("el botón de otra persona no cancela, y una combinada que ya empezó lo dice", async () => {
        const u = persona(1000);
        const id = combinada(u, [partido(), partido()]);
        const ajeno = {
            customId: `misapuestas_cancelarokc_${id}_${u}`,
            user: { id: "otro" },
            update: jest.fn(),
            reply: jest.fn(async () => {}),
        };
        await handleButton(null, ajeno);
        expect(ajeno.reply.mock.calls[0][0].content).toMatch(/Solo puedes ver tus propias apuestas/);
        expect(estado(id).estado).toBe("abierta");

        db.prepare(
            "UPDATE apuestas_partidos SET start_time = ? WHERE match_id IN (SELECT match_id FROM combinada_patas WHERE combinada_id = ?)",
        ).run(new Date(Date.now() - 1000).toISOString(), id);
        const sel = {
            customId: `misapuestas_cancelarsel_${u}`,
            user: { id: u },
            values: [`c${id}`],
            update: jest.fn(async () => {}),
            reply: jest.fn(),
        };
        await handleSelect(null, sel);
        expect(sel.update.mock.calls[0][0].content).toMatch(/Esa combinada ya no se puede cancelar/);
    });
});
