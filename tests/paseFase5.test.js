// 🛡️ Pase de batalla, fase 5: topes de hoy (#331), posición en el top (#332), día perfecto (#334), racha (#335), misiones de tienda y de logro
// (#338), historial de temporadas (#300), aviso de recompensas sin cobrar (#348), anuncio de nivel (#344), ajustes de admin (#353), XP por
// retos ganados (#359) y objetos por nivel (#364). BD en memoria; el reloj se pasa a mano (`ahora`).
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const guildSettings = require("../src/systems/guildSettings");
const avisosDm = require("../src/systems/avisosDm");
const pase = require("../src/systems/pase/pase");
const { misionesDeHoy } = require("../src/systems/pase/misiones");
const { rachaHasta } = require("../src/systems/pase/rachas");
const historial = require("../src/systems/pase/historial");
const avisos = require("../src/systems/pase/avisos");
const constantes = require("../src/systems/pase/constantes");
const retos = require("../src/systems/retos");
const { pantallaPase } = require("../src/paneles/pase");
const paseCmd = require("../src/commands/progresion/pase");
const admin = require("../src/adminPanel/pase");

const DIA = 86400 * 1000;
const ORIGEN = Date.UTC(2026, 9, 1);
const HOY = ORIGEN + 3600 * 1000; // 1 de octubre, 03:00 en Madrid: temporada 0, día 0
const dia = (k) => HOY + k * DIA;
let n = 0;
const G = () => `g-pase5-${++n}`;
const persona = () => `p5-${++n}`;
const descripcion = (p) => p.embeds[0].data.description;

function cliente(guilds = []) {
    const enviados = [];
    return {
        enviados,
        guilds: { cache: new Map(guilds.map((g) => [g.id, g])) },
        users: { fetch: async (id) => ({ send: jest.fn(async (p) => enviados.push([id, p.content])) }) },
    };
}
/** Completa las tres misiones de ese día. */
function completarDia(g, u, ahora) {
    for (const m of misionesDeHoy(ahora)) pase.registrar(g, u, m.categoria, m.meta, ahora);
}
const xp = (g, u, ahora = HOY) => pase.estado(g, u, ahora).xp;

describe("topes de hoy (#331)", () => {
    test("cada categoría enseña lo usado y su tope, y una al tope aparece llena sin pasarse", () => {
        const g = G();
        const u = persona();
        for (let i = 0; i < 80; i++) pase.registrar(g, u, "mensaje", 1, HOY); // 120 de tope
        pase.registrar(g, u, "tienda", 1, HOY); // 8 de 80
        const topes = Object.fromEntries(pase.topesDeHoy(g, u, HOY).map((t) => [t.categoria, t]));
        expect(topes.mensaje).toEqual({ categoria: "mensaje", usado: 120, tope: 120, lleno: true });
        expect(topes.tienda).toMatchObject({ usado: 8, tope: 80, lleno: false });
        expect(topes.reto).toMatchObject({ usado: 0, tope: 90, lleno: false });
        expect(Object.keys(topes)).toEqual(Object.keys(constantes.CATEGORIAS));
        // Al día siguiente, desde cero.
        expect(pase.topesDeHoy(g, u, dia(1)).find((t) => t.categoria === "mensaje").usado).toBe(0);
    });

    test("la vista 📊 Topes lo pinta con «usado / tope» y marca las llenas", () => {
        const g = G();
        const u = persona();
        for (let i = 0; i < 80; i++) pase.registrar(g, u, "mensaje", 1, HOY);
        const texto = descripcion(pantallaPase(g, u, "topes", { ahora: HOY }));
        expect(texto).toMatch(/🔴 💬 Mensajes: \*\*120 \/ 120\*\* XP · tope alcanzado/);
        expect(texto).toMatch(/🟢 🛒 Tienda: \*\*0 \/ 80\*\* XP · quedan 80/);
    });

    test("los botones de vistas caben (5 + 1) y el de topes está", () => {
        const p = pantallaPase(G(), persona(), "resumen", { ahora: HOY });
        const ids = p.components.slice(1).flatMap((f) => f.components.map((b) => b.data.custom_id));
        expect(ids).toEqual([
            "pase_vista_resumen",
            "pase_vista_niveles",
            "pase_vista_misiones",
            "pase_vista_top",
            "pase_vista_topes",
            "pase_vista_historial",
        ]);
    });
});

