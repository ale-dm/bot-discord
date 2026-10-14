// ⚽ Apuestas, fase 4 (2): repetir la última apuesta (#349) y exportar las apuestas a CSV (#356). BD en memoria.
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const guildSettings = require("../src/systems/guildSettings");
const jugadas = require("../src/systems/apuestas/misJugadas");
const exportar = require("../src/systems/apuestas/exportar");
const repetir = require("../src/juegos/apuestas/repetir");
const exportarBoton = require("../src/juegos/apuestas/exportar");
const { buildMisJugadas } = require("../src/paneles/misJugadas");

const HORA = 3600_000;
const futuro = (h) => new Date(Date.now() + h * HORA).toISOString();
const G = "g-repetir";
let n = 0;
const persona = (efectivo = 5000) => {
    const id = `rep-${++n}`;
    dinero.asegurarCuenta(id);
    db.prepare("UPDATE banco SET enMano = ? WHERE userId = ?").run(efectivo, id);
    return id;
};
function partido(extra = {}) {
    const p = {
        match_id: `rep-m${++n}`,
        home_team: "Betis",
        away_team: "Sevilla",
        start_time: futuro(24),
        estado: "abierto",
        deporte: "laliga",
        cuota_home: 2,
        cuota_draw: 3,
        cuota_away: 4,
        cuota_mas: null,
        cuota_menos: null,
        total_linea: null,
        ...extra,
    };
    db.prepare(
        `INSERT INTO apuestas_partidos (match_id, home_team, away_team, start_time, estado, deporte, cuota_home, cuota_draw, cuota_away, cuota_mas, cuota_menos, total_linea, resultado)
         VALUES (@match_id, @home_team, @away_team, @start_time, @estado, @deporte, @cuota_home, @cuota_draw, @cuota_away, @cuota_mas, @cuota_menos, @total_linea, @resultado)`,
    ).run({ resultado: null, ...p });
    return p;
}
const apuesta = (userId, matchId, eleccion, cantidad, cuota, extra = {}) =>
    db
        .prepare(
            "INSERT INTO apuestas_usuario (user_id, match_id, eleccion, cantidad, cuota, pagado, premio, linea) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(userId, matchId, eleccion, cantidad, cuota, extra.pagado ?? 0, extra.premio ?? null, extra.linea ?? null);

beforeEach(() => {
    guildSettings.setManySettings(G, { "apuestas.tope_diario": 0, "apuestas.max_partido": 0 });
});

const interaccion = (customId, userId, extra = {}) => ({
    customId,
    guildId: G,
    user: { id: userId, tag: `${userId}#1` },
    values: [],
    update: jest.fn(async () => {}),
    reply: jest.fn(async () => {}),
    ...extra,
});
const ids = (payload) => payload.components.flatMap((f) => f.components.map((c) => c.data.custom_id));

describe("repetir la última apuesta (#349)", () => {
    test("el botón está en Mis jugadas, y sin apuestas dice que no hay nada que repetir", async () => {
        const u = persona();
        expect(ids(buildMisJugadas(u, "activas"))).toEqual(
            expect.arrayContaining([`misapuestas_repetir_${u}`, `misapuestas_exportar_${u}`]),
        );
        const i = interaccion(`misapuestas_repetir_${u}`, u);
        await repetir.handleButton(null, i);
        expect(i.update.mock.calls[0][0].content).toBe("🔁 Todavía no tienes ninguna apuesta a un partido que repetir.");
    });

    test("propone los partidos abiertos con esa elección y cuota actual, sin el partido ya apostado ni los empezados", async () => {
        const u = persona();
        const viejo = partido();
        apuesta(u, viejo.match_id, "away", 100, 3.5);
        const libre = partido({ cuota_away: 5 });
        const sinCuota = partido({ cuota_away: null });
        const empezado = partido({ start_time: new Date(Date.now() - 60_000).toISOString() });
        const i = interaccion(`misapuestas_repetir_${u}`, u);
        await repetir.handleButton(null, i);
        const menu = i.update.mock.calls[0][0].components[0].components[0];
        expect(menu.data.custom_id).toBe(`misapuestas_repetirsel_${u}`);
        const valores = menu.options.map((o) => o.data.value);
        expect(valores).toContain(libre.match_id);
        for (const fuera of [viejo, sinCuota, empezado]) expect(valores).not.toContain(fuera.match_id);
        const opcion = menu.options.find((o) => o.data.value === libre.match_id).data;
        expect(opcion.description).toMatch(/Sevilla · cuota 5$/);
    });

    test("elegir el partido enseña la confirmación con la elección y el importe de la última, a la cuota de ahora, sin cobrar", async () => {
        const u = persona(1000);
        apuesta(u, partido().match_id, "home", 150, 1.5);
        const nuevo = partido({ cuota_home: 2.4 });
        const sel = interaccion(`misapuestas_repetirsel_${u}`, u, { values: [nuevo.match_id] });
        await repetir.handleSelect(null, sel);
        const pantalla = sel.update.mock.calls[0][0];
        expect(pantalla.embeds[0].data.title).toBe("🔁 ¿Repetir la apuesta?");
        expect(pantalla.embeds[0].data.description).toMatch(/Betis · \*\*150\*\* 🪙 @2.4/);
        expect(pantalla.embeds[0].data.description).toMatch(/cobras \*\*360\*\*/);
        expect(ids(pantalla)).toEqual([`misapuestas_repetirok_${u}_${nuevo.match_id}`, `misapuestas_repetir_${u}`]);
        expect(dinero.efectivo(u)).toBe(1000);
        expect(db.prepare("SELECT COUNT(*) AS n FROM apuestas_usuario WHERE user_id = ? AND match_id = ?").get(u, nuevo.match_id).n).toBe(
            0,
        );
    });

    test("confirmar cobra y registra la apuesta con la cuota y la línea actuales", async () => {
        const u = persona(1000);
        apuesta(u, partido().match_id, "mas", 100, 1.7, { linea: 2.5 });
        const nuevo = partido({ cuota_mas: 1.95, cuota_menos: 1.85, total_linea: 3.5 });
        const ok = interaccion(`misapuestas_repetirok_${u}_${nuevo.match_id}`, u);
        await repetir.handleButton(null, ok);
        const fila = db
            .prepare("SELECT eleccion, cantidad, cuota, linea FROM apuestas_usuario WHERE user_id = ? AND match_id = ?")
            .get(u, nuevo.match_id);
        expect(fila).toEqual({ eleccion: "mas", cantidad: 100, cuota: 1.95, linea: 3.5 });
        expect(dinero.efectivo(u)).toBe(900);
        const respuesta = ok.update.mock.calls[0][0];
        expect(respuesta.embeds[0].data.title).toBe("✅ ¡Apuesta registrada!");
        expect(respuesta.embeds[0].data.description).toMatch(/Más de 3,5 goles/);
        // Ya la tiene: repetir otra vez en el mismo partido avisa y no cobra.
        const otra = interaccion(`misapuestas_repetirok_${u}_${nuevo.match_id}`, u);
        await repetir.handleButton(null, otra);
        expect(otra.reply.mock.calls[0][0].embeds[0].data.title).toBe("❌ Ya has apostado");
        expect(dinero.efectivo(u)).toBe(900);
    });

    test("si el partido ya empezó, o no hay efectivo, avisa en privado y no cobra", async () => {
        const u = persona(1000);
        apuesta(u, partido().match_id, "home", 100, 1.5);
        const empezado = partido({ start_time: new Date(Date.now() - 60_000).toISOString() });
        const i = interaccion(`misapuestas_repetirok_${u}_${empezado.match_id}`, u);
        await repetir.handleButton(null, i);
        expect(i.reply.mock.calls[0][0].embeds[0].data.title).toBe("⏱️ Apuestas cerradas");

        const pobre = persona(20);
        apuesta(pobre, partido().match_id, "home", 100, 1.5);
        const nuevo = partido();
        const sin = interaccion(`misapuestas_repetirok_${pobre}_${nuevo.match_id}`, pobre);
        await repetir.handleButton(null, sin);
        expect(sin.reply.mock.calls[0][0].embeds[0].data.title).toBe("❌ No te llega el efectivo");
        expect(dinero.efectivo(pobre)).toBe(20);
    });

    test("respeta el tope diario con el mismo mensaje que una apuesta normal", async () => {
        guildSettings.setSetting(G, "apuestas.tope_diario", 100);
        const u = persona(1000);
        apuesta(u, partido().match_id, "home", 150, 1.5);
        db.prepare("INSERT INTO historial (userId, fecha, descripcion, cantidad, tipo) VALUES (?, ?, 'x', -90, 'apuestas')").run(
            u,
            new Date().toISOString(),
        );
        const nuevo = partido();
        const i = interaccion(`misapuestas_repetirok_${u}_${nuevo.match_id}`, u);
        await repetir.handleButton(null, i);
        const aviso = i.reply.mock.calls[0][0].embeds[0].data;
        expect(aviso.title).toBe("🚦 Límite de apuestas");
        expect(aviso.description).toMatch(/tope diario es de \*\*100\*\*/);
        expect(dinero.efectivo(u)).toBe(1000);
    });

    test("solo quien abrió Mis jugadas, y un partido que ya no vale vuelve a Mis jugadas con un aviso", async () => {
        const u = persona(1000);
        apuesta(u, partido().match_id, "home", 100, 1.5);
        const ajeno = interaccion(`misapuestas_repetir_${u}`, "otro");
        await repetir.handleButton(null, ajeno);
        expect(ajeno.reply.mock.calls[0][0].content).toMatch(/Solo puedes repetir tus propias apuestas/);
        const sinCuota = partido({ cuota_home: null });
        const sel = interaccion(`misapuestas_repetirsel_${u}`, u, { values: [sinCuota.match_id] });
        await repetir.handleSelect(null, sel);
        expect(sel.update.mock.calls[0][0].content).toMatch(/Ese partido ya no está disponible/);
        expect(jugadas.ultimaApuestaAPartido("nadie")).toBeNull();
    });
});

describe("exportar a CSV (#356)", () => {
    const filas = (csv) => csv.trim().split("\n");

    test("sin apuestas, solo la cabecera", () => {
        const { csv, total } = exportar.csvDeApuestas(persona());
        expect(total).toBe(0);
        expect(csv).toBe(`${exportar.CABECERA.join(",")}\n`);
    });

    test("lleva partidos (en juego, ganados, perdidos y devueltos), combinadas y quinielas con su estado y su premio o devolución", () => {
        const u = persona();
        const pendiente = partido();
        const ganado = partido({ estado: "finalizado", resultado: "home" });
        const perdido = partido({ estado: "finalizado", resultado: "away" });
        const devuelto = partido({ estado: "caducado" });
        apuesta(u, pendiente.match_id, "home", 100, 2);
        apuesta(u, ganado.match_id, "home", 100, 2, { pagado: 1, premio: 200 });
        apuesta(u, perdido.match_id, "draw", 50, 3, { pagado: 1, premio: 0 });
        apuesta(u, devuelto.match_id, "away", 70, 4, { pagado: 1, premio: 0 });
        const c = db
            .prepare("INSERT INTO combinadas (user_id, cantidad, cuota, estado, premio, creada_en) VALUES (?, 40, 6, 'ganada', 240, ?)")
            .run(u, "2026-10-01T10:00:00.000Z").lastInsertRowid;
        db.prepare(
            "INSERT INTO combinada_patas (combinada_id, match_id, eleccion, cuota, resultado) VALUES (?, ?, 'home', 2, 'acierta')",
        ).run(c, ganado.match_id);
        const q = db
            .prepare(
                "INSERT INTO quinielas (deporte, jornada, estado, creada_en, cerrada_en) VALUES ('laliga', 'Jornada 7', 'cerrada', '2026-10-01', '2026-10-05')",
            )
            .run().lastInsertRowid;
        db.prepare(
            "INSERT INTO quiniela_apuestas (quiniela_id, user_id, predicciones, cantidad, premio, pagado, creada_en) VALUES (?, ?, '1X2', 30, 90, 1, '2026-10-02T10:00:00.000Z')",
        ).run(q, u);

        const { csv, total } = exportar.csvDeApuestas(u);
        expect(total).toBe(6);
        const lineas = filas(csv).slice(1);
        const porTipo = (tipo) => lineas.filter((l) => l.startsWith(`${tipo},`));
        expect(porTipo("partido")).toHaveLength(4);
        expect(lineas.find((l) => l.includes(",pendiente,"))).toMatch(/^partido,.*,Betis,100,2,pendiente,$/);
        expect(porTipo("partido").some((l) => /,100,2,ganada,200$/.test(l))).toBe(true);
        expect(porTipo("partido").some((l) => /,50,3,perdida,0$/.test(l))).toBe(true);
        expect(porTipo("partido").some((l) => /,70,4,devuelta,70$/.test(l))).toBe(true);
        expect(porTipo("combinada")[0]).toMatch(/^combinada,2026-10-01T10:00:00.000Z,1 partido: Betis vs Sevilla: Betis,,40,6,ganada,240$/);
        expect(porTipo("quiniela")[0]).toBe("quiniela,2026-10-02T10:00:00.000Z,Jornada 7,1X2,30,,ganada,90");
    });

    test("solo lleva las apuestas de quien lo pide, y las cifras cuadran con 📊 Stats", () => {
        const u = persona();
        const otra = persona();
        const p1 = partido({ estado: "finalizado", resultado: "home" });
        const p2 = partido({ estado: "finalizado", resultado: "away" });
        apuesta(u, p1.match_id, "home", 100, 2, { pagado: 1, premio: 200 });
        apuesta(u, p2.match_id, "home", 60, 2, { pagado: 1, premio: 0 });
        apuesta(otra, p1.match_id, "home", 999, 2, { pagado: 1, premio: 1998 });
        const { csv } = exportar.csvDeApuestas(u);
        expect(csv).not.toMatch(/999/);
        const resueltas = exportar.filasDe(u).filter((f) => f[6] === "ganada" || f[6] === "perdida");
        const beneficio = resueltas.reduce((s, f) => s + Number(f[7]) - Number(f[4]), 0);
        const { partidos } = jugadas.estadisticas(u);
        expect(beneficio).toBe(partidos.ganado - partidos.apostado);
        expect(beneficio).toBe(40);
    });

    test("las celdas con comas, comillas o que parecen fórmulas se escapan", () => {
        expect(exportar.celda('a,"b"')).toBe('"a,""b"""');
        expect(exportar.celda("simple")).toBe("simple");
        expect(exportar.textoSeguro("=SUMA(A1)")).toBe("'=SUMA(A1)");
        expect(exportar.textoSeguro("@x")).toBe("'@x");
        expect(exportar.textoSeguro("Real Madrid")).toBe("Real Madrid");
        const u = persona();
        const raro = partido({ home_team: '=Evil,"FC"', away_team: "Otro" });
        apuesta(u, raro.match_id, "home", 10, 2);
        expect(exportar.csvDeApuestas(u).csv).toContain(`"'=Evil,""FC"" vs Otro"`);
    });

    test("el botón envía el fichero en privado, solo a quien lo pide, y avisa si no hay apuestas", async () => {
        const u = persona();
        apuesta(u, partido().match_id, "home", 10, 2);
        const i = interaccion(`misapuestas_exportar_${u}`, u);
        await exportarBoton.handleButton(null, i);
        const r = i.reply.mock.calls[0][0];
        expect(r.flags).toBe(64);
        expect(r.content).toBe("📤 Aquí tienes tus **1** apuestas en CSV.");
        expect(r.files[0].name).toBe("mis-apuestas.csv");
        const contenido = r.files[0].attachment.toString("utf8");
        expect(contenido.charCodeAt(0)).toBe(0xfeff); // el BOM, para que Excel lea las tildes
        expect(contenido.slice(1)).toMatch(/^tipo,fecha,/);

        const ajeno = interaccion(`misapuestas_exportar_${u}`, "otro");
        await exportarBoton.handleButton(null, ajeno);
        expect(ajeno.reply.mock.calls[0][0].content).toMatch(/Solo puedes exportar tus propias apuestas/);
        expect(ajeno.reply.mock.calls[0][0].files).toBeUndefined();

        const vacio = persona();
        const v = interaccion(`misapuestas_exportar_${vacio}`, vacio);
        await exportarBoton.handleButton(null, v);
        expect(v.reply.mock.calls[0][0].content).toMatch(/solo con la cabecera/);
    });
});
