// Duelos de ⚔️ Retos: rendirse (#446), doblar en el blackjack (#444), duelos abiertos (#438) y al mejor de tres (#436). El
// blackjack usa `setRng(() => 0)`: la baraja sale en orden (2♠ 3♠ al creador = 5, 4♠ 5♠ al rival = 9, luego 6♠, 7♠, 8♠...).
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const retos = require("../src/systems/retos");
const paneles = require("../src/paneles/retos");
const botones = require("../src/juegos/retos/retos");

let n = 0;
/** Dos personas nuevas con el efectivo inicial (1.000). */
const par = () => {
    n++;
    return [`duelo-a${n}`, `duelo-b${n}`];
};
const efectivo = (id) => dinero.efectivo(id);
const secuencia = (...vals) => {
    let i = 0;
    return () => vals[i++ % vals.length];
};
const duelo = (juego, extra = {}) => {
    const [a, b] = par();
    const { reto } = retos.crearDuelo({ creador: a, rival: b, juego, cantidad: 100, ...extra });
    return { a, b, reto };
};
const enJuego = (juego, extra = {}) => {
    const d = duelo(juego, extra);
    const r = retos.aceptar(d.reto.id, d.b);
    return { ...d, reto: r.reto };
};
const texto = (reto) => paneles.mensajeReto(reto).embeds[0].toJSON().description;
const idsDe = (payload) => payload.components.flatMap((f) => (f.toJSON ? f.toJSON() : f).components.map((c) => c.custom_id));

afterEach(() => retos.__test.setRng(null));

describe("rendirse (#446)", () => {
    test("el rival cobra el bote completo, el mensaje dice quién se ha rendido y el duelo no admite más jugadas", () => {
        const { a, b, reto } = enJuego("ppt");
        const r = retos.rendirse(reto.id, a);
        expect(r.ok).toBe(true);
        expect(r.reto).toMatchObject({ estado: "resuelto", resultado: `🏳️ <@${a}> se ha rendido` });
        expect(efectivo(b)).toBe(1100);
        expect(efectivo(a)).toBe(900);
        expect(texto(r.reto)).toContain(`🏳️ <@${a}> se ha rendido`);
        expect(texto(r.reto)).toContain(`Gana <@${b}> y se lleva **200**`);

        expect(retos.jugarPpt(reto.id, b, "piedra").mensaje).toMatch(/ya ha terminado/);
        expect(retos.rendirse(reto.id, b).mensaje).toMatch(/ya ha terminado/);
        // El cron no lo vuelve a tocar.
        expect(retos.revisar(Date.now() + retos.ABANDONO_MS + 1000).cerrados.map((x) => x.id)).not.toContain(reto.id);
        expect(efectivo(b)).toBe(1100);
    });

    test("solo quien participa en un duelo en juego puede rendirse", () => {
        const { reto } = enJuego("ppt");
        expect(retos.rendirse(reto.id, "intruso").mensaje).toMatch(/No juegas/);
        const pendiente = duelo("ppt").reto;
        expect(retos.rendirse(pendiente.id, pendiente.creador).mensaje).toMatch(/ya ha terminado/);
        expect(retos.rendirse(99999, "a").mensaje).toMatch(/ya no existe/);
    });

    test("en el blackjack pierde todo, también lo doblado", () => {
        retos.__test.setRng(() => 0);
        const { a, b, reto } = enJuego("blackjack");
        retos.jugarBlackjack(reto.id, b, "doblar");
        const r = retos.rendirse(reto.id, a);
        expect(r.reto.estado).toBe("resuelto");
        expect(efectivo(b)).toBe(1000 - 100 - 100 + 300);
        expect(efectivo(a)).toBe(900);
    });

    test("el botón solo está en los duelos en juego, y rinde desde el mensaje", async () => {
        const { a, b, reto } = enJuego("ppt");
        expect(idsDe(paneles.mensajeReto(reto))).toContain(`retos_rendirse_${reto.id}`);
        const bj = enJuego("blackjack").reto;
        expect(idsDe(paneles.mensajeReto(bj))).toContain(`retos_rendirse_${bj.id}`);
        expect(idsDe(paneles.mensajeReto(duelo("ppt").reto)).some((id) => /rendirse/.test(id))).toBe(false);

        const i = {
            customId: `retos_rendirse_${reto.id}`,
            user: { id: b },
            update: jest.fn(async () => {}),
            reply: jest.fn(async () => {}),
        };
        await botones.handleButton(null, i);
        expect(i.update.mock.calls[0][0].embeds[0].toJSON().description).toContain(`<@${b}> se ha rendido`);
        expect(efectivo(a)).toBe(1100);

        const otro = { customId: `retos_rendirse_${reto.id}`, user: { id: a }, update: jest.fn(), reply: jest.fn(async () => {}) };
        await botones.handleButton(null, otro);
        expect(otro.reply.mock.calls[0][0].content).toMatch(/ya ha terminado/);
        // Ya no hay rendirse: un duelo resuelto solo ofrece la revancha (#318).
        expect(idsDe(paneles.mensajeReto(retos.obtener(reto.id)))).toEqual([`retos_revancha_${reto.id}`]);
    });
});

