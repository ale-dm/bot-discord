// Cabos sueltos (revisión del 2026-10-08): /ayuda nombra /plex, /sonidos, /conectar y /pase; un logro completado da XP de
// pase (los de la importación de Plex, no); Mis jugadas y Stats cuentan las combinadas; y ⚽ Apuestas del panel admin
// edita los premios de la liga.
const db = require("../src/core/db");
const pase = require("../src/systems/pase/pase");
const achievements = require("../src/systems/achievementsSystem");
const guildSettings = require("../src/systems/guildSettings");
const jugadas = require("../src/systems/apuestas/misJugadas");
const { camposStatsApuestas } = require("../src/paneles/misJugadas");
const { SECCIONES } = require("../src/commands/general/ayuda").__test;
const { buildApuestasHome, handleApuestasButton, handleApuestasModal } = require("../src/adminPanel/apuestas");

const G = "g-cabos-sueltos";
let n = 0;

test("/ayuda nombra /plex, /sonidos, /conectar y /pase", () => {
    const texto = JSON.stringify(SECCIONES);
    for (const cmd of ["/plex", "/sonidos", "/conectar", "/pase"]) expect(texto).toContain(cmd);
});

describe("logros y pase de batalla", () => {
    test("cada logro completado da XP de pase", async () => {
        const u = `logro-${++n}`;
        const desbloqueados = await achievements.applyEvent(G, u, "casino_bet", 50, { anunciar: false });
        expect(desbloqueados.length).toBeGreaterThan(0);
        const esperado = Math.min(pase.CATEGORIAS.logro.tope, pase.CATEGORIAS.logro.xp * desbloqueados.length);
        expect(pase.estado(G, u).xp).toBe(esperado);
    });

    test("los logros que salen al importar el historial de Plex no dan XP de pase", async () => {
        const u = `logro-importado-${++n}`;
        const desbloqueados = await achievements.applyEvents(G, u, [{ event: "casino_bet", value: 50 }], {
            anunciar: false,
            importado: true,
        });
        expect(desbloqueados.length).toBeGreaterThan(0);
        expect(pase.estado(G, u).xp).toBe(0);
    });
});

describe("combinadas en Mis jugadas y Stats", () => {
    function partido() {
        const id = `cabos-p-${++n}`;
        db.prepare(
            `INSERT INTO apuestas_partidos (match_id, deporte, home_team, away_team, start_time, estado, cuota_home, cuota_draw, cuota_away,
                cuota_mas, cuota_menos, total_linea, cuota_casa, cuota_fuera, hcap_linea)
             VALUES (?, 'laliga', ?, ?, ?, 'abierto', 2.0, 3.0, 4.0, 1.9, 1.95, 2.5, 2.3, 1.6, -1.5)`,
        ).run(id, `Local ${id}`, `Visitante ${id}`, "2099-01-01T20:00:00.000Z");
        return id;
    }

    function combinada(userId, { cantidad = 100, cuota = 6, estado = "abierta", premio = null, partidos = [] }) {
        const { lastInsertRowid } = db
            .prepare("INSERT INTO combinadas (user_id, cantidad, cuota, estado, premio, creada_en) VALUES (?, ?, ?, ?, ?, ?)")
            .run(userId, cantidad, cuota, estado, premio, new Date().toISOString());
        for (const matchId of partidos) {
            db.prepare(
                "INSERT INTO combinada_patas (combinada_id, match_id, eleccion, cuota, linea, resultado) VALUES (?, ?, 'home', 2, NULL, 'pendiente')",
            ).run(lastInsertRowid, matchId);
        }
        return lastInsertRowid;
    }

    test("las abiertas salen con sus partidos y las cerradas en el historial, y Stats las suma", () => {
        const u = `comb-${++n}`;
        const p1 = partido();
        const p2 = partido();
        combinada(u, { estado: "abierta", partidos: [p1, p2] });
        combinada(u, { estado: "ganada", premio: 600, partidos: [p1, p2] });
        combinada(u, { estado: "perdida", premio: 0, partidos: [p1, p2] });

        expect(jugadas.estadisticasCombinadas(u)).toEqual({
            total: 3,
            ganadas: 1,
            perdidas: 1,
            pendientes: 1,
            apostado: 200,
            ganado: 600,
            enJuego: 100,
        });

        const abiertas = jugadas.combinadasDe(u);
        expect(abiertas).toHaveLength(1);
        expect(abiertas[0].patas.map((p) => p.home_team)).toEqual([`Local ${p1}`, `Local ${p2}`]);
        expect(jugadas.combinadasDe(u, { abiertas: false })).toHaveLength(2);

        const { campos, beneficio } = camposStatsApuestas(u);
        expect(campos.map((c) => c.name)).toContain("🧩 Combinadas");
        expect(beneficio).toBe(400);
    });
});

describe("premios de la liga en ⚽ Apuestas del panel admin", () => {
    test("el botón abre el modal y el modal guarda los tres premios", async () => {
        const botones = buildApuestasHome(G).components.flatMap((fila) => fila.components.map((b) => b.data.custom_id));
        expect(botones).toContain("paneladmin_apu_premios");

        const showModal = jest.fn(async () => {});
        await handleApuestasButton({ customId: "paneladmin_apu_premios", guildId: G, user: { id: "admin" }, showModal });
        expect(showModal).toHaveBeenCalledTimes(1);

        const valores = { p1: "1500", p2: "700", p3: "0" };
        const reply = jest.fn(async () => {});
        await handleApuestasModal({
            customId: "paneladmin_apu_premios_modal",
            guildId: G,
            user: { id: "admin" },
            fields: { getTextInputValue: (id) => valores[id] },
            isFromMessage: () => false,
            reply,
        });
        expect(guildSettings.getSettings(G).liga).toEqual({ premio_1: 1500, premio_2: 700, premio_3: 0 });
        expect(reply).toHaveBeenCalledTimes(1);
    });

    test("un premio que no es un entero no se guarda", async () => {
        const reply = jest.fn(async () => {});
        await handleApuestasModal({
            customId: "paneladmin_apu_premios_modal",
            guildId: G,
            user: { id: "admin" },
            fields: { getTextInputValue: (id) => (id === "p2" ? "mucho" : "100") },
            isFromMessage: () => false,
            reply,
        });
        expect(guildSettings.getSettings(G).liga.premio_1).toBe(1500);
        expect(reply.mock.calls[0][0].content).toMatch(/números enteros/);
    });
});
