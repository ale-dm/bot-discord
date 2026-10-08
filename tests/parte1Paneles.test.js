// Parte 1 del plan de paneles (docs/planificacion/diseno/reorganizacion-paneles.md): economía del perfil
// (E-05, E-12), reclamar logros con un menú (E-07) y estadísticas de /misapuestas (E-09, E-10).
const db = require("../src/core/db");
const achievements = require("../src/systems/achievementsSystem");
const economia = require("../src/paneles/economia");
const perfil = require("../src/commands/progresion/perfil");
const juegos = require("../src/commands/juegos/juegos");

const G = "guild-parte1";
const guild = { id: G, members: { cache: new Map() } };
const campo = (embed, nombre) => embed.data.fields.find((f) => f.name.includes(nombre))?.value;

describe("economía del perfil", () => {
    beforeAll(() => {
        db.prepare("INSERT INTO banco (userId, saldo, enMano) VALUES ('eco', 0, 5000)").run();
        const hist = db.prepare("INSERT INTO historial (userId, fecha, descripcion, cantidad) VALUES ('eco', ?, ?, ?)");
        hist.run("2026-09-01", "Depósito", 3000); // no es casino
        hist.run("2026-09-02", "Compra en tienda: Espada", -700); // tampoco
        const partida = db.prepare(
            "INSERT INTO casino (userId, juego, fecha, apuesta, resultado, detalle) VALUES ('eco', 'ruleta', ?, 100, ?, '{}')",
        );
        partida.run("2026-09-03", 150);
        partida.run("2026-09-04", -100);
        db.prepare("INSERT INTO cripto_carteras (userId, cripto, cantidad) VALUES ('eco', 'TTCL', 2)").run();
    });

    test("ganado y perdido salen solo del casino (E-05)", async () => {
        // Desde la parte 6, en /perfil → 💰 Economía.
        const embed = (await economia.buildEconomia({ viewerId: "eco", nombre: "eco", guildId: guild.id })).embeds[0];
        expect(campo(embed, "Ganado en casino")).toBe("+150");
        expect(campo(embed, "Perdido en casino")).toBe("-100");
    });

    test("la cartera valora TTCL al precio del pool (E-12)", async () => {
        const cartera = campo(
            (await economia.buildEconomia({ viewerId: "eco", nombre: "eco", guildId: guild.id })).embeds[0],
            "Cartera cripto",
        );
        expect(cartera).toMatch(/2\.0000 TTCL\*\* ≈ 200 🪙/); // 2 TTCL × 100 del pool inicial
        expect(cartera).toMatch(/Total ≈ \*\*200\*\*/);
    });
});

describe("reclamar logros con un menú (E-07)", () => {
    const [primero, segundo] = achievements.getCatalog(G);
    beforeAll(() => {
        const completar = db.prepare(
            "INSERT INTO achievements_progress (guildId, userId, achievementId, progress, completedAt) VALUES (?, 'logrero', ?, 1, 1)",
        );
        completar.run(G, primero.id);
        completar.run(G, segundo.id);
        db.prepare("INSERT INTO banco (userId, saldo, enMano) VALUES ('logrero', 0, 0)").run();
    });
    const interaccion = (extra) => ({
        guildId: G,
        guild: { id: G },
        user: { id: "logrero", username: "logrero" },
        message: { embeds: [{}], components: [], interaction: { user: { id: "logrero" } } },
        reply: jest.fn(async () => {}),
        update: jest.fn(async () => {}),
        ...extra,
    });

    test("el panel trae un menú con los logros pendientes, y al elegir uno se cobra", async () => {
        // Desde la parte 6, en /perfil → 🏅 Logros.
        const ver = interaccion({ options: { getUser: () => null, getString: () => "logros" } });
        await perfil.run(null, ver);
        const menu = ver.reply.mock.calls[0][0].components[1].components[0];
        expect(menu.data.custom_id).toBe("perfil_reclamar_logrero_logrero");
        expect(menu.options.map((o) => o.data.value)).toEqual([primero.id, segundo.id]);

        const elegir = interaccion({ customId: "perfil_reclamar_logrero_logrero", values: [primero.id] });
        await perfil.handleSelect(null, elegir);
        expect(elegir.update.mock.calls[0][0].content).toMatch(/Reclamaste/);
        const reward = achievements.rewardCoinsFor(primero, G);
        const impuesto = Math.floor(reward * 0.05); // 5% de impuesto por defecto sobre los logros
        expect(db.prepare("SELECT enMano AS saldo FROM banco WHERE userId = 'logrero'").get().saldo).toBe(reward - impuesto);
        // Ya solo queda el segundo en el menú.
        const quedan = elegir.update.mock.calls[0][0].components[1].components[0].options.map((o) => o.data.value);
        expect(quedan).toEqual([segundo.id]);
    });

    test("el menú antiguo (logros_reclamar, de mensajes de antes) sigue reclamando", async () => {
        const i = interaccion({ customId: "logros_reclamar", values: [segundo.id] });
        await perfil.handleSelect(null, i);
        expect(i.update.mock.calls[0][0].content).toMatch(/Reclamaste/);
    });
});

test("las estadísticas de apuestas no cuentan las pendientes como perdidas (E-09, E-10)", async () => {
    const partido = db.prepare(
        "INSERT INTO apuestas_partidos (match_id, home_team, away_team, start_time, estado) VALUES (?, 'L', 'V', '2026-09-01', ?)",
    );
    partido.run("fin-1", "finalizado");
    partido.run("abierto-1", "abierto");
    const apuesta = db.prepare(
        "INSERT INTO apuestas_usuario (user_id, match_id, eleccion, cantidad, cuota, pagado, premio) VALUES ('apostador', ?, 'home', ?, 2, ?, ?)",
    );
    apuesta.run("fin-1", 100, 1, 200); // ganada: +100
    apuesta.run("abierto-1", 500, 0, null); // pendiente

    // Desde la parte 4, en /juegos → 📊 Stats (junto con las del casino).
    const i = { user: { id: "apostador", username: "apostador" }, options: { getString: () => "stats" }, reply: jest.fn(async () => {}) };
    await juegos.run(null, i);
    const embed = i.reply.mock.calls[0][0].embeds[0];
    expect(embed.data.title).toBe("📊 Estadísticas de apostador");
    const partidos = campo(embed, "Apuestas a partidos");
    expect(partidos).toMatch(/\*\*100\*\* apostado en las resueltas → \*\*200\*\* cobrado \(\+100\)/);
    expect(partidos).toMatch(/\*\*500\*\* en juego/);
});