describe("tu posición en el top (#332)", () => {
    function liga(g, cantidad) {
        const ids = Array.from({ length: cantidad }, (_, i) => `pos-${String(i).padStart(2, "0")}`);
        ids.forEach((id, i) =>
            db.prepare("INSERT INTO pase_progreso (guildId, temporada, userId, xp) VALUES (?, 0, ?, ?)").run(g, id, 1000 - i * 10),
        );
        return ids;
    }

    test("dentro del top 10 no sale la línea extra; fuera, el puesto real y lo que falta para entrar", () => {
        const g = G();
        const ids = liga(g, 14); // 1000, 990, ... 870: el 10.º tiene 910
        expect(pase.posicionDe(g, ids[3], 10, HOY)).toEqual({ puesto: 4, xp: 970, faltan: 0 });
        expect(descripcion(pantallaPase(g, ids[3], "top", { ahora: HOY }))).not.toMatch(/Tu posición/);
        expect(pase.posicionDe(g, ids[13], 10, HOY)).toEqual({ puesto: 14, xp: 870, faltan: 41 }); // hay que superar los 910
        expect(descripcion(pantallaPase(g, ids[13], "top", { ahora: HOY }))).toMatch(
            /Tu posición: \*\*#14\*\* · 870 XP\. Te faltan \*\*41\*\* XP para entrar en el top 10/,
        );
    });

    test("con 0 XP, «sin puesto todavía»; y a igualdad de XP manda el id, como en el top", () => {
        const g = G();
        liga(g, 12);
        const nadie = persona();
        expect(pase.posicionDe(g, nadie, 10, HOY).puesto).toBeNull();
        expect(descripcion(pantallaPase(g, nadie, "top", { ahora: HOY }))).toMatch(/sin puesto todavía/);
        const gg = G();
        for (const [id, x] of [
            ["a", 50],
            ["b", 50],
            ["c", 50],
        ])
            db.prepare("INSERT INTO pase_progreso (guildId, temporada, userId, xp) VALUES (?, 0, ?, ?)").run(gg, id, x);
        expect(pase.posicionDe(gg, "b", 1, HOY)).toMatchObject({ puesto: 2, faltan: 1 }); // «a» va antes: hace falta un punto más
        expect(pase.posicionDe(gg, "a", 1, HOY)).toMatchObject({ puesto: 1, faltan: 0 });
        expect(pase.top(gg, 3, HOY).map((t) => t.userId)).toEqual(["a", "b", "c"]);
    });
});

describe("misiones de tienda y de logro (#338)", () => {
    test("con 7 en el pool y 3 al día, rotan todas, sin repetirse el mismo día", () => {
        const vistas = new Set();
        for (let k = 0; k < 7; k++) {
            const hoy = misionesDeHoy(dia(k));
            expect(new Set(hoy.map((m) => m.id)).size).toBe(3);
            hoy.forEach((m) => vistas.add(m.id));
        }
        expect([...vistas].sort()).toEqual(constantes.MISIONES.map((m) => m.id).sort());
        expect(misionesDeHoy(HOY).map((m) => m.id)).toEqual(["mensajes", "voz", "casino"]);
        expect(misionesDeHoy(dia(5)).map((m) => m.id)).toEqual(["tienda", "logro", "mensajes"]);
    });

    test("comprar en la tienda y completar un logro avanzan sus misiones los días que tocan", () => {
        const g = G();
        const u = persona();
        const ahora = dia(5); // tienda, logro y mensajes
        pase.registrar(g, u, "tienda", 1, ahora);
        pase.registrar(g, u, "logro", 1, ahora);
        const misiones = pase.estado(g, u, ahora).misiones;
        expect(misiones.find((m) => m.id === "tienda")).toMatchObject({ progreso: 1, completada: true });
        expect(misiones.find((m) => m.id === "logro")).toMatchObject({ progreso: 1, completada: true });
        // XP de las categorías (8 + 20) y de las dos misiones.
        expect(xp(g, u, ahora)).toBe(8 + 20 + 2 * constantes.MISION_XP);
        // Un día en que no tocan, solo da la XP de la categoría.
        const v = persona();
        pase.registrar(g, v, "tienda", 1, HOY);
        expect(xp(g, v, HOY)).toBe(8);
    });
});

