// 🍿 Plex en /perfil: el filtro de 🏅 Logros y los de Plex escondidos a quien no lo tiene vinculado (F-PX-02e), la
// pantalla 🍿 Plex con lo que le falta poco (F-PX-09) y el ranking 🍿 Plex en 🏆 Rankings (F-PX-10). Todo a través del
// comando, como en Discord, y validando lo que se manda (ids únicos, filas y botones dentro de los límites).
const { db, nuevoGuild, peli, serie, verPeli, verEps, bibliotecaCompleta, vincular } = require("./ayudaPlex");
const guildSettings = require("../src/systems/guildSettings");
const achievements = require("../src/systems/achievementsSystem");
const plexHistorial = require("../src/systems/plexHistorial");
const plexTrofeos = require("../src/systems/plexTrofeos");
const plexRankings = require("../src/systems/plexRankings");
const plexResumen = require("../src/systems/plexResumen");
const perfilPanel = require("../src/paneles/perfil");
const perfilCmd = require("../src/commands/progresion/perfil");

const G = nuevoGuild("guild-perfil");
const guild = {
    id: G,
    name: G,
    members: { cache: new Map(), fetch: async () => null },
    channels: { cache: new Map(), fetch: async () => null },
    roles: { cache: new Map() },
    iconURL: () => null,
};

/** Lo que se manda a Discord es válido: como mucho 5 filas de 5, ids únicos y de 100 caracteres. */
function valido(payload) {
    const ids = [];
    expect(payload.components.length).toBeLessThanOrEqual(5);
    for (const fila of payload.components) {
        const json = fila.toJSON();
        expect(json.components.length).toBeLessThanOrEqual(5);
        for (const c of json.components) {
            if (c.custom_id) ids.push(c.custom_id);
            expect((c.custom_id || "").length).toBeLessThanOrEqual(100);
            expect((c.options || []).length).toBeLessThanOrEqual(25);
        }
    }
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of payload.embeds || []) {
        const d = e.toJSON();
        expect((d.description || "").length).toBeLessThanOrEqual(4096);
        for (const f of d.fields || []) expect(f.value.length).toBeLessThanOrEqual(1024);
    }
    return payload;
}
const ids = (payload) => payload.components.flatMap((f) => f.toJSON().components.map((c) => c.custom_id));
const boton = async (customId, user = "disc-1") => {
    const update = jest.fn(async () => {});
    await perfilCmd.handleButton(null, { customId, user: { id: user }, guild, guildId: G, update, reply: jest.fn() });
    return valido(update.mock.calls[0][0]);
};
const menu = async (customId, values, user = "disc-1") => {
    const update = jest.fn(async () => {});
    await perfilCmd.handleSelect(null, { customId, values, user: { id: user }, guild, guildId: G, update, reply: jest.fn() });
    return valido(update.mock.calls[0][0]);
};

beforeAll(async () => {
    delete process.env.GOOGLE_API_KEY;
    guildSettings.setSetting(G, "plex.importacion_pct", 100);
    vincular(G, 1, 2);
    bibliotecaCompleta(G);
    // Ana (1): 12 películas (unas en VOSE), Dark casi entera en VOSE y Breaking Bad entera; Luis (2), una película, y oculta lo suyo.
    for (let i = 0; i < 12; i++) {
        peli(G, `p${i}`, `Peli ${i}`, 1990 + i);
        verPeli(G, 1, `p${i}`, `Peli ${i}`, 1990 + i, i < 6 ? { audio: "en", subs: "es" } : { audio: "es", subs: "no" });
    }
    serie(G, "dark", "Dark", { 1: [1, 2, 3, 4, 5] });
    verEps(
        G,
        1,
        "dark",
        "Dark",
        [1, 2].map((e) => [1, e]),
        { audio: "en", subs: "es" },
    );
    serie(G, "bb", "Breaking Bad", { 1: [1, 2] });
    verEps(G, 1, "bb", "Breaking Bad", [
        [1, 1],
        [1, 2],
    ]);
    peli(G, "solo", "Solo", 2018);
    verPeli(G, 2, "solo", "Solo", 2018);
    await plexHistorial.actualizarLogros(guild);
    plexTrofeos.setOculto(G, "disc-2", true);
    // Carlos (3) no tiene Plex: un logro de casino y ninguno de Plex.
    await achievements.applyEvent(G, "disc-3", "casino_bet", 1);
});

