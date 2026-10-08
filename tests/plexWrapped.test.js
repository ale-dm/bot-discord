// 🎞️ Plex Wrapped mensual (#23), privado: cada persona recibe por DM solo su resumen del mes anterior (sus horas, sus
// películas y episodios, sus series). Nada se publica en un canal, no se ven datos de otras personas, un DM fallido no para
// a los demás, y nadie recibe dos veces el mismo mes.
const db = require("../src/core/db");
const plexLinks = require("../src/systems/plexLinks");
const wrapped = require("../src/systems/plexWrapped");

let n = 0;
let filaId = 1000;
const nuevoGuild = () => `guild-wrapped-${++n}`;
const unix = (ms) => Math.floor(ms / 1000);
// Hora de Madrid en septiembre (UTC+2) y en octubre de 2026 (UTC+2 hasta el 25).
const madrid = (mes, dia, hora) => Date.UTC(2026, mes - 1, dia, hora - 2);
const MES = () => wrapped.mesAnterior(madrid(10, 1, 11));

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

/** Un cliente de Discord de mentira: guarda los DMs por persona, y falla para quien esté en `cerrados`. */
function cliente(cerrados = []) {
    const enviados = new Map();
    return {
        enviados,
        users: {
            fetch: jest.fn(async (id) => ({
                send: jest.fn(async (payload) => {
                    if (cerrados.includes(id)) throw new Error("DMs cerrados");
                    enviados.set(id, [...(enviados.get(id) || []), payload]);
                }),
            })),
        },
    };
}

test("el mes anterior, en hora de Madrid, con el cambio de año", () => {
    expect(MES()).toEqual({ mes: "2026-09", inicio: "2026-09-01", fin: "2026-09-30", etiqueta: "septiembre de 2026" });
    expect(wrapped.mesAnterior(Date.UTC(2027, 0, 1, 11)).mes).toBe("2026-12");
});

test("el resumen de una persona cuenta solo lo suyo", () => {
    const g = nuevoGuild();
    ver(g, 1, madrid(9, 5, 21), 2 * 3600, { serie: "Severance", titulo: "Ep 1" });
    ver(g, 1, madrid(9, 20, 22), 3600, { tipo: "movie", titulo: "Dune", rating_key: "dune" });
    ver(g, 2, madrid(9, 30, 23), 10 * 3600, { serie: "Shogun", titulo: "Ep 2" }); // de otra persona
    ver(g, 1, madrid(8, 31, 23), 5 * 3600, { serie: "Vieja", titulo: "Ep 0" }); // agosto: no cuenta
    const r = wrapped.resumenPersonal(g, 1, MES());
    expect(r.horas).toBe(3);
    expect(r.peliculas).toBe(1);
    expect(r.episodios).toBe(1);
    expect(r.series).toEqual([{ nombre: "Severance", horas: 2 }]);
    expect(JSON.stringify(r)).not.toMatch(/Shogun/);
});

test("el mensaje de una persona solo tiene sus datos", () => {
    const g = nuevoGuild();
    ver(g, 1, madrid(9, 5, 21), 2 * 3600, { serie: "Severance" });
    const texto = wrapped.mensajePersonal(wrapped.resumenPersonal(g, 1, MES()));
    expect(texto).toMatch(/Has visto \*\*2,0 h\*\*/);
    expect(texto).toMatch(/Severance \(2,0 h\)/);
    expect(texto).not.toMatch(/más viciado|Entre todos|<@/);
});

test("sin nada visto, el mensaje lo dice y no hay gráfica", () => {
    const g = nuevoGuild();
    const r = wrapped.resumenPersonal(g, 9, MES());
    expect(wrapped.mensajePersonal(r)).toMatch(/no has visto nada/);
    expect(wrapped.graficoPersonal(r)).toBeNull();
});

test("cada persona recibe por DM solo su propio resumen, y nada en ningún canal", async () => {
    const g = nuevoGuild();
    plexLinks.setLink(g, "disc-ana", "1", "Ana");
    plexLinks.setLink(g, "disc-luis", "2", "Luis");
    plexLinks.setLink(g, "disc-nadie", "3", "Nadie");
    ver(g, 1, madrid(9, 5, 21), 2 * 3600, { serie: "Severance" });
    ver(g, 2, madrid(9, 6, 21), 1 * 3600, { serie: "Shogun" });
    const c = cliente();
    expect(await wrapped.enviarPorDm(c, { id: g }, MES())).toBe(2);
    expect(c.enviados.get("disc-ana")[0].content).toMatch(/Severance/);
    expect(c.enviados.get("disc-ana")[0].content).not.toMatch(/Shogun/);
    expect(c.enviados.get("disc-luis")[0].content).toMatch(/Shogun/);
    expect(c.enviados.has("disc-nadie")).toBe(false);
});

test("un DM que falla no para a los demás, y nadie recibe el mismo mes dos veces", async () => {
    const g = nuevoGuild();
    plexLinks.setLink(g, "disc-a", "11", "A");
    plexLinks.setLink(g, "disc-b", "12", "B");
    ver(g, 11, madrid(9, 5, 21), 3600, { serie: "X" });
    ver(g, 12, madrid(9, 5, 21), 3600, { serie: "Y" });
    const c = cliente(["disc-a"]);
    expect(await wrapped.enviarPorDm(c, { id: g }, MES())).toBe(1);
    expect(c.enviados.has("disc-b")).toBe(true);
    // Segunda pasada: B ya lo tiene; A (con DMs cerrados) se vuelve a intentar.
    const otra = cliente();
    expect(await wrapped.enviarPorDm(otra, { id: g }, MES())).toBe(1);
    expect(otra.enviados.has("disc-b")).toBe(false);
});

test("el día 1 a partir de las 10:00 (Madrid) se envía, y otros días no", async () => {
    const g = nuevoGuild();
    plexLinks.setLink(g, "disc-ana", "21", "Ana");
    ver(g, 21, madrid(9, 5, 21), 3600, { serie: "Q" });
    const c = cliente();
    const client = { users: c.users, guilds: { cache: new Map([[g, { id: g, name: g }]]) } };
    expect(await wrapped.enviarSiToca(client, madrid(10, 1, 9))).toBe(0);
    expect(await wrapped.enviarSiToca(client, madrid(10, 2, 11))).toBe(0);
    expect(await wrapped.enviarSiToca(client, madrid(10, 1, 11))).toBe(1);
    expect(await wrapped.enviarSiToca(client, madrid(10, 1, 14))).toBe(0);
});
