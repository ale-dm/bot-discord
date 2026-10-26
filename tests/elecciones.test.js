// 🗳️ Elecciones a la presidencia (reglas, sin Discord): ajustes del panel, inscripción y quién puede participar, votos
// secretos y públicos (uno por persona y fase, que se puede cambiar), el paso de cada fase (primarias con top 4 y desempate
// por inscripción, saltarse las primarias con pocos candidatos, cancelar sin candidatos o sin votos), programas y cancelar o
// destituir. BD en memoria.
const db = require("../src/core/db");
const guildSettings = require("../src/systems/guildSettings");
const { ajustes, fases, candidatos, votos, repo } = require("../src/systems/elecciones");

const G = "g-elecciones";
const DIA = ajustes.DIA_MS;
const AHORA = 1_800_000_000_000;
const VETERANO = { esBot: false, unidoEn: AHORA - 100 * DIA };

beforeEach(() => {
    for (const t of ["elecciones_votos", "elecciones_candidatos", "presidencia_acciones", "presidencia_canales", "presidencia_sanciones"]) {
        db.prepare(`DELETE FROM ${t}`).run();
    }
    db.prepare("DELETE FROM elecciones").run();
    db.prepare("DELETE FROM guild_settings WHERE guildId = ?").run(G);
    guildSettings.invalidarAjustes(G);
});

const abrir = (ahora = AHORA) => fases.abrir({ guildId: G, creadaPor: "admin", channelId: "c-elec", ahora }).eleccion;
const inscribir = (userId, persona = VETERANO, ahora = AHORA) => candidatos.inscribir({ guildId: G, userId, ...persona, ahora });
const votar = (votanteId, candidatoId, publico = false, ahora = AHORA + 1) =>
    votos.votar({ guildId: G, votanteId, candidatoId, publico, ...VETERANO, ahora });
/** Cierra la fase en curso con el reloj al final de la fase. */
const avanzar = () => {
    const e = repo.activa(G);
    return fases.avanzar(e, e.fase_fin);
};
/** Una elección ya en primarias con `n` candidatos (c1 se inscribe primero). */
function enPrimarias(n = 5) {
    abrir();
    for (let i = 1; i <= n; i++) expect(inscribir(`c${i}`, VETERANO, AHORA + i).ok).toBe(true);
    expect(avanzar().a).toBe("primarias");
    return repo.activa(G);
}

describe("ajustes", () => {
    test("las duraciones admiten decimales con coma y rechazan lo que se sale de 0,01 a 365 días", () => {
        const base = { inscripcion: "3", primarias: "30", programas: "0,5", generales: "7", mandato: "30" };
        expect(ajustes.validarDuraciones(base)).toMatchObject({ ok: true, valores: { dias_programas: 0.5 } });
        expect(ajustes.validarDuraciones({ ...base, mandato: "0" }).ok).toBe(false);
        expect(ajustes.validarDuraciones({ ...base, primarias: "366" }).ok).toBe(false);
        expect(ajustes.validarDuraciones({ ...base, generales: "siete" }).ok).toBe(false);
    });

    test("los límites tienen que ser enteros dentro de su rango", () => {
        const base = { antiguedad_dias: "7", max_canales: "3", max_sancion_min: "30", cooldown_min: "5" };
        expect(ajustes.validarLimites(base)).toEqual({
            ok: true,
            valores: { antiguedad_dias: 7, max_canales: 3, max_sancion_min: 30, cooldown_min: 5 },
        });
        expect(ajustes.validarLimites({ ...base, max_canales: "11" }).ok).toBe(false);
        expect(ajustes.validarLimites({ ...base, max_sancion_min: "1.5" }).ok).toBe(false);
    });

    test("cada fase dura lo que diga Config Global", () => {
        guildSettings.setSetting(G, "elecciones.dias_inscripcion", 0.5);
        const e = abrir();
        expect(e.fase_fin - e.fase_inicio).toBe(DIA / 2);
    });
});