describe("día perfecto (#334)", () => {
    test("las tres misiones dan el bonus una sola vez por día; con dos no se da nada", () => {
        const g = G();
        const u = persona();
        const [m1, m2, m3] = misionesDeHoy(HOY);
        pase.registrar(g, u, m1.categoria, m1.meta, HOY);
        pase.registrar(g, u, m2.categoria, m2.meta, HOY);
        const conDos = xp(g, u);
        expect(pase.estado(g, u, HOY).racha).toEqual({ dias: 0, hoyPerfecto: false });
        pase.registrar(g, u, m3.categoria, m3.meta, HOY);
        const conTres = xp(g, u);
        const categorias = [m1, m2, m3].reduce((s, m) => s + constantes.CATEGORIAS[m.categoria].xp * m.meta, 0);
        expect(conTres).toBe(categorias + 3 * constantes.MISION_XP + constantes.BONUS_DIA_PERFECTO);
        expect(conTres - conDos).toBeGreaterThanOrEqual(constantes.MISION_XP + constantes.BONUS_DIA_PERFECTO);
        // Más actividad ese día no repite el bonus.
        pase.registrar(g, u, m3.categoria, 1, HOY);
        expect(xp(g, u) - conTres).toBeLessThan(constantes.BONUS_DIA_PERFECTO);
        expect(db.prepare("SELECT COUNT(*) AS n FROM pase_dias_perfectos WHERE guildId = ? AND userId = ?").get(g, u).n).toBe(1);
        // Al día siguiente, otra vez.
        completarDia(g, u, dia(1));
        expect(db.prepare("SELECT COUNT(*) AS n FROM pase_dias_perfectos WHERE guildId = ? AND userId = ?").get(g, u).n).toBe(2);
    });

    test("la vista de misiones enseña el día perfecto y la racha", () => {
        const g = G();
        const u = persona();
        const antes = pantallaPase(g, u, "misiones", { ahora: HOY }).embeds[0].data.fields.find((f) => f.name === "Día perfecto").value;
        expect(antes).toMatch(/⬜ \*\*Día perfecto\*\* \(las tres misiones\): \+100 XP/);
        completarDia(g, u, HOY);
        const despues = pantallaPase(g, u, "misiones", { ahora: HOY }).embeds[0].data.fields.find((f) => f.name === "Día perfecto").value;
        expect(despues).toMatch(/✅ \*\*Día perfecto\*\*/);
        expect(despues).toMatch(/Racha:\*\* 1 día seguidos/);
    });
});

describe("racha de días perfectos (#335)", () => {
    test("cuenta días seguidos del calendario de Madrid y un día sin las tres la reinicia", () => {
        expect(rachaHasta(["2026-10-03", "2026-10-02", "2026-10-01"], "2026-10-03")).toBe(3);
        expect(rachaHasta(["2026-10-03", "2026-10-01"], "2026-10-03")).toBe(1);
        expect(rachaHasta(["2026-10-02"], "2026-10-03")).toBe(0);
        expect(rachaHasta(["2026-11-01", "2026-10-31"], "2026-11-01")).toBe(2); // cruza de mes
    });

    test("al llegar a 3 y a 7 días da XP extra, una sola vez por racha", () => {
        const g = G();
        const u = persona();
        const extra = (k) => {
            const antes = xp(g, u, dia(k));
            completarDia(g, u, dia(k));
            const base = misionesDeHoy(dia(k)).reduce((s, m) => s + constantes.CATEGORIAS[m.categoria].xp * m.meta, 0);
            return xp(g, u, dia(k)) - antes - base - 3 * constantes.MISION_XP - constantes.BONUS_DIA_PERFECTO;
        };
        expect([extra(0), extra(1), extra(2)]).toEqual([0, 0, 100]); // el tercer día: +100
        expect([extra(3), extra(4), extra(5)]).toEqual([0, 0, 0]);
        expect(extra(6)).toBe(250); // el séptimo seguido: +250
        expect(extra(7)).toBe(0); // y la racha de 8 no repite
        expect(pase.estado(g, u, dia(7)).racha).toEqual({ dias: 8, hoyPerfecto: true });
    });

    test("un día sin las tres reinicia la racha, y la siguiente puede volver a ganar el premio", () => {
        const g = G();
        const u = persona();
        for (const k of [0, 1, 2]) completarDia(g, u, dia(k)); // racha de 3: +100
        expect(db.prepare("SELECT COUNT(*) AS n FROM pase_racha_premios WHERE userId = ?").get(u).n).toBe(1);
        // El día 3 solo hace una misión; el 4, 5 y 6 las tres: otra racha de 3 con su premio.
        pase.registrar(g, u, misionesDeHoy(dia(3))[0].categoria, 1, dia(3));
        expect(pase.estado(g, u, dia(3)).racha).toEqual({ dias: 3, hoyPerfecto: false }); // sigue viva hasta que acabe el día
        expect(pase.estado(g, u, dia(4)).racha).toEqual({ dias: 0, hoyPerfecto: false }); // y el día sin las tres la reinicia
        for (const k of [4, 5, 6]) completarDia(g, u, dia(k));
        expect(db.prepare("SELECT COUNT(*) AS n FROM pase_racha_premios WHERE userId = ?").get(u).n).toBe(2);
    });

    test("la racha sigue viva hasta que acaba el día, y sigue aunque cambie la temporada", () => {
        const g = G();
        const u = persona();
        completarDia(g, u, dia(13));
        completarDia(g, u, dia(14)); // el último día de la temporada 0
        expect(pase.estado(g, u, dia(15)).racha).toEqual({ dias: 2, hoyPerfecto: false }); // ya en la temporada 1, hoy sin hacer
        completarDia(g, u, dia(15));
        expect(pase.estado(g, u, dia(15)).racha).toEqual({ dias: 3, hoyPerfecto: true });
        expect(pase.estado(g, u, dia(17)).racha.dias).toBe(0);
    });

    test("el resumen enseña la racha", () => {
        const g = G();
        const u = persona();
        completarDia(g, u, HOY);
        const campo = pantallaPase(g, u, "resumen", { ahora: HOY }).embeds[0].data.fields.find((f) => f.name === "🔥 Racha");
        expect(campo.value).toBe("1 día con las tres misiones");
    });
});

