// Parte 6 del plan de paneles: un solo /perfil con pestañas (Perfil, Economía, Juegos, Logros, Rankings),
// que sustituye a /nivel, /logros y /banco. Viendo el de otro se ve todo, sin acciones, y ningún botón
// lleva al tuyo (E-11).
const fs = require("fs");
const path = require("path");
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const perfil = require("../src/commands/progresion/perfil");
const dineroBotones = require("../src/perfil/dinero");

const G = "guild-p6";
const guild = {
    id: G,
    name: "Servidor",
    members: { cache: new Map(), fetch: async () => null },
    iconURL: () => null,
};
db.prepare("INSERT INTO banco (userId, saldo, enMano) VALUES ('yo', 100, 900), ('otra', 5000, 20)").run();
dinero.apuntar("otra", "tienda", "Compra en tienda: Espada", -200);

const interaccion = (extra = {}) => ({
    guild,
    guildId: G,
    user: { id: "yo", username: "yo", tag: "yo" },
    client: { users: { fetch: async (id) => ({ id, username: id }) } },
    message: { interaction: { user: { id: "yo" } } },
    options: { getUser: () => null, getString: () => null },
    reply: jest.fn(async () => {}),
    update: jest.fn(async () => {}),
    showModal: jest.fn(async () => {}),
    ...extra,
});
const ids = (payload) => payload.components.flatMap((r) => (r.toJSON ? r.toJSON() : r).components.map((c) => c.custom_id));
const pestanas = (payload) =>
    (payload.components.at(-1).toJSON ? payload.components.at(-1).toJSON() : payload.components.at(-1)).components;
const sinRepetidos = (payload) => {
    const lista = ids(payload);
    expect(lista.filter((id, n) => lista.indexOf(id) !== n)).toEqual([]);
};

async function abrir(seccion, usuario = null) {
    const i = interaccion({ options: { getUser: () => usuario, getString: () => seccion } });
    await perfil.run(null, i);
    return i.reply.mock.calls[0][0];
}

test("las cinco pestañas, con la actual resaltada, en todas las pantallas", async () => {
    const esperadas = [
        "perfil_ver_yo_yo",
        "perfil_eco_yo_yo",
        "perfil_juegos_yo_yo",
        "perfil_logros_yo_yo_0_0_tab",
        "perfil_rank_yo_yo_nivel_0_tab",
    ];
    for (const [seccion, actual] of [
        ["perfil", 0],
        ["eco", 1],
        ["logros", 3],
        ["rankings", 4],
    ]) {
        const payload = await abrir(seccion);
        const fila = pestanas(payload);
        expect(fila.map((b) => b.custom_id)).toEqual(esperadas);
        expect(fila.map((b) => b.style)).toEqual(esperadas.map((_, n) => (n === actual ? 1 : 2)));
        sinRepetidos(payload);
    }
});

test("en tu Economía hay acciones; en la de otra persona se ve todo pero sin acciones (D1)", async () => {
    const propia = await abrir("eco");
    expect(ids(propia)).toEqual(expect.arrayContaining(["dinero_ingresar", "dinero_sacar", "dinero_transferir", "dinero_mov_todo_0_yo"]));

    const ajena = await abrir("eco", { id: "otra" });
    const campos = Object.fromEntries(ajena.embeds[0].data.fields.map((f) => [f.name, f.value]));
    expect(campos["🏦 Banco"]).toMatch(/5[.,]?000/);
    expect(ids(ajena)).not.toContain("dinero_ingresar");
    // Todas las pestañas llevan a su perfil, no al tuyo (E-11).
    expect(pestanas(ajena).every((b) => b.custom_id.includes("_yo_otra"))).toBe(true);

    // Sus movimientos, y "◀ Economía" vuelve a la suya.
    const mov = interaccion({ customId: "dinero_mov_todo_0_otra" });
    await dineroBotones.handleButton(null, mov);
    const payload = mov.update.mock.calls[0][0];
    expect(payload.embeds[0].data.description).toMatch(/Compra en tienda: Espada/);
    expect(ids(payload)).toContain("perfil_eco_yo_otra");
});

test("los logros de otra persona se ven, pero solo se reclaman los tuyos", async () => {
    const ajenos = await abrir("logros", { id: "otra" });
    expect(ids(ajenos).some((id) => id.startsWith("perfil_reclamar"))).toBe(false);
    expect(ids(ajenos)).not.toContain("perfil_reclamartodo_yo_otra");
});