describe("doblar en el blackjack (#444)", () => {
    test("cobra exactamente la apuesta inicial, da una sola carta, planta, y el bote incluye lo doblado", () => {
        retos.__test.setRng(() => 0);
        const { a, b, reto } = enJuego("blackjack");
        const r = retos.jugarBlackjack(reto.id, a, "doblar"); // 2♠ 3♠ + 6♠ = 11
        expect(r.ok).toBe(true);
        expect(retos.valorMano(r.reto, a)).toBe(11);
        expect(r.reto.datos.manos[a]).toHaveLength(3);
        expect(r.reto.datos.plantados[a]).toBe(true);
        expect(r.reto.participantes.find((p) => p.userId === a).cantidad).toBe(200);
        expect(efectivo(a)).toBe(800);
        expect(retos.jugarBlackjack(reto.id, a, "pedir").mensaje).toMatch(/Ya has terminado/);
        expect(db.prepare("SELECT descripcion, cantidad FROM historial WHERE userId = ? ORDER BY id DESC LIMIT 1").get(a)).toEqual({
            descripcion: "Reto: doblar en duelo de Blackjack",
            cantidad: -100,
        });

        const fin = retos.jugarBlackjack(reto.id, b, "plantarse"); // 9 contra 11
        expect(fin.reto).toMatchObject({ estado: "resuelto", resultado: "🃏 11 contra 9" });
        expect(efectivo(a)).toBe(800 + 300);
        expect(efectivo(b)).toBe(900);
        // El mensaje público dice lo mismo que se ha pagado.
        expect(texto(fin.reto)).toContain(`Gana <@${a}> y se lleva **300**`);
        expect(texto(fin.reto)).toContain("**300** 🪙");
    });

    test("pierde lo doblado quien dobla y pierde, y el rival cobra todo", () => {
        retos.__test.setRng(() => 0);
        const { a, b, reto } = enJuego("blackjack");
        retos.jugarBlackjack(reto.id, a, "plantarse"); // 5
        const fin = retos.jugarBlackjack(reto.id, b, "doblar"); // 4♠ 5♠ + 6♠ = 15
        expect(fin.reto.estado).toBe("resuelto");
        expect(efectivo(b)).toBe(1000 - 100 - 100 + 300);
        expect(efectivo(a)).toBe(900);
    });

    test("solo con dos cartas y con efectivo suficiente, y si no se puede no se cobra nada", () => {
        retos.__test.setRng(() => 0);
        const { a, reto } = enJuego("blackjack");
        retos.jugarBlackjack(reto.id, a, "pedir");
        expect(retos.jugarBlackjack(reto.id, a, "doblar").mensaje).toMatch(/dos primeras cartas/);
        expect(efectivo(a)).toBe(900);

        const [c, d] = par();
        dinero.ingresar(c, 900); // le quedan 100: justo para entrar en el duelo
        const sinSaldo = retos.crearDuelo({ creador: d, rival: c, juego: "blackjack", cantidad: 100 }).reto;
        retos.aceptar(sinSaldo.id, c);
        expect(efectivo(c)).toBe(0);
        const r = retos.jugarBlackjack(sinSaldo.id, c, "doblar");
        expect(r.ok).toBe(false);
        expect(r.mensaje).toMatch(/No te llega el efectivo para doblar/);
        const intacto = retos.obtener(sinSaldo.id);
        expect(intacto.datos.manos[c]).toHaveLength(2);
        expect(intacto.datos.plantados[c]).toBe(false);
        expect(intacto.participantes.find((p) => p.userId === c).cantidad).toBe(100);
    });

    test("se puede doblar cuando el rival ya se ha plantado", () => {
        retos.__test.setRng(() => 0);
        const { a, b, reto } = enJuego("blackjack");
        retos.jugarBlackjack(reto.id, b, "plantarse");
        const fin = retos.jugarBlackjack(reto.id, a, "doblar");
        expect(fin.reto.estado).toBe("resuelto");
        expect(fin.reto.resultado).toBe("🃏 11 contra 9");
    });

    test("tu mano ofrece Doblar solo con dos cartas, y el botón dobla y avisa en el mensaje público", async () => {
        retos.__test.setRng(() => 0);
        const { a, reto } = enJuego("blackjack");
        expect(idsDe(paneles.vistaManoBlackjack(reto, a))).toContain(`retos_bj_doblar_${reto.id}`);
        const i = {
            customId: `retos_bj_doblar_${reto.id}`,
            user: { id: a },
            update: jest.fn(async () => {}),
            reply: jest.fn(async () => {}),
            followUp: jest.fn(async () => {}),
        };
        await botones.handleButton({ channels: { fetch: async () => null } }, i);
        expect(i.update).toHaveBeenCalledTimes(1);
        expect(efectivo(a)).toBe(800);
        const despues = retos.obtener(reto.id);
        expect(idsDe(paneles.vistaManoBlackjack(despues, a))).toEqual([]);
        expect(texto(despues)).toContain("3 cartas, doblada");
    });
});

