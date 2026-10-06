// 🎃 Trofeos de Plex con fecha (F-PX-11): cualquier condición de un trofeo de admin puede llevar `desde:` y `hasta:`
// (días en hora de Madrid, incluidos) y entonces solo cuenta lo que se empezó a ver entre esas fechas: eventos de
// temporada como "Halloween: 5 de terror en octubre". Pasado el plazo, solo lo ve quien lo consiguió.
const { nuevoGuild, madrid, peli, serie, verPeli, verEps, vincular } = require("./ayudaPlex");
const achievements = require("../src/systems/achievementsSystem");
const plexHistorial = require("../src/systems/plexHistorial");
const plexTrofeos = require("../src/systems/plexTrofeos");
const { buildPlexTrofeos, handlePlexModal } = require("../src/adminPanel/plex");

const p = plexTrofeos.parsearCondicion;
const crear = (g, condicion, extra = {}) => {
    const r = plexTrofeos.crearAdmin(
        g,
        { nombre: extra.nombre || condicion.slice(0, 50), condicion, recompensa: "100", ...extra },
        "admin",
    );
    expect(r).toMatchObject({ ok: true });
    return `plext:${r.trofeo.id}`;
};
const de = (g, u, id) => achievements.listUserAchievements(g, `disc-${u}`, { includeHidden: true }).find((a) => a.id === id);

beforeEach(() => {
    delete process.env.GOOGLE_API_KEY;
});

describe("condiciones con fechas", () => {
    test("desde y hasta, en cualquier orden y en mayúsculas; el texto queda siempre igual", () => {
        expect(p("genero:Terror 5 desde:2026-10-01 hasta:2026-10-31")).toEqual({
            ok: true,
            cond: { tipo: "genero", valor: "Terror", n: 5, desde: "2026-10-01", hasta: "2026-10-31" },
            texto: "genero:Terror 5 desde:2026-10-01 hasta:2026-10-31",
        });
        expect(p("genero:Terror 5 HASTA:2026-10-31 Desde:2026-10-01").texto).toBe("genero:Terror 5 desde:2026-10-01 hasta:2026-10-31");
        expect(p("peliculas 3 hasta:2026-12-24")).toMatchObject({ ok: true, cond: { tipo: "peliculas", n: 3, hasta: "2026-12-24" } });
        expect(p("pelicula:Blade Runner 2049 desde:2026-01-01")).toMatchObject({
            ok: true,
            cond: { valor: "Blade Runner 2049", n: null, desde: "2026-01-01" },
        });
        // Sin fechas, igual que siempre.
        expect(p("genero:Terror 20")).toEqual({ ok: true, cond: { tipo: "genero", valor: "Terror", n: 20 }, texto: "genero:Terror 20" });
    });

    test("fechas mal escritas o al revés: avisa", () => {
        expect(p("genero:Terror 5 desde:2026-02-30").error).toBe('La fecha de "desde" va como AAAA-MM-DD: `desde:2026-10-31`.');
        expect(p("genero:Terror 5 hasta:31/10/2026").ok).toBe(false);
        expect(p("genero:Terror 5 hasta:2026-13-01").ok).toBe(false);
        expect(p("genero:Terror 5 desde:2026-11-01 hasta:2026-10-01").error).toBe('La fecha de "hasta" es anterior a la de "desde".');
        expect(p("genero:Terror desde:2026-10-01").error).toMatch(/^Falta cuántos/);
    });

    test("el rango es de días enteros en hora de Madrid, también con el cambio de hora", () => {
        // 29 de marzo de 2026: a las 2 pasan a ser las 3 (UTC+1 → UTC+2). 25 de octubre: al revés.
        expect(plexTrofeos.rangoDe({ desde: "2026-03-29", hasta: "2026-03-29" })).toEqual({
            desde: Date.UTC(2026, 2, 28, 23) / 1000,
            hasta: Date.UTC(2026, 2, 29, 22) / 1000,
        });
        expect(plexTrofeos.rangoDe({ desde: "2026-10-25", hasta: "2026-10-25" })).toEqual({
            desde: Date.UTC(2026, 9, 24, 22) / 1000,
            hasta: Date.UTC(2026, 9, 25, 23) / 1000,
        });
        expect(plexTrofeos.rangoDe({ hasta: "2026-12-31" }).desde).toBe(0);
        expect(plexTrofeos.rangoDe({ desde: "2026-12-31" }).hasta).toBe(Number.MAX_SAFE_INTEGER);
        expect(plexTrofeos.rangoDe({})).toBeNull();
    });

    test("la descripción dice las fechas", () => {
        const g = nuevoGuild("guild-fechas");
        const r = (condicion) => plexTrofeos.crearAdmin(g, { nombre: "x", condicion, recompensa: "0" }, "admin").trofeo.descripcion;
        expect(r("genero:Terror 5 desde:2026-10-01 hasta:2026-10-31")).toBe(
            "Ve 5 películas de Terror (del 1 de octubre de 2026 al 31 de octubre de 2026)",
        );
        expect(r("horas 10 hasta:2026-12-24")).toBe("Ve 10 horas en Plex (hasta el 24 de diciembre de 2026)");
        expect(r("idioma-episodios:vose 3 desde:2026-01-01")).toBe(
            "Ve 3 episodios en VOSE (inglés con subtítulos en castellano) (desde el 1 de enero de 2026)",
        );
    });
});