describe("anuncio al subir de nivel (#344)", () => {
    const canal = () => ({ name: "pase", isTextBased: () => true, send: jest.fn(async () => {}) });
    const servidor = (id, c) => ({ id, name: id, channels: { cache: new Map(c ? [["c1", c]] : []), fetch: async () => null } });

    test("pase.alSubirDeNivel avisa una vez por subida con el nivel nuevo, y no cuando solo suma XP", () => {
        const g = G();
        const u = persona();
        const subidas = [];
        pase.alSubirDeNivel((s) => s.guildId === g && subidas.push([s.nivel, s.anterior]));
        pase.registrar(g, u, "casino", 3, HOY); // 24 XP: sigue en el nivel 1
        expect(subidas).toEqual([]);
        pase.registrar(g, u, "casino", 40, HOY); // hasta el tope: pasa al nivel 2
        expect(subidas).toEqual([[2, 1]]);
        pase.registrar(g, u, "casino", 1, HOY); // al tope: no suma
        expect(subidas).toHaveLength(1);
    });

    test("publica un mensaje con la mención y el nivel en el canal configurado", async () => {
        const g = G();
        const c = canal();
        guildSettings.setSetting(g, "pase.canal_nivel", "c1");
        const client = cliente([servidor(g, c)]);
        expect(await avisos.anunciarNivel(client, { guildId: g, userId: "ana", temporada: 0, nivel: 5 })).toBe(true);
        expect(c.send).toHaveBeenCalledTimes(1);
        expect(c.send.mock.calls[0][0]).toEqual({
            content: expect.stringMatching(/^🛡️ <@ana> ha subido al \*\*nivel 5\*\* del pase de batalla \(temporada 1\)/),
            allowedMentions: { users: ["ana"] },
        });
    });

    test("sin canal no publica nada ni falla; con un canal que no existe, lo deja en el log y sigue", async () => {
        const g = G();
        const sin = canal();
        expect(await avisos.anunciarNivel(cliente([servidor(g, sin)]), { guildId: g, userId: "ana", temporada: 0, nivel: 2 })).toBe(false);
        expect(sin.send).not.toHaveBeenCalled();
        guildSettings.setSetting(g, "pase.canal_nivel", "no-existe");
        expect(await avisos.anunciarNivel(cliente([servidor(g)]), { guildId: g, userId: "ana", temporada: 0, nivel: 2 })).toBe(false);
        const roto = { ...canal(), send: jest.fn(async () => Promise.reject(new Error("sin permisos"))) };
        guildSettings.setSetting(g, "pase.canal_nivel", "c1");
        expect(await avisos.anunciarNivel(cliente([servidor(g, roto)]), { guildId: g, userId: "ana", temporada: 0, nivel: 2 })).toBe(false);
        // El resto del pase sigue funcionando.
        expect(() => pase.registrarSeguro(g, persona(), "casino", 40, HOY)).not.toThrow();
    });
});