test("rankings: uno por pantalla con un menú, y el de nivel con páginas", async () => {
    for (const tipo of ["nivel", "riqueza", "casino", "logros", "ttcl"]) {
        const i = interaccion({ customId: "perfil_ranksel_yo_yo", values: [tipo] });
        await perfil.handleSelect(null, i);
        const payload = i.update.mock.calls[0][0];
        expect(payload.embeds[0].data.title).toBeTruthy();
        sinRepetidos(payload);
    }
    const riqueza = interaccion({ customId: "perfil_ranksel_yo_yo", values: ["riqueza"] });
    await perfil.handleSelect(null, riqueza);
    expect(riqueza.update.mock.calls[0][0].embeds[0].data.description).toMatch(/<@otra>.*5[.,]?020/);
});

// Discord rechaza un mensaje con dos botones con el mismo customId (COMPONENT_CUSTOM_ID_DUPLICATED). Pasó en producción
// con ◀ a la página 1 de logros, 🙈 Ocultar secretos y ⏮️ del ranking, que eran iguales que las pestañas Logros y
// Rankings. Se pulsa cada botón de esas pantallas (con y sin logros por reclamar) y se revisa lo que sale.
describe("ninguna pantalla de logros o rankings repite un customId", () => {
    const pulsar = async (customId) => {
        const i = interaccion({ customId });
        await perfil.handleButton(null, i);
        expect(i.reply).not.toHaveBeenCalled();
        return i.update.mock.calls[0][0];
    };
    // Todos los botones de una pantalla, pulsados uno a uno (sin los desactivados), y lo que sale, revisado.
    async function recorrer(customId, vistos = new Set()) {
        if (vistos.has(customId)) return;
        vistos.add(customId);
        const payload = await pulsar(customId);
        sinRepetidos(payload);
        const botones = payload.components
            .flatMap((r) => (r.toJSON ? r.toJSON() : r).components)
            .filter((c) => c.type === 2 && !c.disabled && /^perfil_(logros|rank)_/.test(c.custom_id));
        for (const b of botones) await recorrer(b.custom_id, vistos);
        return vistos;
    }

    test("los botones del log de producción", async () => {
        for (const id of ["perfil_logros_yo_yo_1_0", "perfil_logros_yo_yo_0_1", "perfil_rank_yo_yo_nivel_1"])
            sinRepetidos(await pulsar(id));
    });

    test("logros: todas las páginas, con y sin secretos, sin y con logros por reclamar", async () => {
        const sinReclamar = await recorrer("perfil_logros_yo_yo_0_0_tab");
        expect(sinReclamar.size).toBeGreaterThan(10);
        db.prepare(
            "INSERT INTO achievements_progress (guildId, userId, achievementId, progress, completedAt) VALUES (?, 'yo', 'primer_mensaje', 1, ?)",
        ).run(G, Date.now());
        const conReclamar = await pulsar("perfil_logros_yo_yo_1_1");
        expect(ids(conReclamar).some((id) => id.startsWith("perfil_reclamar_"))).toBe(true);
        await recorrer("perfil_logros_yo_yo_0_0_tab");
    });

    test("rankings: la pestaña y las páginas del de nivel", async () => {
        await recorrer("perfil_rank_yo_yo_nivel_0_tab");
        sinRepetidos(await pulsar("perfil_rank_yo_yo_nivel_2"));
    });

    test("los ids de las pestañas de mensajes ya enviados (sin _tab) siguen funcionando", async () => {
        expect((await pulsar("perfil_logros_yo_yo_0_0")).embeds[0].data.title).toMatch(/logros/i);
        expect((await pulsar("perfil_rank_yo_yo_nivel_0")).embeds[0].data.title).toBeTruthy();
    });
});

test("los botones de mensajes antiguos (/nivel, /logros, /perfil anterior) llevan a su pestaña", async () => {
    for (const [id, titulo] of [
        ["nivel_profile_yo_yo", /Nivel/],
        ["nivel_eco_yo_yo", /Economía/],
        ["perfil_top_yo_0", /Clasificación/],
        ["logros_page_1", /logros/i],
        ["perfil_casino_yo", /Casino/],
    ]) {
        const i = interaccion({ customId: id });
        await perfil.handleButton(null, i);
        expect(i.update.mock.calls[0][0].embeds[0].data.title).toMatch(titulo);
    }
});

test("solo quien abrió el perfil usa sus botones", async () => {
    const i = interaccion({ customId: "perfil_eco_otra_otra", user: { id: "yo", username: "yo" } });
    await perfil.handleButton(null, i);
    expect(i.update).not.toHaveBeenCalled();
});

test("/nivel, /logros y /banco ya no son comandos; /perfil sí", () => {
    const nombres = [];
    const walk = (d) =>
        fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
            const p = path.join(d, e.name);
            if (e.isDirectory()) walk(p);
            else if (e.name.endsWith(".js") && require(p).data) nombres.push(require(p).data.name);
        });
    walk(path.join(__dirname, "../src/commands"));
    expect(nombres).toContain("perfil");
    for (const viejo of ["nivel", "logros", "banco"]) expect(nombres).not.toContain(viejo);
});