describe("solo cuenta lo visto entre las fechas", () => {
    const g = nuevoGuild("guild-fechas");
    let halloween;
    let masTerror;
    let siempre;
    let horas;
    let serieOctubre;
    beforeAll(async () => {
        vincular(g, 1);
        for (let i = 0; i < 8; i++) peli(g, `t${i}`, `Terror ${i}`, 1980 + i, { generos: ["Terror"] });
        // Fuera (30 de septiembre por la noche y 1 de noviembre de madrugada) y dentro (del 1 al 31 de octubre en Madrid,
        // aunque en UTC sean otro día).
        verPeli(g, 1, "t0", "Terror 0", 1980, { inicio: madrid("2026-09-30", 23, 30) });
        verPeli(g, 1, "t1", "Terror 1", 1981, { inicio: madrid("2026-11-01", 0, 10) });
        verPeli(g, 1, "t2", "Terror 2", 1982, { inicio: madrid("2026-10-01", 0, 30) });
        verPeli(g, 1, "t3", "Terror 3", 1983, { inicio: madrid("2026-10-10") });
        verPeli(g, 1, "t4", "Terror 4", 1984, { inicio: madrid("2026-10-20") });
        verPeli(g, 1, "t5", "Terror 5", 1985, { inicio: madrid("2026-10-26") });
        verPeli(g, 1, "t6", "Terror 6", 1986, { inicio: madrid("2026-10-31", 23, 59) });
        // Una serie: el primer episodio en septiembre y el segundo en octubre.
        serie(g, "s", "Stranger Things", { 1: [1, 2] });
        verEps(g, 1, "s", "Stranger Things", [[1, 1]], { inicio: madrid("2026-09-15") });
        verEps(g, 1, "s", "Stranger Things", [[1, 2]], { inicio: madrid("2026-10-15") });
        const octubre = "desde:2026-10-01 hasta:2026-10-31";
        halloween = crear(g, `genero:Terror 5 ${octubre}`, { nombre: "Halloween" });
        masTerror = crear(g, `genero:Terror 6 ${octubre}`);
        siempre = crear(g, "genero:Terror 7");
        horas = crear(g, `horas 5 ${octubre}`);
        serieOctubre = crear(g, `serie:Stranger Things ${octubre}`);
        await plexHistorial.actualizarLogros(g);
    });

    test("5 de terror en octubre (en hora de Madrid): lo tiene; 6, no (lleva 5); sin fechas cuentan las 7", () => {
        expect(de(g, 1, halloween)).toMatchObject({ completed: true, progress: 5, target: 5 });
        expect(de(g, 1, masTerror)).toMatchObject({ completed: false, progress: 5, target: 6 });
        expect(de(g, 1, siempre)).toMatchObject({ completed: true, progress: 7 });
    });

    test("las horas, solo las de esas fechas (5 películas y un episodio de 1 h)", () => {
        expect(de(g, 1, horas)).toMatchObject({ completed: true, progress: 6 });
    });

    test("terminar una serie en esas fechas: solo cuentan los episodios vistos entonces", () => {
        expect(de(g, 1, serieOctubre)).toMatchObject({ completed: false, progress: 1, target: 2 });
    });
});

describe("pasado el plazo", () => {
    test("solo lo ve quien lo consiguió; los que no han llegado al final, todos", async () => {
        const g = nuevoGuild("guild-fechas");
        vincular(g, 1, 2);
        peli(g, "p", "P", 2000);
        verPeli(g, 1, "p", "P", 2000, { inicio: madrid("2000-01-15") });
        const pasado = crear(g, "peliculas 1 desde:2000-01-01 hasta:2000-01-31");
        const futuro = crear(g, "peliculas 1 hasta:2999-12-31");
        await plexHistorial.actualizarLogros(g);
        expect(de(g, 1, pasado)).toMatchObject({ completed: true });
        expect(de(g, 2, pasado)).toBeUndefined();
        expect(de(g, 2, futuro)).toMatchObject({ completed: false, progress: 0 });
        expect(achievements.getCatalog(g).find((a) => a.id === pasado).visibleHasta).toBe(Date.UTC(2000, 0, 31, 23) * 1);
    });
});

describe("en el panel", () => {
    test("la ayuda explica las fechas y el formulario las acepta", async () => {
        const g = nuevoGuild("guild-fechas");
        expect(buildPlexTrofeos(g).embeds[0].data.description).toMatch(
            /• `genero:Terror 5 desde:2026-10-01 hasta:2026-10-31` → 🎃 con fechas: solo cuenta lo visto entre esos días/,
        );
        const reply = jest.fn(async () => {});
        const campos = { nombre: "Navidad", condicion: "genero:Familia 3 desde:2026-12-20 hasta:2027-01-06", recompensa: "500" };
        await handlePlexModal({
            customId: "paneladmin_plex_trofeo_modal",
            guildId: g,
            user: { id: "admin" },
            fields: { getTextInputValue: (k) => campos[k] ?? "" },
            reply,
        });
        expect(reply.mock.calls[0][0].content).toMatch(
            /✅ Trofeo \*\*Navidad\*\* creado \(`genero:Familia 3 desde:2026-12-20 hasta:2027-01-06`, 🪙 500\): Ve 3 películas de Familia \(del 20 de diciembre de 2026 al 6 de enero de 2027\)/,
        );
    });

    test("con muchos trofeos de admin, el panel no pasa del límite de Discord", () => {
        const g = nuevoGuild("guild-fechas");
        for (let i = 0; i < 60; i++)
            crear(g, `genero:Ciencia ficción ${i + 1} desde:2026-10-01 hasta:2026-10-31`, {
                nombre: `Trofeo con un nombre largo ${i}`.padEnd(60, "x"),
            });
        expect(buildPlexTrofeos(g).embeds[0].data.description.length).toBeLessThanOrEqual(4096);
    });
});