describe("historial de temporadas (#300)", () => {
    function temporadaCerrada(g) {
        const u1 = persona();
        const u2 = persona();
        db.prepare("INSERT INTO pase_progreso (guildId, temporada, userId, xp) VALUES (?, 0, ?, 2000), (?, 0, ?, 300)").run(g, u1, g, u2);
        db.prepare(
            "INSERT INTO pase_recompensas (guildId, temporada, userId, nivel, cobrado_en) VALUES (?, 0, ?, 1, 0), (?, 0, ?, 2, 0)",
        ).run(g, u1, g, u1);
        return [u1, u2];
    }

    test("al cambiar de temporada el resumen se guarda una sola vez, con su top y lo cobrado", () => {
        const g = G();
        const [u1, u2] = temporadaCerrada(g);
        const ya = dia(15); // temporada 1
        expect(historial.temporadasPasadas(g)).toEqual([]);
        expect(historial.cerrarPasadas(ya)).toBeGreaterThanOrEqual(1);
        expect(historial.cerrarPasadas(ya)).toBe(0);
        const r = historial.resumenDe(g, 0);
        expect(r).toMatchObject({ participantes: 2, xp_total: 2300, reclamados: 2, monedas: 80 + 120 });
        expect(r.nivel_max).toBeGreaterThan(5);
        expect(r.top.map((t) => t.userId)).toEqual([u1, u2]);
        expect(db.prepare("SELECT COUNT(*) AS n FROM pase_temporadas WHERE guildId = ?").get(g).n).toBe(1);
    });

    test("la temporada en curso no se cierra, y las pasadas se ven sin tocar las actuales", () => {
        const g = G();
        const u = persona();
        temporadaCerrada(g);
        pase.registrar(g, u, "casino", 5, dia(16)); // temporada 1: la actual
        historial.cerrarPasadas(dia(16));
        expect(historial.resumenDe(g, 1)).toBeNull();
        expect(historial.temporadasPasadas(g).map((t) => t.temporada)).toEqual([0]);
        const enLaActual = db.prepare("SELECT xp FROM pase_progreso WHERE guildId = ? AND userId = ? AND temporada = 1").get(g, u).xp;
        expect(pase.estado(g, u, dia(16)).xp).toBe(enLaActual); // solo cuenta lo de la temporada 1
        expect(enLaActual).toBeGreaterThanOrEqual(40);
        expect(historial.resumenDe(g, 0).participantes).toBe(2);
    });

    test("la vista 🕰️ Historial enseña la última temporada con un menú para elegir otra, y sin ninguna lo dice", () => {
        const sin = pantallaPase(G(), persona(), "historial", { ahora: dia(16) });
        expect(descripcion(sin)).toMatch(/Todavía no ha acabado ninguna temporada/);
        const g = G();
        const [u1] = temporadaCerrada(g);
        const p = pantallaPase(g, persona(), "historial", { ahora: dia(16) });
        expect(p.embeds[0].data.title).toBe("🕰️ Temporada 1");
        expect(descripcion(p)).toMatch(/2\*\* participantes/);
        expect(descripcion(p)).toContain(`<@${u1}>`);
        const menu = p.components.at(-1).components[0];
        expect(menu.data.custom_id).toBe("pase_historial_sel");
        expect(menu.options.map((o) => o.data.value)).toEqual(["0"]);
    });

    test("el menú del historial lleva a la temporada elegida", async () => {
        const g = G();
        temporadaCerrada(g);
        historial.guardarResumen(g, 0); // el reloj del comando es el de verdad: se guarda el resumen a mano
        const i = { customId: "pase_historial_sel", guildId: g, user: { id: "x" }, values: ["0"], update: jest.fn(async () => {}) };
        await paseCmd.handleButton(null, i);
        expect(i.update.mock.calls[0][0].embeds[0].data.title).toBe("🕰️ Temporada 1");
    });
});

describe("aviso de recompensas sin cobrar (#348)", () => {
    const fin0 = ORIGEN + 15 * DIA; // el final de la temporada 0

    test("24 horas antes del final avisa, una sola vez, de cuántas monedas hay y cuándo vence", async () => {
        const g = G();
        const u = persona();
        db.prepare("INSERT INTO pase_progreso (guildId, temporada, userId, xp) VALUES (?, 0, ?, 700)").run(g, u); // nivel 3: 80 + 120 + 160
        const c = cliente([{ id: g, name: "Mi servidor" }]);
        expect(await avisos.avisarSinCobrar(c, fin0 - 30 * 3600 * 1000)).toBe(0); // muy pronto
        expect(c.enviados.filter(([id]) => id === u)).toEqual([]);
        await avisos.avisarSinCobrar(c, fin0 - 12 * 3600 * 1000);
        const suyo = c.enviados.find(([id]) => id === u)[1];
        expect(suyo).toMatch(/3 niveles \(\*\*360\*\* 🪙\)/);
        expect(suyo).toMatch(/en Mi servidor/);
        expect(suyo).toContain(`<t:${Math.floor(fin0 / 1000)}:R>`);
        const otra = cliente([{ id: g, name: "Mi servidor" }]);
        await avisos.avisarSinCobrar(otra, fin0 - 6 * 3600 * 1000);
        expect(otra.enviados.filter(([id]) => id === u)).toEqual([]);
    });

    test("quien ya lo ha cobrado todo, no; y respeta /avisos y el pase desactivado", async () => {
        const g = G();
        const [cobrado, apagado] = [persona(), persona()];
        for (const u of [cobrado, apagado])
            db.prepare("INSERT INTO pase_progreso (guildId, temporada, userId, xp) VALUES (?, 0, ?, 100)").run(g, u);
        db.prepare("INSERT INTO pase_recompensas (guildId, temporada, userId, nivel, cobrado_en) VALUES (?, 0, ?, 1, 0)").run(g, cobrado);
        avisosDm.fijar(apagado, "pase_recompensas", false);
        const c = cliente([{ id: g, name: "S" }]);
        await avisos.avisarSinCobrar(c, fin0 - 3600 * 1000);
        expect(c.enviados.filter(([id]) => [cobrado, apagado].includes(id))).toEqual([]);

        const g2 = G();
        const u = persona();
        db.prepare("INSERT INTO pase_progreso (guildId, temporada, userId, xp) VALUES (?, 0, ?, 100)").run(g2, u);
        guildSettings.setSetting(g2, "pase.activo", false);
        const d = cliente([{ id: g2, name: "S" }]);
        await avisos.avisarSinCobrar(d, fin0 - 3600 * 1000);
        expect(d.enviados.filter(([id]) => id === u)).toEqual([]);
    });
});