describe("duelo abierto (#438)", () => {
    test("se crea sin rival, cobra al creador y lo acepta el primero que pulsa; el siguiente llega tarde", () => {
        const [a, b] = par();
        const sinRival = retos.crearDuelo({ creador: a, juego: "ppt", cantidad: 100 });
        expect(sinRival.mensaje).toMatch(/Elige a quién retas/);
        const { reto } = retos.crearDuelo({ creador: a, abierto: true, juego: "ppt", cantidad: 100 });
        expect(reto).toMatchObject({ estado: "pendiente", rival: null });
        expect(efectivo(a)).toBe(900);

        expect(retos.aceptar(reto.id, a).mensaje).toMatch(/tu propio reto/);
        const r = retos.aceptar(reto.id, b);
        expect(r.ok).toBe(true);
        expect(r.reto).toMatchObject({ estado: "en_juego", rival: b });
        expect(efectivo(b)).toBe(900);
        expect(retos.aceptar(reto.id, "tarde").mensaje).toMatch(/ya no está pendiente/);
        expect(retos.jugarPpt(reto.id, b, "piedra").ok).toBe(true);
    });

    test("el mensaje público dice que lo acepta cualquiera, sin Rechazar ni Bloquear", () => {
        const [a] = par();
        const { reto } = retos.crearDuelo({ creador: a, abierto: true, juego: "dados", cantidad: 100 });
        const m = paneles.mensajeReto(reto);
        expect(m.embeds[0].toJSON().description).toContain("cualquiera");
        expect(idsDe(m)).toEqual([`retos_aceptar_${reto.id}`, `retos_cancelar_${reto.id}`]);
        expect(retos.rechazar(reto.id, "alguien").mensaje).toMatch(/no es para ti/);
        expect(retos.cancelar(reto.id, a).reto.estado).toBe("devuelto");
    });

    test("si nadie lo acepta, caduca y se devuelve como cualquier reto pendiente, sin recordatorio", () => {
        const [a] = par();
        const { reto } = retos.crearDuelo({ creador: a, abierto: true, juego: "dados", cantidad: 100 });
        expect(retos.revisar(Date.now() + retos.ESPERA_ACEPTAR_MS * 0.6).recordatorios.map((x) => x.id)).not.toContain(reto.id);
        const { cerrados } = retos.revisar(Date.now() + retos.ESPERA_ACEPTAR_MS + 1000);
        expect(cerrados.map((x) => x.id)).toContain(reto.id);
        expect(retos.obtener(reto.id)).toMatchObject({ estado: "devuelto", resultado: "nadie lo aceptó a tiempo" });
        expect(efectivo(a)).toBe(1000);
    });

    test("quien está bloqueado por quien lanzó el duelo no puede aceptarlo, con un error genérico", () => {
        const [a, b] = par();
        const { reto } = retos.crearDuelo({ creador: a, abierto: true, juego: "dados", cantidad: 100 });
        require("../src/systems/retos/bloqueos").bloquear(a, b);
        const r = retos.aceptar(reto.id, b);
        expect(r.ok).toBe(false);
        expect(r.mensaje).not.toMatch(/bloque/i);
        expect(retos.obtener(reto.id).estado).toBe("pendiente");
    });

    test("el paso de elegir rival ofrece lo abierto solo en los duelos", () => {
        expect(idsDe(paneles.buildElegirRival("d_ppt", "x"))).toContain("retos_abierto_d_ppt");
        expect(idsDe(paneles.buildElegirRival("p_home_abc", "x")).join()).not.toContain("abierto");
    });

    test("desde el panel: el botón abre el formulario sin rival y publica el reto sin mencionar a nadie", async () => {
        const [a, b] = par();
        const base = { user: { id: a, username: a, tag: a }, guildId: "g", channelId: "c", message: { interaction: { user: { id: a } } } };
        const abre = { ...base, customId: "retos_abierto_d_dados", showModal: jest.fn(async () => {}), reply: jest.fn(async () => {}) };
        await botones.handleButton(null, abre);
        const modal = abre.showModal.mock.calls[0][0];
        expect(modal.data.custom_id).toBe("retos_modal_d_dados_abierto");
        expect(JSON.stringify(modal.toJSON())).toContain('"custom_id":"serie"');

        const publicados = [];
        const envia = {
            ...base,
            customId: "retos_modal_d_dados_abierto",
            fields: { getStringSelectValues: () => ["100"], getTextInputValue: () => "" },
            update: jest.fn(async () => {}),
            reply: jest.fn(async () => {}),
            followUp: jest.fn(async (x) => {
                publicados.push(x);
                return { id: "m-abierto", channelId: "c" };
            }),
        };
        await botones.handleModal(null, envia);
        expect(publicados[0].content).toBeUndefined();
        expect(publicados[0].allowedMentions).toEqual({ users: [] });
        const creado = db.prepare("SELECT id, rival FROM retos WHERE creador = ? ORDER BY id DESC LIMIT 1").get(a);
        expect(creado.rival).toBeNull();
        expect(retos.aceptar(creado.id, b).ok).toBe(true);
    });
});