describe("inscripción", () => {
    test("solo hay unas elecciones en marcha por servidor", () => {
        abrir();
        expect(fases.abrir({ guildId: G, creadaPor: "admin", ahora: AHORA }).ok).toBe(false);
    });

    test("los bots y quien lleva poco en el servidor no pueden presentarse", () => {
        abrir();
        expect(inscribir("bot", { esBot: true, unidoEn: AHORA - 100 * DIA }).mensaje).toMatch(/bots/);
        expect(inscribir("nuevo", { esBot: false, unidoEn: AHORA - DIA }).mensaje).toMatch(/7\*\* días/);
        guildSettings.setSetting(G, "elecciones.antiguedad_dias", 0);
        expect(inscribir("nuevo", { esBot: false, unidoEn: AHORA - DIA }).ok).toBe(true);
    });

    test("no se puede inscribir dos veces, pero sí volver tras retirarse", () => {
        abrir();
        expect(inscribir("ana").ok).toBe(true);
        expect(inscribir("ana").mensaje).toMatch(/Ya estás inscrito/);
        expect(candidatos.retirarse(G, "ana").ok).toBe(true);
        expect(repo.candidatos(repo.activa(G).id)).toHaveLength(0);
        expect(inscribir("ana")).toMatchObject({ ok: true, vuelve: true });
    });

    test("fuera de la inscripción no se admiten candidatos", () => {
        enPrimarias();
        expect(inscribir("tarde").mensaje).toMatch(/cerrada/);
    });

    test("sin reelección, el último presidente no puede volver a presentarse", () => {
        db.prepare(
            "INSERT INTO elecciones (guildId, estado, creada_por, creada_en, fase_inicio, fase_fin, presidenteId) VALUES (?, 'cerrada', 'a', 1, 1, 1, 'pres')",
        ).run(G);
        abrir();
        expect(inscribir("pres").ok).toBe(true);
        candidatos.retirarse(G, "pres");
        guildSettings.setSetting(G, "elecciones.reeleccion", false);
        expect(inscribir("pres").mensaje).toMatch(/no hay reelección/);
    });
});

describe("votos", () => {
    test("un voto por persona y fase: votar otra vez lo reemplaza, también si pasa de secreto a público", () => {
        const e = enPrimarias();
        expect(votar("v1", "c1")).toMatchObject({ ok: true, antes: null, publico: false });
        expect(votar("v1", "c2", true)).toMatchObject({ ok: true, antes: expect.objectContaining({ candidatoId: "c1" }), publico: true });
        expect(repo.totalVotos(e.id, "primarias")).toBe(1);
        expect(repo.votosPublicos(e.id, "primarias")).toEqual([expect.objectContaining({ votanteId: "v1", candidatoId: "c2" })]);
    });

    test("los votos secretos suman en el recuento pero no salen entre los públicos", () => {
        const e = enPrimarias();
        votar("v1", "c3");
        votar("v2", "c3", true);
        expect(repo.totalPublicos(e.id, "primarias")).toBe(1);
        expect(votos.clasificacion(e.id, "primarias")[0]).toMatchObject({ userId: "c3", votos: 2 });
    });

    test("no se puede votar a quien no está en la papeleta ni con la votación cerrada", () => {
        const e = enPrimarias();
        expect(votar("v1", "nadie").mensaje).toMatch(/papeleta/);
        candidatos.retirarse(G, "c1");
        expect(votar("v1", "c1").mensaje).toMatch(/papeleta/);
        expect(votar("v1", "c2", false, e.fase_fin).mensaje).toMatch(/cerrarse/);
    });

    test("los votos a quien se retira dejan de contar", () => {
        const e = enPrimarias();
        votar("v1", "c1");
        candidatos.retirarse(G, "c1");
        expect(votos.clasificacion(e.id, "primarias").find((c) => c.userId === "c1")).toBeUndefined();
    });
});

describe("fases", () => {
    test("con menos de 2 inscritos, la elección se cancela al cerrar la inscripción", () => {
        abrir();
        inscribir("solo");
        expect(avanzar()).toMatchObject({ a: "cancelada", motivo: expect.stringMatching(/menos de 2/) });
        expect(repo.activa(G)).toBeNull();
    });

    test("sin más candidatos que plazas no hay primarias: todos pasan a los programas", () => {
        abrir();
        ["a", "b", "c"].forEach((u) => inscribir(u));
        const r = avanzar();
        expect(r).toMatchObject({ a: "programas", sinPrimarias: true });
        expect(repo.candidatos(r.eleccion.id, { finalistas: true }).map((c) => c.userId)).toEqual(["a", "b", "c"]);
    });

    test("de las primarias pasan los 4 más votados y el empate lo gana quien se inscribió antes", () => {
        enPrimarias(6);
        votar("v1", "c6");
        votar("v2", "c6");
        votar("v3", "c5");
        votar("v4", "c4");
        // c4 y c5 empatan a 1 (va antes c4) y la última plaza se la disputan c1, c2 y c3 a 0: entra c1, el primero en inscribirse.
        const r = avanzar();
        expect(r.a).toBe("programas");
        expect(r.finalistas.map((c) => c.userId)).toEqual(["c6", "c4", "c5", "c1"]);
        expect(repo.candidatos(r.eleccion.id, { finalistas: true }).map((c) => c.userId)).toEqual(["c1", "c4", "c5", "c6"]);
    });

    test("en las generales solo se vota a los finalistas y el más votado es presidente", () => {
        enPrimarias(5);
        ["c1", "c2", "c3", "c4"].forEach((c, n) => votar(`v${n}`, c));
        avanzar(); // → programas
        expect(avanzar().a).toBe("generales");
        expect(votar("v1", "c5").mensaje).toMatch(/papeleta/);
        votar("v1", "c2", true);
        votar("v2", "c2");
        votar("v3", "c1");
        const r = avanzar();
        expect(r).toMatchObject({ a: "mandato", ganador: expect.objectContaining({ userId: "c2", votos: 2 }) });
        expect(repo.activa(G)).toMatchObject({ estado: "mandato", presidenteId: "c2" });
    });

    test("si nadie vota en las generales, se cancelan", () => {
        abrir();
        ["a", "b"].forEach((u) => inscribir(u));
        avanzar(); // → programas
        avanzar(); // → generales
        expect(avanzar()).toMatchObject({ a: "cancelada", motivo: expect.stringMatching(/Nadie ha votado/) });
    });

    test("al acabar el mandato la elección se cierra y se recuerda quién fue presidente", () => {
        abrir();
        ["a", "b"].forEach((u) => inscribir(u));
        avanzar();
        avanzar();
        votar("v", "b");
        avanzar();
        expect(avanzar()).toMatchObject({ a: "cerrada", presidenteId: "b" });
        expect(repo.ultimaConPresidente(G).presidenteId).toBe("b");
    });

    test("dos pasadas a la vez no avanzan dos fases", () => {
        abrir();
        ["a", "b"].forEach((u) => inscribir(u));
        const e = repo.activa(G);
        expect(fases.avanzar(e, e.fase_fin)).not.toBeNull();
        expect(fases.avanzar(e, e.fase_fin)).toBeNull();
        expect(repo.activa(G).estado).toBe("programas");
    });

    test("adelantar deja la fase vencida para que el cron la cierre ya", () => {
        abrir();
        fases.adelantar(G, AHORA + 5);
        expect(fases.vencidas(AHORA + 5).map((e) => e.guildId)).toContain(G);
    });

    test("cancelar en el mandato es destituir: la elección se cierra con el presidente apuntado", () => {
        abrir();
        ["a", "b"].forEach((u) => inscribir(u));
        avanzar();
        avanzar();
        votar("v", "a");
        avanzar();
        expect(fases.cancelar(G, "Destituido.", AHORA + 2)).toMatchObject({ ok: true, de: "mandato", presidenteId: "a" });
        expect(repo.obtener(repo.ultimaConPresidente(G).id)).toMatchObject({ estado: "cerrada", motivo_cierre: "Destituido." });
    });
});