describe("🏅 Logros: los de Plex solo a quien lo tiene vinculado (F-PX-02e)", () => {
    test("sin Plex vinculado no se ven los 87 fijos de Plex ni cuentan en el total", () => {
        const p = valido(perfilPanel.buildLogros(G, "disc-3", "disc-3", 0, true));
        expect(p.embeds[0].data.description).not.toMatch(/\(plex/);
        // Los secretos sin conseguir tampoco cuentan en el total (como siempre).
        const total = achievements.CATALOG.filter((a) => a.category !== "plex" && !a.hidden).length;
        expect(p.embeds[0].data.fields[0].value).toBe(`1/${total} (${Math.round(100 / total)}%)`);
        // En su perfil (👤) y para el Duende, igual.
        expect(achievements.getSummary(G, "disc-3", plexTrofeos.opcionesPerfil(G, "disc-3", true)).total).toBe(total);
        const { DUENDE_TOOL_EXECUTORS } = require("../src/services/duende/herramientas");
        expect(DUENDE_TOOL_EXECUTORS.consultar_logros({}, { guildId: G, userId: "disc-3" })).toMatchObject({ logros_totales: total });
    });

    test("pero los de Plex que ya consiguió (estuvo vinculado) sí le salen", () => {
        db.prepare(
            "INSERT INTO achievements_progress (guildId, userId, achievementId, progress, completedAt) VALUES (?, 'disc-3', 'plex_pelis_1', 1, ?)",
        ).run(G, Date.now());
        const lista = achievements.listUserAchievements(G, "disc-3", plexTrofeos.opcionesPerfil(G, "disc-3", true));
        expect(lista.filter((a) => a.category === "plex").map((a) => a.id)).toEqual(["plex_pelis_1"]);
        db.prepare("DELETE FROM achievements_progress WHERE guildId = ? AND userId = 'disc-3' AND achievementId = 'plex_pelis_1'").run(G);
    });

    test("con Plex vinculado se ven todos (también los que no tiene)", () => {
        const lista = achievements.listUserAchievements(G, "disc-1", plexTrofeos.opcionesPerfil(G, "disc-1", true));
        expect(lista.filter((a) => a.category === "plex" && !a.completed).length).toBeGreaterThan(50);
    });
});

describe("🏅 Logros: filtro (F-PX-02e)", () => {
    // Los menús del filtro: el de las categorías y, dentro de 🍿 Plex, el de lo de Plex.
    const menuDe = (payload, customId) => payload.components.map((f) => f.toJSON().components[0]).find((c) => c.custom_id === customId);
    const valores = (m) => m.options.map((o) => o.value);
    const elegido = (m) => m.options.find((o) => o.default)?.value;

    test("el menú tiene las categorías que tiene; lo de Plex (trofeos y dificultades) va dentro de 🍿 Plex", () => {
        const p = valido(perfilPanel.buildLogros(G, "disc-1", "disc-1"));
        expect(valores(menuDe(p, "perfil_logrosfiltro_disc-1_disc-1_0"))).toEqual([
            "todos",
            "cat-social",
            "cat-xp",
            "cat-casino",
            "cat-cripto",
            "cat-tienda",
            "cat-plex",
        ]);
        // Sin 🍿 Plex elegido, el de dentro no sale.
        expect(ids(p)).not.toContain("perfil_logrosfiltro_disc-1_disc-1_0_plex");
        const sinPlex = valido(perfilPanel.buildLogros(G, "disc-3", "disc-3"));
        const deCarlos = valores(menuDe(sinPlex, "perfil_logrosfiltro_disc-3_disc-3_0"));
        expect(deCarlos).not.toContain("cat-plex");
        expect(deCarlos).not.toContain("dif-gordo");
    });

    test("con 🍿 Plex elegido sale otro menú con todo lo de Plex; fuera de Plex, no", async () => {
        const p = await menu("perfil_logrosfiltro_disc-1_disc-1_0", ["cat-plex"]);
        expect(p.embeds[0].data.title).toBe("🏅 Tus logros · 🍿 Plex");
        expect(elegido(menuDe(p, "perfil_logrosfiltro_disc-1_disc-1_0"))).toBe("cat-plex");
        const dePlex = menuDe(p, "perfil_logrosfiltro_disc-1_disc-1_0_plex");
        expect(valores(dePlex)).toEqual(["cat-plex", "trofeos", "dif-facil", "dif-normal", "dif-gordo"]);
        expect(dePlex.options.map((o) => o.label)).toEqual([
            "🍿 Todos los de Plex",
            "🏆 Solo trofeos",
            "🟢 Fácil",
            "🟡 Normal",
            "🎰 Gordo del Plex",
        ]);
        expect(elegido(dePlex)).toBe("cat-plex");
        // Todos los de Plex, y solo esos.
        const lineas = p.embeds[0].data.description.split("\n").filter((l) => /^(✅|🎁|⏳)/.test(l));
        expect(lineas.length).toBeGreaterThan(0);
        expect(lineas.every((l) => l.includes("(plex"))).toBe(true);
        // Otra categoría: el de dentro de Plex se va.
        const casino = await menu("perfil_logrosfiltro_disc-1_disc-1_0", ["cat-casino"]);
        expect(elegido(menuDe(casino, "perfil_logrosfiltro_disc-1_disc-1_0"))).toBe("cat-casino");
        expect(ids(casino)).not.toContain("perfil_logrosfiltro_disc-1_disc-1_0_plex");
    });

    test("elegir un filtro: solo esos, el título lo dice, y los botones lo conservan", async () => {
        // Desde el menú de dentro de 🍿 Plex (su "_plex" sobra al leerlo).
        const p = await menu("perfil_logrosfiltro_disc-1_disc-1_0_plex", ["trofeos"]);
        expect(p.embeds[0].data.title).toBe("🏅 Tus logros · 🏆 Solo trofeos de Plex");
        expect(p.embeds[0].data.description).toMatch(/Breaking Bad/);
        expect(p.embeds[0].data.description).not.toMatch(/\(social|Se apagan las luces/);
        expect(ids(p)).toEqual(
            expect.arrayContaining([
                "perfil_logros_disc-1_disc-1_-1_0_trofeos",
                "perfil_logros_disc-1_disc-1_1_0_trofeos",
                "perfil_logros_disc-1_disc-1_0_1_trofeos",
                "perfil_logros_disc-1_disc-1_0_0_tab",
            ]),
        );
        // Arriba sigue 🍿 Plex; dentro, los trofeos.
        expect(elegido(menuDe(p, "perfil_logrosfiltro_disc-1_disc-1_0"))).toBe("cat-plex");
        expect(elegido(menuDe(p, "perfil_logrosfiltro_disc-1_disc-1_0_plex"))).toBe("trofeos");
        // Con los secretos a la vista, los dos menús lo conservan.
        const conSecretos = await boton("perfil_logros_disc-1_disc-1_0_1_trofeos");
        expect(ids(conSecretos)).toEqual(
            expect.arrayContaining(["perfil_logrosfiltro_disc-1_disc-1_1", "perfil_logrosfiltro_disc-1_disc-1_1_plex"]),
        );
        const facil = await menu("perfil_logrosfiltro_disc-1_disc-1_1_plex", ["dif-facil"]);
        expect(facil.embeds[0].data.title).toBe("🏅 Tus logros · 🍿 Plex: 🟢 Fácil");
        expect(ids(facil)).toContain("perfil_logros_disc-1_disc-1_0_0_dif-facil");
    });

    test("pasar página y ver secretos con un filtro puesto; la pestaña 🏅 Logros lo quita", async () => {
        const facil = await menu("perfil_logrosfiltro_disc-1_disc-1_0", ["dif-facil"]);
        const lineas = facil.embeds[0].data.description.split("\n").filter((l) => /^(✅|🎁|⏳)/.test(l));
        expect(lineas.length).toBeGreaterThan(0);
        expect(lineas.every((l) => l.includes("🟢 Fácil"))).toBe(true);
        const pagina2 = await boton("perfil_logros_disc-1_disc-1_1_0_dif-facil");
        expect(pagina2.embeds[0].data.fields.find((f) => f.name === "Página").value).toMatch(/^2\//);
        expect(pagina2.embeds[0].data.title).toMatch(/🟢 Fácil/);
        const todos = await boton("perfil_logros_disc-1_disc-1_0_0_tab");
        expect(todos.embeds[0].data.title).toBe("🏅 Tus logros");
        // Un filtro que no existe (un id viejo o inventado) es "todos".
        expect(perfilPanel.buildLogros(G, "disc-1", "disc-1", 0, false, "cat-nada").embeds[0].data.title).toBe("🏅 Tus logros");
    });

    test("reclamar con un filtro puesto vuelve al mismo filtro", async () => {
        const p = await menu("perfil_reclamar_disc-1_disc-1_cat-plex", ["plex_pelis_1"]);
        expect(p.content).toMatch(/^✅ Reclamaste \*\*Se apagan las luces\*\* y ganaste \*\*100 🪙\*\*\.$/);
        expect(p.embeds[0].data.title).toBe("🏅 Tus logros · 🍿 Plex");
        const todo = await boton("perfil_reclamartodo_disc-1_disc-1_cat-plex");
        expect(todo.content).toMatch(/^✅ Reclamaste \d+ logros/);
        expect(todo.embeds[0].data.title).toBe("🏅 Tus logros · 🍿 Plex");
    });

    test("sin filtro, los ids de siempre (los mensajes de antes siguen funcionando)", () => {
        const p = perfilPanel.buildLogros(G, "disc-1", "disc-1");
        expect(ids(p)).toEqual(expect.arrayContaining(["perfil_logros_disc-1_disc-1_1_0", "perfil_logros_disc-1_disc-1_0_1"]));
    });

    test("otra persona no puede usar tu filtro", async () => {
        const reply = jest.fn(async () => {});
        await perfilCmd.handleSelect(null, {
            customId: "perfil_logrosfiltro_disc-1_disc-1_0",
            values: ["trofeos"],
            user: { id: "x" },
            reply,
        });
        expect(reply.mock.calls[0][0].content).toMatch(/^⛔/);
    });
});

describe("🍿 Plex en /perfil (F-PX-09)", () => {
    test("el botón 🍿 Plex sale en 👤 Perfil a quien lo tiene vinculado (y no en el de quien lo oculta, para los demás)", async () => {
        const propio = await perfilPanel.buildPerfil(guild, "disc-1", "disc-1");
        expect(ids(valido(propio))).toContain("perfil_plex_disc-1_disc-1");
        expect(ids(await perfilPanel.buildPerfil(guild, "disc-3", "disc-3"))).not.toContain("perfil_plex_disc-3_disc-3");
        expect(ids(await perfilPanel.buildPerfil(guild, "disc-1", "disc-2"))).not.toContain("perfil_plex_disc-1_disc-2");
        expect(ids(await perfilPanel.buildPerfil(guild, "disc-2", "disc-2"))).toContain("perfil_plex_disc-2_disc-2");
    });

    test("horas, series terminadas, idiomas y lo que le falta poco", async () => {
        const p = await boton("perfil_plex_disc-1_disc-1");
        const campos = Object.fromEntries(p.embeds[0].data.fields.map((f) => [f.name, f.value]));
        expect(p.embeds[0].data.title).toBe("🍿 Tu Plex");
        expect(campos["⏱️ Visto"]).toBe("**16 h** · 12 películas · 4 episodios de 2 series");
        expect(campos["📺 Series terminadas"]).toBe("**1**");
        // 8 de 16 en inglés con subtítulos en castellano (VOSE); el resto, sin dato o en castellano.
        expect(campos["🗣️ Idiomas"]).toMatch(/🇬🇧 Inglés \*\*\d+ %\*\* \(📝 VOSE \d+ %\)/);
        expect(campos["🗣️ Idiomas"]).toMatch(/🇪🇸 Castellano \*\*\d+ %\*\*/);
        expect(campos["🎯 Te falta poco"]).toMatch(
            /📺 3 episodios para terminar \*Dark\* 📝 en VOSE \(inglés con subtítulos en castellano\) \(2\/5\)/,
        );
        // "Socio del videoclub" (25 películas): le faltan 13.
        expect(campos["🎯 Te falta poco"]).toMatch(/13 películas para \*\*Socio del videoclub\*\* \(12\/25\)/);
        expect(ids(p)).toContain("perfil_logros_disc-1_disc-1_0_0_cat-plex");
        // El botón lleva a sus logros de Plex.
        const logros = await boton("perfil_logros_disc-1_disc-1_0_0_cat-plex");
        expect(logros.embeds[0].data.title).toBe("🏅 Tus logros · 🍿 Plex");
    });

    test("el de otro se ve entero salvo si lo oculta; sin Plex, lo dice", async () => {
        const deAna = await boton("perfil_plex_disc-3_disc-1", "disc-3");
        expect(deAna.embeds[0].data.title).toBe("🍿 Plex");
        expect(deAna.embeds[0].data.fields.length).toBeGreaterThan(3);
        const deLuis = await boton("perfil_plex_disc-1_disc-2");
        expect(deLuis.embeds[0].data.description).toBe("<@disc-2> ha ocultado sus logros de Plex. 🙈");
        expect(perfilPanel.buildPlex(guild, "disc-2", "disc-2").embeds[0].data.fields.length).toBeGreaterThan(3);
        expect(perfilPanel.buildPlex(guild, "disc-3", "disc-3").embeds[0].data.description).toMatch(
            /^No tienes la cuenta de Plex vinculada/,
        );
    });

    test("/perfil seccion:🍿 Plex la abre directamente", async () => {
        const reply = jest.fn(async () => {});
        await perfilCmd.run(null, {
            guild,
            user: { id: "disc-1", username: "ana", tag: "ana" },
            options: { getUser: () => null, getString: () => "plex" },
            reply,
        });
        expect(reply.mock.calls[0][0].embeds[0].data.title).toBe("🍿 Tu Plex");
        expect(
            perfilCmd.data
                .toJSON()
                .options.find((o) => o.name === "seccion")
                .choices.map((c) => c.value),
        ).toContain("plex");
    });

    test("la versión de una serie a medias: la más concreta en la que va todo lo visto, o ninguna si va mezclada", () => {
        const datos = {
            series: [
                {
                    ficha: { titulo: "Mezcla" },
                    anime: false,
                    completa: false,
                    total: 4,
                    vistosEnFicha: 2,
                    temporadas: [{ n: 1, episodios: [1, 2, 3, 4] }],
                    porModo: new Map([
                        ["ingles", new Set(["1:1"])],
                        ["castellano", new Set(["1:2"])],
                    ]),
                },
                {
                    ficha: { titulo: "Sin subs" },
                    anime: false,
                    completa: false,
                    total: 3,
                    vistosEnFicha: 1,
                    temporadas: [{ n: 1, episodios: [1, 2, 3] }],
                    porModo: new Map([
                        ["ingles", new Set(["1:1"])],
                        ["ingles_sin_subs", new Set(["1:1"])],
                    ]),
                },
            ],
        };
        expect(plexResumen.seriesAMedias(datos)).toEqual([
            { titulo: "Mezcla", anime: false, faltan: 2, vistos: 2, total: 4, modo: null },
            { titulo: "Sin subs", anime: false, faltan: 2, vistos: 1, total: 3, modo: "ingles_sin_subs" },
        ]);
        expect(plexResumen.textoFalta(1, ["película", "películas"])).toBe("1 película");
        expect(plexResumen.textoFalta(4, null)).toBe("4 más");
        expect(plexResumen.unidad("plex_idioma_pelis_vose")).toEqual(["película", "películas"]);
    });
});

describe("🏆 Rankings → 🍿 Plex (F-PX-10)", () => {
    test("está en el menú de rankings", async () => {
        const p = await menu("perfil_ranksel_disc-1_disc-1", ["plex"]);
        expect(p.embeds[0].data.title).toBe("🍿 Rankings de Plex");
        const opciones = p.components[0].toJSON().components[0].options;
        expect(opciones.find((o) => o.default).value).toBe("plex");
    });

    test("logros, Gordos y políglota sin quien los oculta; las horas, con todos", () => {
        const r = plexRankings.rankings(G);
        expect(r.logros.map((x) => x.discordUserId)).toEqual(["disc-1"]);
        // Ana: 5 películas en inglés, 5 en VOSE y 5 en castellano (Luis, que también tiene logros, los oculta).
        expect(r.poliglota).toEqual([{ discordUserId: "disc-1", n: 3 }]);
        // Sus 16 h de la prueba son del mismo día: "Sin pestañear" (10 h en un día) es un 🎰.
        expect(r.gordos).toEqual([{ discordUserId: "disc-1", n: 1 }]);
        expect(r.horasSiempre).toEqual([
            { discordUserId: "disc-1", n: 16 * 3600 },
            { discordUserId: "disc-2", n: 3600 },
        ]);
        expect(r.horasMes).toEqual([]); // todo lo de la prueba es de mayo de 2026
    });

    test("las horas del mes: desde el día 1 en hora de Madrid", () => {
        const g = nuevoGuild("guild-perfil");
        vincular(g, 1);
        const { madrid, ver } = require("./ayudaPlex");
        ver(g, 1, { inicio: madrid("2026-10-31", 23, 30), segundos: 1800 }); // fuera: octubre
        ver(g, 1, { inicio: madrid("2026-11-01", 0, 30), segundos: 7200 }); // dentro (en UTC aún es 31 de octubre)
        const r = plexRankings.rankings(g, madrid("2026-11-15", 12) * 1000);
        expect(r.mes).toBe("noviembre");
        expect(r.horasMes).toEqual([{ discordUserId: "disc-1", n: 7200 }]);
        expect(r.horasSiempre).toEqual([{ discordUserId: "disc-1", n: 9000 }]);
    });

    test("los idiomas cuentan en políglota y los Gordos en su ranking; el embed lo enseña", async () => {
        // Un logro de idioma más y un 🎰 (como si los hubiera conseguido).
        const completar = db.prepare(
            `INSERT INTO achievements_progress (guildId, userId, achievementId, progress, completedAt) VALUES (?, 'disc-1', ?, ?, ?)
             ON CONFLICT(guildId, userId, achievementId) DO UPDATE SET progress = excluded.progress, completedAt = excluded.completedAt`,
        );
        completar.run(G, "plex_vose_eps_10", 10, Date.now());
        completar.run(G, "plex_horas_500", 500, Date.now());
        const r = plexRankings.rankings(G);
        expect(r.poliglota).toEqual([{ discordUserId: "disc-1", n: 4 }]);
        expect(r.gordos).toEqual([{ discordUserId: "disc-1", n: 2 }]);
        const p = await boton("perfil_rank_disc-1_disc-1_plex_0");
        const campos = Object.fromEntries(p.embeds[0].data.fields.map((f) => [f.name, f.value]));
        expect(campos["🏆 Más logros de Plex"]).toMatch(/^🥇 <@disc-1> — \*\*\d+\*\*$/);
        expect(campos["🎰 Más Gordos del Plex"]).toBe("🥇 <@disc-1> — **2**");
        expect(campos["🗣️ Más políglota"]).toBe("🥇 <@disc-1> — **4 de idioma**");
        expect(campos["⏱️ Más horas de siempre"]).toBe("🥇 <@disc-1> — **16 h**\n🥈 <@disc-2> — **1 h**");
        // Este mes (el de hoy), nadie: todo lo de la prueba es de mayo de 2026.
        const mes = Object.keys(campos).find((k) => k.startsWith("⏱️ Más horas en "));
        expect(campos[mes]).toBe("Nadie todavía.");
        expect(p.embeds[0].data.footer.text).toMatch(/Quien oculta sus logros de Plex no sale en los de logros/);
    });

    test("sin nadie vinculado, lo dice", async () => {
        const p = await perfilPanel.buildRankings({ ...guild, id: nuevoGuild("vacio") }, "a", "a", "plex");
        expect(p.embeds[0].data.description).toBe("Nadie tiene la cuenta de Plex vinculada todavía.");
        expect(plexRankings.rankings(nuevoGuild("vacio"))).toBeNull();
    });
});