describe("al mejor de tres (#436)", () => {
    test("el formato se elige al lanzar el duelo y el reto lo guarda (1 por defecto)", () => {
        const [a, b] = par();
        expect(retos.crearDuelo({ creador: a, rival: b, juego: "ppt", cantidad: 100 }).reto.serie).toBe(1);
        const { reto } = retos.crearDuelo({ creador: a, rival: b, juego: "ppt", cantidad: 100, serie: 3 });
        expect(reto.serie).toBe(3);
        expect(retos.crearDuelo({ creador: a, rival: b, juego: "ppt", cantidad: 100, serie: 2 }).mensaje).toMatch(/al mejor de 3/);
        expect(texto(reto)).toContain("Al mejor de 3");
        const form = JSON.stringify(paneles.modalCantidad("retos_modal_d_ppt_x", "Reto", 1000, { conSerie: true }).toJSON());
        expect(form).toContain('"custom_id":"serie"');
        expect(JSON.stringify(paneles.modalCantidad("retos_modal_p_x", "Reto", 1000).toJSON())).not.toContain('"custom_id":"serie"');
    });

    test("el formulario del duelo llega al reto con su formato", async () => {
        const [a, b] = par();
        const i = {
            customId: `retos_modal_d_dados_${b}`,
            user: { id: a },
            guildId: "g",
            channelId: "c",
            fields: { getStringSelectValues: (id) => (id === "serie" ? ["3"] : ["100"]), getTextInputValue: () => "" },
            update: async () => {},
            reply: async () => {},
            followUp: async () => ({ id: "m-serie", channelId: "c" }),
        };
        await botones.handleModal(null, i);
        expect(db.prepare("SELECT serie FROM retos WHERE creador = ? ORDER BY id DESC LIMIT 1").get(a).serie).toBe(3);
    });

    test("dados: se tiran las partidas necesarias y el bote se paga una sola vez al llegar a dos victorias", () => {
        // 1: gana el creador (12 contra 2) · 2: gana el rival · 3: gana el creador.
        retos.__test.setRng(secuencia(0.99, 0.99, 0, 0, 0, 0, 0.99, 0.99, 0.99, 0.99, 0, 0));
        const { a, b, reto } = enJuego("dados", { serie: 3 });
        expect(reto).toMatchObject({ estado: "resuelto" });
        expect(reto.resultado).toMatch(/serie 2–1$/);
        expect(reto.datos.historial.map((h) => h.ganador)).toEqual([a, b, a]);
        expect(efectivo(a)).toBe(1100);
        expect(efectivo(b)).toBe(900);
        expect(db.prepare("SELECT COUNT(*) AS n FROM historial WHERE userId = ? AND tipo = 'retos'").get(a).n).toBe(2); // entrada y premio
        expect(texto(reto)).toContain(`<@${a}> **2** – **1** <@${b}>`);
    });

    test("dados: con dos victorias seguidas se acaba sin jugar la tercera", () => {
        retos.__test.setRng(secuencia(0.99, 0.99, 0, 0));
        const { a, reto } = enJuego("dados", { serie: 3 });
        expect(reto.resultado).toMatch(/serie 2–0$/);
        expect(reto.datos.historial).toHaveLength(2);
        expect(efectivo(a)).toBe(1100);
    });

    test("piedra, papel o tijera: el marcador se ve en el mensaje, no se paga hasta el final, y un empate no suma", () => {
        const { a, b, reto } = enJuego("ppt", { serie: 3 });
        const jugar = (ja, jb) => {
            retos.jugarPpt(reto.id, a, ja);
            return retos.jugarPpt(reto.id, b, jb);
        };
        const p1 = jugar("piedra", "tijera");
        expect(p1.reto.estado).toBe("en_juego");
        expect(p1.mensaje).toMatch(/Partida 1: gana <@duelo-a\d+>.*Marcador 1–0/);
        expect(texto(p1.reto)).toContain(`<@${a}> **1** – **0** <@${b}>`);
        expect(texto(p1.reto)).toContain("partida 2");
        expect(efectivo(a)).toBe(900);
        expect(p1.reto.datos).toMatchObject({ ronda: 1, jugadas: {}, empates: [] });

        // Empate de la partida 2 (cinco rondas empatadas): se repite sin sumar.
        for (let ronda = 0; ronda < 5; ronda++) jugar("papel", "papel");
        const repetida = retos.obtener(reto.id);
        expect(repetida.estado).toBe("en_juego");
        expect(repetida.datos).toMatchObject({ partida: 2, empatadas: 1 });
        expect(repetida.datos.marcador).toEqual({ [a]: 1, [b]: 0 });
        expect(repetida.datos.historial.at(-1)).toMatchObject({ ganador: null });

        const p2 = jugar("tijera", "piedra"); // gana el rival
        expect(p2.reto.datos.marcador).toEqual({ [a]: 1, [b]: 1 });
        const fin = jugar("papel", "piedra"); // gana el creador: 2–1
        expect(fin.reto).toMatchObject({ estado: "resuelto" });
        expect(fin.reto.resultado).toMatch(/serie 2–1$/);
        expect(efectivo(a)).toBe(1100);
        expect(efectivo(b)).toBe(900);
        expect(texto(fin.reto)).toContain(`Gana <@${a}> y se lleva **200**`);
    });

    test("tres partidas empatadas seguidas devuelven el reto con lo de cada uno", () => {
        const { a, b, reto } = enJuego("ppt", { serie: 3 });
        for (let ronda = 0; ronda < 15; ronda++) {
            retos.jugarPpt(reto.id, a, "piedra");
            retos.jugarPpt(reto.id, b, "piedra");
        }
        const cerrado = retos.obtener(reto.id);
        expect(cerrado.estado).toBe("devuelto");
        expect(cerrado.resultado).toMatch(/3 empates seguidos en la serie/);
        expect(efectivo(a)).toBe(1000);
        expect(efectivo(b)).toBe(1000);
    });

    test("blackjack: cada partida reparte de nuevo, se paga al final y el mensaje cuenta la partida anterior", () => {
        retos.__test.setRng(() => 0); // siempre 5 contra 9: gana el rival
        const { a, b, reto } = enJuego("blackjack", { serie: 3 });
        retos.jugarBlackjack(reto.id, a, "plantarse");
        const p1 = retos.jugarBlackjack(reto.id, b, "plantarse");
        expect(p1.reto.estado).toBe("en_juego");
        expect(p1.mensaje).toMatch(/Partida 1: gana <@duelo-b\d+> \(🃏 5 contra 9\)\. Marcador 0–1/);
        expect(p1.reto.datos.manos[a]).toHaveLength(2); // mano nueva
        expect(p1.reto.datos.plantados).toEqual({ [a]: false, [b]: false });
        expect(efectivo(b)).toBe(900);

        retos.jugarBlackjack(reto.id, a, "plantarse");
        const fin = retos.jugarBlackjack(reto.id, b, "plantarse");
        expect(fin.reto).toMatchObject({ estado: "resuelto", resultado: "🃏 5 contra 9 · serie 0–2" });
        expect(efectivo(b)).toBe(1100);
        expect(efectivo(a)).toBe(900);
    });

    test("una serie de blackjack abandonada se cierra desde revisar sin dejar dinero retenido", () => {
        retos.__test.setRng(() => 0);
        const { a, b, reto } = enJuego("blackjack", { serie: 3 });
        const tarde = () => Date.now() + retos.ABANDONO_MS + 1000;
        expect(retos.revisar(tarde()).cerrados).toEqual([]); // la primera partida se resuelve y la serie sigue
        expect(retos.obtener(reto.id)).toMatchObject({ estado: "en_juego" });
        expect(retos.obtener(reto.id).datos.marcador).toEqual({ [a]: 0, [b]: 1 });
        const { cerrados } = retos.revisar(tarde());
        expect(cerrados.map((x) => x.id)).toEqual([reto.id]);
        expect(retos.obtener(reto.id).estado).toBe("resuelto");
        expect(efectivo(b)).toBe(1100);
        expect(efectivo(a)).toBe(900);
        const retenido = db
            .prepare("SELECT COUNT(*) AS n FROM retos WHERE id = ? AND estado NOT IN ('resuelto', 'devuelto')")
            .get(reto.id).n;
        expect(retenido).toBe(0);
    });

    test("rendirse en una serie da el bote entero al rival, y un duelo de una partida no cambia", () => {
        retos.__test.setRng(() => 0);
        const { a, b, reto } = enJuego("blackjack", { serie: 3 });
        expect(retos.rendirse(reto.id, a).reto.estado).toBe("resuelto");
        expect(efectivo(b)).toBe(1100);
        const simple = enJuego("blackjack");
        retos.jugarBlackjack(simple.reto.id, simple.a, "plantarse");
        const fin = retos.jugarBlackjack(simple.reto.id, simple.b, "plantarse");
        expect(fin.reto.resultado).toBe("🃏 5 contra 9");
        expect(fin.mensaje).toBeUndefined();
    });
});