describe("programas", () => {
    function enProgramas() {
        abrir();
        ["a", "b"].forEach((u) => inscribir(u));
        avanzar();
    }
    const guardar = (userId, titulo, texto, partido = `Partido ${userId}`, eslogan = "Por un servidor mejor") =>
        candidatos.guardarPrograma({ guildId: G, userId, partido, eslogan, titulo, texto, ahora: AHORA });

    test("el partido y el eslogan son obligatorios y se guardan limpios con el programa", () => {
        enProgramas();
        const texto = "Más canales de voz para todos.";
        expect(guardar("a", "Mi plan", texto, "x").mensaje).toMatch(/nombre del partido/);
        expect(guardar("a", "Mi plan", texto, "P".repeat(41)).mensaje).toMatch(/nombre del partido/);
        expect(guardar("a", "Mi plan", texto, "Los Verdes", "  ").mensaje).toMatch(/eslogan/);
        expect(guardar("a", "Mi plan", texto, "  Los   Verdes ", " Voz  para todos ").ok).toBe(true);
        expect(repo.candidato(repo.activa(G).id, "a")).toMatchObject({ partido: "Los Verdes", eslogan: "Voz para todos" });
    });

    test("dos candidatos no pueden tener el mismo partido, aunque cambien mayúsculas; uno sí puede corregir el suyo", () => {
        enProgramas();
        const texto = "Más canales de voz para todos.";
        expect(guardar("a", "Mi plan", texto, "Los Verdes").ok).toBe(true);
        expect(guardar("b", "Su plan", texto, "los verdes").mensaje).toMatch(/Ya hay otro candidato con el partido/);
        expect(guardar("a", "Mi plan 2", texto, "Los Verdes").ok).toBe(true);
        expect(guardar("b", "Su plan", texto, "Los Azules").ok).toBe(true);
    });

    test("solo los finalistas entregan programa, con título y texto de la longitud debida", () => {
        enProgramas();
        expect(guardar("otro", "Mi plan", "x".repeat(30)).mensaje).toMatch(/finalistas/);
        expect(guardar("a", "x", "x".repeat(30)).mensaje).toMatch(/título/);
        expect(guardar("a", "Mi plan", "corto").mensaje).toMatch(/programa va de/);
        expect(guardar("a", "  Mi   plan ", "Más canales de voz para todos.")).toMatchObject({ ok: true, corregido: false });
        expect(guardar("a", "Mi plan 2", "Más canales de voz para todos.")).toMatchObject({ ok: true, corregido: true });
        expect(repo.candidato(repo.activa(G).id, "a").programa_titulo).toBe("Mi plan 2");
    });

    test("fuera de la fase de programas no se puede entregar", () => {
        abrir();
        inscribir("a");
        expect(guardar("a", "Mi plan", "x".repeat(30)).mensaje).toMatch(/fase de programas/);
    });
});