describe("ajustes de admin (#353)", () => {
    test("sin ajustes guardados el pase se comporta exactamente como siempre", () => {
        const g = G();
        const u = persona();
        for (let i = 0; i < 80; i++) pase.registrar(g, u, "mensaje", 1, HOY);
        expect(db.prepare("SELECT xp FROM pase_caps WHERE guildId = ? AND userId = ? AND categoria = 'mensaje'").get(g, u).xp).toBe(120);
        expect(pase.xpParaNivel(2)).toBe(280);
        expect(pase.estado(g, u, HOY).xpSiguiente).toBe(280);
    });

    test("cambiar el tope de «mensaje» aplica al siguiente mensaje, sin reiniciar", () => {
        const g = G();
        const u = persona();
        guildSettings.setSetting(g, "pase.tope_mensaje", 10);
        let total = 0;
        for (let i = 0; i < 20; i++) total += pase.registrar(g, u, "mensaje", 1, HOY);
        expect(total).toBe(10);
        guildSettings.setSetting(g, "pase.tope_mensaje", 30);
        expect(pase.registrar(g, u, "mensaje", 1, HOY)).toBe(2);
        expect(pase.topesDeHoy(g, u, HOY).find((t) => t.categoria === "mensaje")).toMatchObject({ tope: 30 });
    });

    test("la XP por nivel cambia la curva (y los niveles) del servidor", () => {
        const g = G();
        const u = persona();
        guildSettings.setManySettings(g, { "pase.xp_nivel_base": 100, "pase.xp_nivel_paso": 0 });
        pase.registrar(g, u, "casino", 13, HOY); // 104 XP
        expect(pase.estado(g, u, HOY).nivel).toBe(2);
        expect(pase.estado(g, u, HOY).xpSiguiente).toBe(200);
        expect(pase.top(g, 5, HOY)[0].nivel).toBe(2);
    });

    test("con el pase desactivado, registrar no suma y /pase no responde con datos", async () => {
        const g = G();
        const u = persona();
        guildSettings.setSetting(g, "pase.activo", false);
        expect(pase.registrar(g, u, "casino", 5, HOY)).toBe(0);
        expect(xp(g, u)).toBe(0);
        const p = pantallaPase(g, u);
        expect(p).toEqual({ content: "🛡️ El pase de batalla está desactivado en este servidor.", embeds: [], components: [] });
        const i = { guildId: g, user: { id: u }, reply: jest.fn(async () => {}) };
        await paseCmd.run(null, i);
        expect(i.reply.mock.calls[0][0].content).toMatch(/desactivado/);
    });

    describe("el panel", () => {
        const interaccion = (customId, extra = {}) => ({
            customId,
            user: { id: "admin", tag: "admin#1" },
            values: [],
            update: jest.fn(async () => {}),
            reply: jest.fn(async () => {}),
            showModal: jest.fn(async () => {}),
            isFromMessage: () => false,
            ...extra,
        });
        const campos = (valores) => ({ getTextInputValue: (id) => valores[id] ?? "" });

        test("la pantalla enseña el estado, los topes (y los cambiados) y los botones", () => {
            const g = G();
            guildSettings.setSetting(g, "pase.tope_casino", 100);
            const p = admin.buildPaseHome(g);
            expect(p.embeds[0].data.description).toMatch(/🟢 \*\*activo\*\*/);
            expect(p.embeds[0].data.description).toMatch(/🎰 Casino: \*\*100\*\* XP\/día \(por defecto 260\)/);
            expect(p.embeds[0].data.description).toMatch(/💬 Mensajes: \*\*120\*\* XP\/día\n/);
            expect(p.components[0].components.map((b) => b.data.custom_id)).toEqual([
                "paneladmin_pase_activo",
                "paneladmin_pase_topes",
                "paneladmin_pase_curva",
                "paneladmin_pase_objetos",
                "paneladmin_home",
            ]);
            expect(p.components[1].components[0].data.custom_id).toBe("paneladmin_pase_canal_select");
        });

        test("activar y desactivar, el selector de topes y el formulario de un tope", async () => {
            const g = G();
            const off = interaccion("paneladmin_pase_activo", { guildId: g });
            await admin.handlePaseButton(off);
            expect(guildSettings.getSettings(g).pase.activo).toBe(false);
            expect(off.update.mock.calls[0][0].embeds[0].data.description).toMatch(/🔴 \*\*desactivado\*\*/);
            await admin.handlePaseButton(interaccion("paneladmin_pase_activo", { guildId: g, update: jest.fn() }));
            expect(guildSettings.getSettings(g).pase.activo).toBe(true);

            const topes = interaccion("paneladmin_pase_topes", { guildId: g });
            await admin.handlePaseButton(topes);
            const menu = topes.reply.mock.calls[0][0].components[0].components[0];
            expect(menu.options.map((o) => o.data.value)).toEqual(Object.keys(constantes.CATEGORIAS));
            const sel = interaccion("paneladmin_pase_tope_sel", { guildId: g, values: ["mensaje"] });
            expect(await admin.handlePaseStringSelect(sel)).toBe(true);
            expect(sel.showModal.mock.calls[0][0].toJSON().custom_id).toBe("paneladmin_pase_modal_tope_mensaje");

            const guarda = interaccion("paneladmin_pase_modal_tope_mensaje", { guildId: g, fields: campos({ tope: "40" }) });
            expect(await admin.handlePaseModal(guarda)).toBe(true);
            expect(guildSettings.getSettings(g).pase.topes.mensaje).toBe(40);
            for (const mal of ["", "-3", "abc", "1.5", "999999"]) {
                const r = interaccion("paneladmin_pase_modal_tope_mensaje", { guildId: g, fields: campos({ tope: mal }) });
                await admin.handlePaseModal(r);
                expect(r.reply.mock.calls[0][0].content).toMatch(/^❌ El tope es un número entero de 0 a 100000/);
            }
            expect(guildSettings.getSettings(g).pase.topes.mensaje).toBe(40);
        });

        test("el formulario de la curva, con su rango", async () => {
            const g = G();
            const ok = interaccion("paneladmin_pase_modal_curva", { guildId: g, fields: campos({ base: "200", paso: "10" }) });
            await admin.handlePaseModal(ok);
            expect(guildSettings.getSettings(g).pase).toMatchObject({ xp_nivel_base: 200, xp_nivel_paso: 10 });
            const mal = interaccion("paneladmin_pase_modal_curva", { guildId: g, fields: campos({ base: "0", paso: "10" }) });
            await admin.handlePaseModal(mal);
            expect(mal.reply.mock.calls[0][0].content).toMatch(/^❌ La XP del primer nivel/);
            expect(guildSettings.getSettings(g).pase.xp_nivel_base).toBe(200);
        });

        test("el canal de anuncios se elige y se quita con el selector", async () => {
            const g = G();
            const pon = interaccion("paneladmin_pase_canal_select", { guildId: g, values: ["c9"] });
            expect(await admin.handlePaseChannelSelect(pon)).toBe(true);
            expect(guildSettings.getSettings(g).pase.canal_nivel).toBe("c9");
            await admin.handlePaseChannelSelect(interaccion("paneladmin_pase_canal_select", { guildId: g, values: [] }));
            expect(guildSettings.getSettings(g).pase.canal_nivel).toBe("");
            expect(await admin.handlePaseChannelSelect(interaccion("otro", { guildId: g }))).toBe(false);
        });
    });
});

