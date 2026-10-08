// 🎞️ Plex Wrapped mensual (#23): el mes anterior en hora de Madrid, las horas por persona, las series más vistas, quién es
// el más viciado, la publicación en el canal del ranking una vez por mes, y que el día 1 solo sale después de las 10:00.
const db = require("../src/core/db");
const guildSettings = require("../src/systems/guildSettings");
const plexLinks = require("../src/systems/plexLinks");
const wrapped = require("../src/systems/plexWrapped");

const CANAL = "874776941000020099";
let n = 0;
let filaId = 1000;
const nuevoGuild = () => `guild-wrapped-${++n}`;
const unix = (ms) => Math.floor(ms / 1000);
// Hora de Madrid en septiembre (UTC+2) y en octubre de 2026 (UTC+2 hasta el 25).
const madrid = (mes, dia, hora) => Date.UTC(2026, mes - 1, dia, hora - 2);

function canalDe() {
    return { id: CANAL, name: "ranking", isTextBased: () => true, send: jest.fn(async () => {}) };
}
function guildCon(g, canal) {
    return { id: g, name: g, channels: { cache: new Map([[canal.id, canal]]), fetch: async () => null } };
}
function ver(g, user, inicio, segundos, extra = {}) {
    db.prepare(
        `INSERT INTO plex_reproducciones (guildId, id, tautulliUserId, tipo, rating_key, serie, titulo, inicio, segundos, visto)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
        g,
        filaId++,
        String(user),
        extra.tipo || "episode",
        extra.rating_key ?? `r${filaId}`,
        extra.serie ?? null,
        extra.titulo ?? "t",
        unix(inicio),
        segundos,
        extra.visto ?? 1,
    );
}
function preparar(g) {
    plexLinks.setLink(g, "disc-ana", "1", "Ana");
    plexLinks.setLink(g, "disc-luis", "2", "Luis");
    guildSettings.setSetting(g, "plex.ranking_canal", CANAL);
}

test("el mes anterior, en hora de Madrid, con el cambio de año", () => {
    expect(wrapped.mesAnterior(madrid(10, 1, 11))).toEqual({
        mes: "2026-09",
        inicio: "2026-09-01",
        fin: "2026-09-30",
        etiqueta: "septiembre de 2026",
    });
    expect(wrapped.mesAnterior(Date.UTC(2027, 0, 1, 11)).mes).toBe("2026-12");
});

test("cuenta las horas de cada persona en el mes, las series más vistas y quién es el más viciado", () => {
    const g = nuevoGuild();
    preparar(g);
    // Septiembre: Ana 3 h (Severance 2 h + una peli 1 h); Luis 1 h (Severance). Agosto no cuenta.
    ver(g, 1, madrid(9, 5, 21), 2 * 3600, { serie: "Severance", titulo: "Ep 1" });
    ver(g, 1, madrid(9, 20, 22), 3600, { tipo: "movie", titulo: "Dune" });
    ver(g, 2, madrid(9, 30, 23), 3600, { serie: "Severance", titulo: "Ep 2" });
    ver(g, 2, madrid(8, 31, 23), 10 * 3600, { serie: "Shogun", titulo: "Ep 9" });

    const d = wrapped.datos(g, wrapped.mesAnterior(madrid(10, 1, 11)));
    expect(d.horas).toBe(4);
    expect(d.personas.map((p) => [p.plexUsername, p.horas])).toEqual([
        ["Ana", 3],
        ["Luis", 1],
    ]);
    expect(d.masViciado.plexUsername).toBe("Ana");
    expect(d.series).toEqual([{ nombre: "Severance", horas: 3 }]);
    expect(d.peliculas).toBe(1);
    expect(d.episodios).toBe(2); // Ana: Ep 1 · Luis: Ep 2 (Shogun es de agosto)
});

test("el mensaje menciona al más viciado y la gráfica sale como PNG", () => {
    const g = nuevoGuild();
    preparar(g);
    ver(g, 1, madrid(9, 5, 21), 2 * 3600, { serie: "Severance" });
    const d = wrapped.datos(g, wrapped.mesAnterior(madrid(10, 1, 11)));
    const m = wrapped.mensaje(d);
    expect(m.content).toMatch(/El más viciado: <@disc-ana> con \*\*2,0 h\*\*/);
    expect(m.content).toMatch(/Severance \(2,0 h\)/);
    expect(m.allowedMentions.users).toEqual(["disc-ana"]);
    const png = wrapped.grafico(d);
    expect(png.slice(0, 4).toString("hex")).toBe("89504e47");
});

test("un mes sin nadie que haya visto nada no tiene gráfica ni mención", () => {
    const g = nuevoGuild();
    preparar(g);
    const d = wrapped.datos(g, wrapped.mesAnterior(madrid(10, 1, 11)));
    expect(wrapped.grafico(d)).toBeNull();
    expect(wrapped.mensaje(d).content).toMatch(/nadie ha visto Plex/);
});

test("el día 1 a partir de las 10:00 publica el mes anterior una sola vez", async () => {
    const g = nuevoGuild();
    preparar(g);
    ver(g, 1, madrid(9, 5, 21), 2 * 3600, { serie: "Severance" });
    const canal = canalDe();
    const client = { guilds: { cache: new Map([[g, guildCon(g, canal)]]) } };

    expect(await wrapped.enviarSiToca(client, madrid(10, 1, 9))).toBe(0); // antes de las 10:00
    expect(canal.send).not.toHaveBeenCalled();

    expect(await wrapped.enviarSiToca(client, madrid(10, 1, 11))).toBe(1);
    expect(canal.send).toHaveBeenCalledTimes(1);
    expect(canal.send.mock.calls[0][0].files).toHaveLength(1);
    expect(guildSettings.getSettings(g).plex.wrapped_ultimo_mes).toBe("2026-09");

    expect(await wrapped.enviarSiToca(client, madrid(10, 1, 14))).toBe(0);
    expect(canal.send).toHaveBeenCalledTimes(1);
});

test("otros días no publican", async () => {
    const g = nuevoGuild();
    preparar(g);
    const canal = canalDe();
    const client = { guilds: { cache: new Map([[g, guildCon(g, canal)]]) } };
    expect(await wrapped.enviarSiToca(client, madrid(10, 2, 11))).toBe(0);
    expect(canal.send).not.toHaveBeenCalled();
});