describe("XP de pase por retos ganados (#359)", () => {
    const G5 = "g-pase5-retos";
    function jugador() {
        const id = persona();
        dinero.asegurarCuenta(id);
        db.prepare("UPDATE banco SET enMano = 1000 WHERE userId = ?").run(id);
        return id;
    }
    const xpReto = (u) => db.prepare("SELECT COALESCE(SUM(xp), 0) AS xp FROM pase_caps WHERE userId = ? AND categoria = 'reto'").get(u).xp;

    test("el ganador de un duelo suma la XP de «reto»; el que pierde no", () => {
        const [a, b] = [jugador(), jugador()];
        const { reto } = retos.crearDuelo({ creador: a, rival: b, juego: "ppt", cantidad: 100, guildId: G5 });
        retos.aceptar(reto.id, b);
        retos.jugarPpt(reto.id, a, "piedra");
        retos.jugarPpt(reto.id, b, "tijera"); // gana a
        expect(retos.obtener(reto.id).estado).toBe("resuelto");
        expect(xpReto(a)).toBe(constantes.CATEGORIAS.reto.xp);
        expect(xpReto(b)).toBe(0);
    });

    test("un reto devuelto no da XP, ni uno contra el Duende", () => {
        const [a, b] = [jugador(), jugador()];
        const { reto } = retos.crearDuelo({ creador: a, rival: b, juego: "ppt", cantidad: 100, guildId: G5 });
        retos.aceptar(reto.id, b);
        retos.rendirse(reto.id, a); // se rinde: gana b
        expect(xpReto(b)).toBe(constantes.CATEGORIAS.reto.xp);
        const [c, d] = [jugador(), jugador()];
        const devuelto = retos.crearDuelo({ creador: c, rival: d, juego: "ppt", cantidad: 100, guildId: G5 }).reto;
        retos.rechazar(devuelto.id, d);
        expect(xpReto(c) + xpReto(d)).toBe(0);
        const contraDuende = retos.crearContraDuende({ userId: c, cantidad: 100, guildId: G5 }).reto;
        retos.jugarPpt(contraDuende.id, c, "piedra");
        expect(xpReto(c)).toBe(0);
    });

    test("el tope diario de «reto» se respeta", () => {
        const g = G();
        const u = persona();
        let total = 0;
        for (let i = 0; i < 10; i++) total += pase.registrar(g, u, "reto", 1, HOY);
        expect(total).toBe(constantes.CATEGORIAS.reto.tope);
    });
});

describe("objetos por nivel (#364)", () => {
    function objeto(nombre) {
        return Number(
            db.prepare("INSERT INTO objeto (nombre, descripcion, tipo) VALUES (?, 'x', 'coleccionable')").run(`${nombre}-${++n}`)
                .lastInsertRowid,
        );
    }
    const enInventario = (u, id) => db.prepare("SELECT COUNT(*) AS n FROM inventario WHERE userId = ? AND itemId = ?").get(u, id).n;

    test("un nivel con objeto lo deja en el inventario al reclamar, junto con sus monedas, y no se duplica", () => {
        const g = G();
        const u = persona();
        const id = objeto("Medalla");
        guildSettings.setSetting(g, "pase.objetos", JSON.stringify({ 2: id }));
        pase.registrar(g, u, "casino", 40, HOY); // nivel 2
        const antes = dinero.efectivo(u);
        const r = pase.reclamar(g, u, HOY);
        expect(r).toMatchObject({ ok: true, monedas: 200, niveles: [1, 2] });
        expect(r.objetos.map((o) => o.id)).toEqual([id]);
        expect(dinero.efectivo(u)).toBe(antes + 200);
        expect(enInventario(u, id)).toBe(1);
        expect(pase.reclamar(g, u, HOY).ok).toBe(false);
        expect(enInventario(u, id)).toBe(1);
    });

    test("sin objetos configurados, reclamar devuelve lo de siempre; un objeto borrado del catálogo se ignora", () => {
        const g = G();
        const u = persona();
        expect(pase.reclamar(g, u, HOY)).toEqual({ ok: true, monedas: 80, niveles: [1] });
        const h = G();
        const v = persona();
        guildSettings.setSetting(h, "pase.objetos", JSON.stringify({ 1: 987654 }));
        expect(pase.reclamar(h, v, HOY)).toEqual({ ok: true, monedas: 80, niveles: [1] });
    });

    test("la vista de niveles muestra el objeto con su nombre antes de reclamar, y el aviso de reclamar lo cuenta", async () => {
        const g = G();
        const u = persona();
        const id = objeto("Escudo");
        const nombre = db.prepare("SELECT nombre FROM objeto WHERE id = ?").get(id).nombre;
        guildSettings.setSetting(g, "pase.objetos", JSON.stringify({ 1: id }));
        const campos = pantallaPase(g, u, "niveles", { ahora: HOY })
            .embeds[0].data.fields.map((f) => f.value)
            .join("\n");
        expect(campos).toContain(`🎁 **Nivel 1** · 80 🪙 + 🎒 ${nombre}`);
        const i = { customId: "pase_reclamar", guildId: g, user: { id: u }, update: jest.fn(async () => {}) };
        await paseCmd.handleButton(null, i);
        expect(descripcion(i.update.mock.calls[0][0])).toContain(`🎁 Cobrado **80** 🪙 y 🎒 ${nombre} (niveles 1).`);
    });

    test("el formulario de objetos entiende «nivel:nombre», rechaza lo que no existe y vacío los quita", async () => {
        const g = G();
        const id = objeto("Candado raro");
        const nombre = db.prepare("SELECT nombre FROM objeto WHERE id = ?").get(id).nombre;
        expect(admin.leerObjetos(`5: ${nombre.toLowerCase()}, 10:${nombre}`)).toEqual({ ok: true, objetos: { 5: id, 10: id } });
        expect(admin.leerObjetos("").objetos).toEqual({});
        expect(admin.leerObjetos("21:x").mensaje).toMatch(/nivel 21 no existe/);
        expect(admin.leerObjetos("5:no-existe-nada").mensaje).toMatch(/No hay ningún objeto/);
        expect(admin.leerObjetos("cinco").mensaje).toMatch(/formato nivel:objeto/);
        const i = (texto) => ({
            customId: "paneladmin_pase_modal_objetos",
            guildId: g,
            user: { id: "admin" },
            fields: { getTextInputValue: () => texto },
            isFromMessage: () => false,
            reply: jest.fn(async () => {}),
        });
        await admin.handlePaseModal(i(`3:${nombre}`));
        expect(JSON.parse(guildSettings.getSettings(g).pase.objetos)).toEqual({ 3: id });
        await admin.handlePaseModal(i(""));
        expect(guildSettings.getSettings(g).pase.objetos).toBe("");
        const mal = i("3:nada de nada");
        await admin.handlePaseModal(mal);
        expect(mal.reply.mock.calls[0][0].content).toMatch(/No hay ningún objeto/);
    });
});
