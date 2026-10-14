// Fase 7 (economía, tienda e impuestos): regalar (#302), mercado entre jugadores (#374), vender a la tienda (#379), mejora de
// negocios (#387), tramos de impuesto (#392), lista de deseos (#404), códigos (#409), CSV (#411), precio dinámico (#412), ofertas
// (#413), meta del bote (#415) y sueldo por rol (#416). La BD es la de setupEnv.js (en memoria); el reloj, el del test.
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const tienda = require("../src/systems/tienda");
const guildSettings = require("../src/systems/guildSettings");
const impuestos = require("../src/systems/impuestos");
const tramos = require("../src/systems/impuestos/tramos");
const meta = require("../src/systems/impuestos/meta");
const regalo = require("../src/systems/objetosRegalo");
const mercado = require("../src/systems/mercado");
const recompra = require("../src/systems/tiendaRecompra");
const deseos = require("../src/systems/tiendaDeseos");
const codigos = require("../src/systems/codigos");
const sueldos = require("../src/systems/sueldos");
const negocios = require("../src/systems/negocios");
const { csvDeMovimientos, BOM, TOPE_FILAS } = require("../src/systems/movimientosCsv");
const { fechaMadridAMs } = require("../src/core/zonaMadrid");
const catalogoExtras = require("../src/adminPanel/catalogoExtras");
const avisosDm = require("../src/systems/avisosDm");

const G = "g-f7";
let n = 0;
const usuario = (efectivo = 1000, banco = 0) => {
    const id = `f7-${++n}`;
    dinero.asegurarCuenta(id);
    db.prepare("UPDATE banco SET enMano = ?, saldo = ? WHERE userId = ?").run(efectivo, banco, id);
    return id;
};
const objeto = (nombre, extra = {}) =>
    db
        .prepare("INSERT INTO objeto (nombre, descripcion, tipo, unico, efecto) VALUES (?, 'desc', 'coleccionable', ?, ?)")
        .run(nombre, extra.unico ? 1 : 0, extra.efecto ?? null).lastInsertRowid;
const dar = (userId, objetoId, cantidad = 1) => {
    for (let i = 0; i < cantidad; i++)
        db.prepare("INSERT INTO inventario (userId, itemId, fecha) VALUES (?, ?, '2026-10-01')").run(userId, objetoId);
};
const tiene = (userId, objetoId) =>
    db.prepare("SELECT COUNT(*) AS n FROM inventario WHERE userId = ? AND itemId = ?").get(userId, objetoId).n;
const aLaVenta = (objetoId, precio, stock = null) =>
    db.prepare("INSERT INTO tienda (objetoId, precio, stock) VALUES (?, ?, ?)").run(objetoId, precio, stock).lastInsertRowid;

beforeEach(() => {
    jest.useRealTimers();
});

describe("regalar un objeto (#302)", () => {
    test("cambia de dueño y queda en el historial de los dos, sin mover monedas", () => {
        const a = usuario();
        const b = usuario();
        const o = objeto("Pluma");
        dar(a, o);
        const r = regalo.regalar(a, b, o, { de: "ana", a: "beto" });
        expect(r.ok).toBe(true);
        expect([tiene(a, o), tiene(b, o)]).toEqual([0, 1]);
        expect(dinero.efectivo(a)).toBe(1000);
        expect(dinero.movimientos(a).filas[0].descripcion).toContain("Regalo a beto");
        expect(dinero.movimientos(b).filas[0].descripcion).toContain("Regalo de ana");
    });

    test("no a uno mismo, ni lo que no se tiene, ni objetos de protección, ni un único que ya tiene", () => {
        const a = usuario();
        const b = usuario();
        const pluma = objeto("Pluma 2");
        const candado = objeto("Candado", { efecto: "antirrobo:30" });
        const unico = objeto("Reliquia", { unico: true });
        dar(a, pluma);
        dar(a, candado);
        dar(a, unico);
        dar(b, unico);
        expect(regalo.regalar(a, a, pluma).ok).toBe(false);
        expect(regalo.regalar(a, b, 99999).ok).toBe(false);
        expect(regalo.regalar(a, b, candado).mensaje).toMatch(/protección/);
        expect(regalo.regalar(a, b, unico).mensaje).toMatch(/único/);
        expect([tiene(a, candado), tiene(a, unico), tiene(b, candado)]).toEqual([1, 1, 0]);
    });
});

describe("mercado entre jugadores (#374)", () => {
    test("poner saca el objeto del inventario y retirar lo devuelve", () => {
        const a = usuario();
        const o = objeto("Espada");
        dar(a, o);
        const r = mercado.poner(a, o, 500);
        expect(r.ok).toBe(true);
        expect(tiene(a, o)).toBe(0);
        expect(mercado.retirar(a, r.oferta.id).ok).toBe(true);
        expect(tiene(a, o)).toBe(1);
        expect(mercado.retirar(a, r.oferta.id).ok).toBe(false);
    });

    test("la compra cobra al comprador, paga íntegro al vendedor y deja un movimiento propio a cada uno", () => {
        const v = usuario();
        const c = usuario(2000);
        const o = objeto("Arco");
        dar(v, o);
        const { oferta } = mercado.poner(v, o, 700);
        const r = mercado.comprar(c, oferta.id, { comprador: "cris", vendedor: "vera" });
        expect(r.ok).toBe(true);
        expect([dinero.efectivo(c), dinero.efectivo(v)]).toEqual([1300, 1700]);
        expect([tiene(c, o), tiene(v, o)]).toEqual([1, 0]);
        expect(dinero.movimientos(c).filas[0]).toMatchObject({ tipo: "venta", cantidad: -700 });
        expect(dinero.movimientos(v).filas[0]).toMatchObject({ tipo: "venta", cantidad: 700 });
        expect(mercado.comprar(usuario(), oferta.id).ok).toBe(false); // ya no existe
    });

    test("no se compra la propia oferta, ni sin efectivo (aunque haya dinero negro), y si falla no se mueve nada", () => {
        const v = usuario();
        const pobre = usuario(10);
        db.prepare("UPDATE banco SET negro = 5000 WHERE userId = ?").run(pobre);
        const o = objeto("Escudo");
        dar(v, o);
        const { oferta } = mercado.poner(v, o, 700);
        expect(mercado.comprar(v, oferta.id).mensaje).toMatch(/propia/);
        expect(mercado.comprar(pobre, oferta.id).mensaje).toMatch(/efectivo/);
        expect(dinero.efectivo(pobre)).toBe(10);
        expect(mercado.oferta(oferta.id)).toBeTruthy();
    });

    test("una oferta caducada vuelve a su dueño al listar y no se puede comprar", () => {
        const v = usuario();
        const o = objeto("Hacha");
        dar(v, o);
        const t0 = Date.now();
        const { oferta } = mercado.poner(v, o, 100, t0);
        const despues = t0 + mercado.CADUCIDAD_MS + 1000;
        expect(mercado.comprar(usuario(), oferta.id, {}, despues).mensaje).toMatch(/caducado/);
        expect(tiene(v, o)).toBe(1);
        const otra = mercado.poner(v, o, 100, t0).oferta;
        expect(mercado.listar({}, despues).filas.some((f) => f.id === otra.id)).toBe(false);
        expect(tiene(v, o)).toBe(1);
    });

    test("precio y límite de ofertas, y los objetos de protección no se venden", () => {
        const v = usuario();
        const o = objeto("Lanza");
        const candado = objeto("Candado 2", { efecto: "trampa:3" });
        dar(v, o, mercado.MAX_OFERTAS + 1);
        dar(v, candado);
        expect(mercado.poner(v, o, 0).ok).toBe(false);
        expect(mercado.poner(v, candado, 100).ok).toBe(false);
        for (let i = 0; i < mercado.MAX_OFERTAS; i++) expect(mercado.poner(v, o, 10).ok).toBe(true);
        expect(mercado.poner(v, o, 10).mensaje).toMatch(/Retira/);
    });

    test("un objeto único no se compra si ya se tiene", () => {
        const v = usuario();
        const c = usuario();
        const o = objeto("Corona", { unico: true });
        dar(v, o);
        dar(c, o);
        const { oferta } = mercado.poner(v, o, 50);
        expect(mercado.comprar(c, oferta.id).mensaje).toMatch(/único/);
    });
});

describe("vender a la tienda (#379) y precio de la tienda (#412, #413)", () => {
    beforeEach(() =>
        guildSettings.setManySettings(G, {
            "tienda.recompra_pct": 50,
            "tienda.subida_pct": 0,
            "tienda.recuperacion_pct": 5,
            "tienda.tope_pct": 100,
        }),
    );

    test("devuelve el % del precio base al efectivo y sube el stock limitado", () => {
        const u = usuario(0);
        const o = objeto("Anillo");
        aLaVenta(o, 200, 3);
        dar(u, o);
        expect(recompra.precioDeRecompra(G, o)).toBe(100);
        const r = recompra.venderATienda(u, G, o);
        expect(r).toMatchObject({ ok: true, monedas: 100 });
        expect(dinero.efectivo(u)).toBe(100);
        expect(db.prepare("SELECT stock FROM tienda WHERE objetoId = ?").get(o).stock).toBe(4);
        expect(dinero.movimientos(u).filas[0].tipo).toBe("venta");
    });

    test("se rechaza si ya no se vende, si no se tiene o si la recompra está apagada", () => {
        const u = usuario();
        const o = objeto("Collar");
        dar(u, o);
        expect(recompra.venderATienda(u, G, o).mensaje).toMatch(/ya no vende/);
        expect(recompra.venderATienda(u, G, 99999).ok).toBe(false);
        aLaVenta(o, 100);
        guildSettings.setSetting(G, "tienda.recompra_pct", 0);
        expect(recompra.venderATienda(u, G, o).mensaje).toMatch(/no recompra/);
        expect(tiene(u, o)).toBe(1);
    });

    test("oferta: el precio mostrado es el cobrado, con impuesto de compra sobre el rebajado, y caduca sola", () => {
        const u = usuario(1000);
        const o = objeto("Poción");
        const id = aLaVenta(o, 200);
        const t0 = Date.now();
        db.prepare("UPDATE tienda SET descuento = 25, oferta_inicio = ?, oferta_fin = ? WHERE id = ?").run(t0 - 1000, t0 + 60000, id);
        const item = tienda.itemTienda(id);
        expect(item).toMatchObject({ precio: 150, precioLista: 200, enOferta: true });
        expect(tienda.conPrecio({ ...item, precio: 200 }, t0 + 120000)).toMatchObject({ precio: 200, enOferta: false });
        expect(tienda.conPrecio({ ...item, precio: 200 }, t0 - 5000).enOferta).toBe(false); // aún no empieza
        impuestos.asegurarReglaPorDefecto(G);
        expect(tienda.cobrarCompra(u, G, item)).toBe(true);
        const cobrado = 1000 - dinero.efectivo(u);
        expect(cobrado).toBeGreaterThanOrEqual(150);
        expect(dinero.movimientos(u).filas.find((m) => m.tipo === "tienda").cantidad).toBe(-150);
    });

    test("precio dinámico: cada compra lo sube hasta el tope, los únicos quedan fuera y se recupera hacia el base", () => {
        guildSettings.setManySettings(G, { "tienda.subida_pct": 10, "tienda.tope_pct": 20, "tienda.recuperacion_pct": 5 });
        const u = usuario(100000);
        const o = objeto("Flecha");
        const id = aLaVenta(o, 100);
        const compra = () => tienda.cobrarCompra(u, G, tienda.itemTienda(id));
        compra();
        expect(tienda.itemTienda(id)).toMatchObject({ precio: 110, precioBase: 100 });
        compra();
        compra();
        expect(tienda.itemTienda(id).precio).toBe(120); // tope: +20 %
        expect(tienda.recuperarPrecios([G])).toBe(1);
        expect(tienda.itemTienda(id).precio).toBe(115); // -5 % del base
        for (let i = 0; i < 3; i++) tienda.recuperarPrecios([G]);
        expect(tienda.itemTienda(id)).toMatchObject({ precio: 100, precioBase: 100 });
        const unico = objeto("Trono", { unico: true });
        const idUnico = aLaVenta(unico, 100);
        tienda.cobrarCompra(u, G, tienda.itemTienda(idUnico));
        expect(tienda.itemTienda(idUnico).precio).toBe(100);
    });
});

describe("mejora de negocios (#387)", () => {
    test("sube de nivel pagando del banco y los valores del nivel entran en la capacidad y el ingreso", () => {
        const u = usuario(0, 100000);
        expect(negocios.comprar(u, G, "lavanderia").ok).toBe(true); // 15.000
        expect(negocios.capacidadDiaria(u)).toBe(7500);
        const r = negocios.mejorar(u, "lavanderia");
        expect(r.ok).toBe(true);
        expect(dinero.banco(u)).toBe(100000 - 15000 - 15000);
        expect(negocios.capacidadDiaria(u)).toBe(11250);
        expect(negocios.mejorar(u, "lavanderia").ok).toBe(true); // nivel 3: 30.000
        expect(negocios.capacidadDiaria(u)).toBe(15000);
        expect(negocios.mejorar(u, "lavanderia").mensaje).toMatch(/nivel máximo/);
        const ingresos = negocios.estado(u).negocios[0];
        expect(ingresos).toMatchObject({ nivel: 3, ingresoDia: 200 });
        expect(dinero.movimientos(u).filas[0].tipo).toBe("negocio");
    });

    test("la venta devuelve el 50 % de todo lo pagado, mejoras incluidas, y sin banco no se mejora", () => {
        const u = usuario(0, 15000);
        negocios.comprar(u, G, "lavanderia");
        expect(negocios.mejorar(u, "lavanderia").ok).toBe(false);
        expect(negocios.mejorar(usuario(), "taco").ok).toBe(false);
        dinero.pagarBanco(u, 15000);
        negocios.mejorar(u, "lavanderia");
        negocios.vender(u, "lavanderia");
        expect(dinero.banco(u)).toBe(15000 - 15000 + 15000 - 15000 + 15000); // lo que quedaba + 50 % de 30.000
    });

    test("el ingreso diario paga el del nivel", () => {
        const u = usuario(0, 100000);
        negocios.comprar(u, G, "lavanderia", 1_000_000_000_000);
        negocios.mejorar(u, "lavanderia");
        const antes = dinero.efectivo(u);
        negocios.pagarIngresosDiarios(1_000_000_000_000 + 2 * 86400000);
        expect(dinero.efectivo(u) - antes).toBeGreaterThanOrEqual(150 - 15); // 150 menos el impuesto por defecto
    });
});

describe("tramos del impuesto de ingreso (#392)", () => {
    const G2 = "g-f7-tramos";

    test("una regla plana da el mismo impuesto de siempre y con tramos cada parte paga el suyo (hacia abajo)", () => {
        const regla = impuestos.anadirRegla(G2, { base: "ingreso", tipoMovimiento: "premio", porcentaje: 10 });
        expect(impuestos.calcularImpuesto(G2, "premio", 1234).impuesto).toBe(123);
        tramos.ponerTramo(G2, regla.id, 1000, 50);
        // 1000 al 10 % + 234 al 50 % = 100 + 117
        expect(impuestos.calcularImpuesto(G2, "premio", 1234).impuesto).toBe(217);
        expect(impuestos.calcularImpuesto(G2, "premio", 999).impuesto).toBe(99);
        tramos.ponerTramo(G2, regla.id, 5000, 0); // tramo exento arriba
        expect(impuestos.calcularImpuesto(G2, "premio", 6000).impuesto).toBe(100 + 2000);
        expect(tramos.tramosDe(regla.id)).toHaveLength(2);
        expect(tramos.quitarTramo(G2, regla.id, 5000)).toBe(true);
        expect(impuestos.quitarRegla(G2, regla.id)).toBe(true);
        expect(tramos.tramosDe(regla.id)).toEqual([]);
    });

    test("un tramo con tipo 0 % permite una regla exenta abajo", () => {
        const regla = impuestos.anadirRegla(G2, { base: "ingreso", tipoMovimiento: "trabajo", porcentaje: 1 });
        db.prepare("UPDATE impuestos_reglas SET porcentaje = 0 WHERE id = ?").run(regla.id);
        tramos.ponerTramo(G2, regla.id, 100, 20);
        expect(impuestos.calcularImpuesto(G2, "trabajo", 50)).toBeNull();
        expect(impuestos.calcularImpuesto(G2, "trabajo", 200).impuesto).toBe(20);
    });

    test("validaciones: regla de otro servidor, de compra, desde y porcentaje", () => {
        const regla = impuestos.anadirRegla(G2, { base: "ingreso", tipoMovimiento: "retos", porcentaje: 5 });
        const compra = impuestos.anadirRegla(G2, { base: "compra", porcentaje: 5 });
        expect(tramos.ponerTramo("otro", regla.id, 10, 5).ok).toBe(false);
        expect(tramos.ponerTramo(G2, compra.id, 10, 5).mensaje).toMatch(/ingreso/);
        expect(tramos.ponerTramo(G2, regla.id, 0, 5).ok).toBe(false);
        expect(tramos.ponerTramo(G2, regla.id, 10, 101).ok).toBe(false);
    });
});

describe("lista de deseos (#404)", () => {
    test("seguir y dejar de seguir, con límite", () => {
        const u = usuario();
        const o = objeto("Brújula");
        const id = aLaVenta(o, 50);
        expect(deseos.alternar(u, id)).toMatchObject({ ok: true, siguiendo: true, total: 1 });
        expect(deseos.lista(u).map((i) => i.tiendaId)).toEqual([id]);
        expect(deseos.alternar(u, id)).toMatchObject({ siguiendo: false, total: 0 });
        expect(deseos.alternar(u, 987654).ok).toBe(false);
        for (let i = 0; i < deseos.LIMITE; i++) deseos.alternar(u, aLaVenta(objeto(`Cosa ${i}`), 10));
        expect(deseos.alternar(u, aLaVenta(objeto("Una más"), 10)).mensaje).toMatch(/máximo/);
    });

    test("avisa por DM cuando vuelve el stock o baja el precio, y no por lo demás", async () => {
        const u = usuario();
        const o = objeto("Mapa");
        const id = aLaVenta(o, 100, 0);
        deseos.alternar(u, id);
        const enviados = [];
        const client = { users: { fetch: async (uid) => ({ send: async (p) => enviados.push({ uid, p }) }) } };
        const antes = tienda.itemTienda(id);
        db.prepare("UPDATE tienda SET stock = 5 WHERE id = ?").run(id);
        expect(await catalogoExtras.avisarSeguidores(client, antes, tienda.itemTienda(id))).toBe(1);
        expect(enviados[0].p.embeds[0].data.title).toMatch(/stock/);
        const antes2 = tienda.itemTienda(id);
        db.prepare("UPDATE tienda SET precio = 150 WHERE id = ?").run(id);
        expect(await catalogoExtras.avisarSeguidores(client, antes2, tienda.itemTienda(id))).toBe(0); // subida: nada
        const antes3 = tienda.itemTienda(id);
        db.prepare("UPDATE tienda SET precio = 80 WHERE id = ?").run(id);
        expect(await catalogoExtras.avisarSeguidores(client, antes3, tienda.itemTienda(id))).toBe(1);
        expect(enviados[1].p.embeds[0].data.title).toMatch(/precio/);
    });

    test("respeta /avisos y los DMs cerrados", async () => {
        const u = usuario();
        const id = aLaVenta(objeto("Reloj"), 100, 0);
        deseos.alternar(u, id);
        const antes = tienda.itemTienda(id);
        db.prepare("UPDATE tienda SET stock = 2 WHERE id = ?").run(id);
        const cerrado = {
            users: {
                fetch: async () => {
                    throw Object.assign(new Error("x"), { code: 50007 });
                },
            },
        };
        expect(await catalogoExtras.avisarSeguidores(cerrado, antes, tienda.itemTienda(id))).toBe(0);
        avisosDm.fijar(u, "tienda_deseos", false);
        const client = { users: { fetch: jest.fn() } };
        expect(await catalogoExtras.avisarSeguidores(client, antes, tienda.itemTienda(id))).toBe(0);
        expect(client.users.fetch).not.toHaveBeenCalled();
    });
});

describe("códigos canjeables (#409)", () => {
    test("un código de N usos se agota en exactamente N canjes y cada persona lo canjea una vez", () => {
        expect(codigos.crear({ codigo: "bienvenida", monedas: 500, usosMax: 2 }).ok).toBe(true);
        const [a, b, c] = [usuario(0), usuario(0), usuario(0)];
        expect(codigos.canjear(a, "BIENVENIDA").ok).toBe(true);
        expect(codigos.canjear(a, "bienvenida").mensaje).toMatch(/Ya has canjeado/);
        expect(codigos.canjear(b, "BIENVENIDA").ok).toBe(true);
        expect(codigos.canjear(c, "BIENVENIDA").mensaje).toMatch(/agotado/);
        expect([dinero.efectivo(a), dinero.efectivo(b), dinero.efectivo(c)]).toEqual([500, 500, 0]);
        expect(dinero.movimientos(a).filas[0].tipo).toBe("codigo");
        expect(dinero.movimientos(c).filas).toHaveLength(0);
    });

    test("monedas y objeto a la vez, caducidad, desactivar y validaciones", () => {
        const o = objeto("Premio");
        expect(codigos.crear({ codigo: "DOBLE", monedas: 100, objetoId: o, usosMax: 5 }).ok).toBe(true);
        const u = usuario(0);
        expect(codigos.canjear(u, "DOBLE").mensaje).toContain("Premio");
        expect([dinero.efectivo(u), tiene(u, o)]).toEqual([100, 1]);

        const ahora = Date.now();
        codigos.crear({ codigo: "TEMPORAL", monedas: 10, usosMax: 5, caduca: ahora + 1000 }, ahora);
        expect(codigos.canjear(usuario(), "TEMPORAL", ahora + 5000).mensaje).toMatch(/caducado/);
        codigos.crear({ codigo: "APAGAME", monedas: 10, usosMax: 5 });
        expect(codigos.desactivar("apagame")).toBe(true);
        expect(codigos.canjear(usuario(), "APAGAME").mensaje).toMatch(/no existe/);
        expect(codigos.canjear(usuario(), "NOEXISTE").ok).toBe(false);

        expect(codigos.crear({ codigo: "DOBLE", monedas: 1, usosMax: 1 }).mensaje).toMatch(/Ya existe/);
        expect(codigos.crear({ codigo: "x", monedas: 1, usosMax: 1 }).ok).toBe(false);
        expect(codigos.crear({ codigo: "VACIO", usosMax: 1 }).ok).toBe(false);
        expect(codigos.crear({ codigo: "SINUSOS", monedas: 1, usosMax: 0 }).ok).toBe(false);
        expect(codigos.crear({ codigo: "OBJETO0", objetoId: 999999, usosMax: 1 }).ok).toBe(false);
    });

    test("un objeto único que ya se tiene no se pierde el canje", () => {
        const o = objeto("Medalla", { unico: true });
        codigos.crear({ codigo: "MEDALLA", objetoId: o, usosMax: 3 });
        const u = usuario();
        dar(u, o);
        expect(codigos.canjear(u, "MEDALLA").mensaje).toMatch(/único/);
        expect(db.prepare("SELECT usos FROM codigos WHERE codigo = 'MEDALLA'").get().usos).toBe(0);
    });
});

describe("exportar movimientos a CSV (#411)", () => {
    test("BOM, separador ;, hora de Madrid y solo el filtro activo", () => {
        const u = usuario(0);
        db.prepare("INSERT INTO historial (userId, fecha, descripcion, cantidad, tipo) VALUES (?, ?, ?, ?, ?)").run(
            u,
            "2026-07-01T10:30:00.000Z",
            'Compra; con "comillas"',
            -50,
            "tienda",
        );
        db.prepare("INSERT INTO historial (userId, fecha, descripcion, cantidad, tipo) VALUES (?, ?, ?, ?, ?)").run(
            u,
            "2026-07-02T10:30:00.000Z",
            "=CMD()",
            20,
            "casino",
        );
        const todo = csvDeMovimientos(u);
        expect(todo.csv.startsWith(`${BOM}fecha;tipo;descripcion;cantidad\r\n`)).toBe(true);
        const lineas = todo.csv.trim().split("\r\n");
        expect(lineas).toHaveLength(3);
        expect(lineas[1]).toBe("2026-07-02 12:30:00;🎰 Casino;'=CMD();20");
        expect(lineas[2]).toBe('2026-07-01 12:30:00;🛒 Tienda;"Compra; con ""comillas""";-50');
        const soloTienda = csvDeMovimientos(u, "tienda");
        expect(soloTienda.filas).toBe(1);
        expect(soloTienda.truncado).toBe(false);
    });

    test("con más del tope exporta los más recientes y avisa", () => {
        const u = usuario(0);
        const ins = db.prepare("INSERT INTO historial (userId, fecha, descripcion, cantidad, tipo) VALUES (?, ?, 'x', 1, 'otro')");
        db.transaction(() => {
            for (let i = 0; i < TOPE_FILAS + 3; i++) ins.run(u, new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString());
        })();
        const r = csvDeMovimientos(u);
        expect(r).toMatchObject({ filas: TOPE_FILAS, truncado: true });
    });
});

describe("meta comunitaria del bote (#415)", () => {
    const GM = "g-f7-meta";
    const participar = (userId, guildId = GM) =>
        db.prepare("INSERT OR REPLACE INTO xp_diaria (guildId, userId, dia, xp) VALUES (?, ?, '2026-10-10', 10)").run(guildId, userId);

    test("al llegar a la meta se reparte una sola vez y solo se descuenta lo pagado", () => {
        const [a, b] = [usuario(0), usuario(0)];
        participar(a);
        participar(b);
        meta.fijar(GM, 1000, 300);
        impuestos.sumarBote(GM, 900);
        expect(meta.comprobar(GM)).toBeNull(); // aún no llega
        impuestos.sumarBote(GM, 300);
        expect(meta.comprobar(GM)).toEqual({ repartido: 600, personas: 2, porPersona: 300 });
        expect([dinero.efectivo(a), dinero.efectivo(b)]).toEqual([300, 300]);
        expect(impuestos.boteTotal(GM)).toBe(600);
        expect(meta.comprobar(GM)).toBeNull(); // no se paga dos veces
        expect(dinero.movimientos(a).filas[0].tipo).toBe("premio");
    });

    test("con muchas personas la meta se reparte a partes iguales, y se filtra a quien ya no está", () => {
        const GM2 = "g-f7-meta2";
        const gente = [usuario(0), usuario(0), usuario(0), usuario(0)];
        gente.forEach((u) => participar(u, GM2));
        participar("fuera", GM2);
        meta.fijar(GM2, 100, 100);
        impuestos.sumarBote(GM2, 100);
        const r = meta.comprobar(GM2, (id) => id !== "fuera");
        expect(r).toEqual({ repartido: 100, personas: 4, porPersona: 25 });
        expect(dinero.efectivo(gente[0])).toBe(25);
    });

    test("sin participantes o sin meta no se toca el bote; las validaciones y quitarla funcionan", () => {
        const GM3 = "g-f7-meta3";
        impuestos.sumarBote(GM3, 5000);
        expect(meta.comprobar(GM3)).toBeNull();
        meta.fijar(GM3, 100, 10);
        expect(meta.comprobar(GM3)).toBeNull();
        expect(impuestos.boteTotal(GM3)).toBe(5000);
        expect(meta.fijar(GM3, 100, 200).ok).toBe(false);
        expect(meta.fijar(GM3, 0, 1).ok).toBe(false);
        expect(meta.quitar(GM3)).toBe(true);
    });
});

describe("sueldo diario por rol (#416)", () => {
    const GS = "g-f7-sueldos";
    const miembro = (id, roles, bot = false) => ({ id, user: { bot }, roles: { cache: new Map(roles.map((r) => [r, {}])) } });

    test("paga la suma de los roles una sola vez al día, con impuesto, y no a bots ni a quien no tiene rol", () => {
        sueldos.fijar(GS, "colab", 200);
        sueldos.fijar(GS, "apoyo", 100);
        const [a, b, c] = [usuario(0), usuario(0), usuario(0)];
        const miembros = [miembro(a, ["colab", "apoyo"]), miembro(b, ["otro"]), miembro(c, ["colab"], true)];
        const t0 = Date.parse("2026-10-14T10:00:00Z");
        expect(sueldos.pagarDia(GS, miembros, t0)).toEqual({ pagados: 1, total: 300 });
        expect(dinero.efectivo(a)).toBe(300 - 15); // impuesto de ingresos por defecto (5 %)
        expect(dinero.movimientos(a).filas.some((m) => m.tipo === "sueldo" && m.cantidad === 300)).toBe(true);
        expect(sueldos.pagarDia(GS, miembros, t0 + 3600000).pagados).toBe(0); // mismo día, aunque se reinicie
        expect(sueldos.pagarDia(GS, miembros, t0 + 86400000).pagados).toBe(1); // al día siguiente
        expect([dinero.efectivo(b), dinero.efectivo(c)]).toEqual([0, 0]);
    });

    test("quien pierde el rol deja de cobrar; quitar el sueldo y validar", () => {
        const GS2 = "g-f7-sueldos2";
        sueldos.fijar(GS2, "rol", 50);
        const u = usuario(0);
        const t0 = Date.parse("2026-11-01T10:00:00Z");
        expect(sueldos.pagarDia(GS2, [miembro(u, ["rol"])], t0).pagados).toBe(1);
        expect(sueldos.pagarDia(GS2, [miembro(u, [])], t0 + 86400000).pagados).toBe(0);
        expect(sueldos.fijar(GS2, "rol", 0).ok).toBe(true);
        expect(sueldos.listar(GS2)).toEqual([]);
        expect(sueldos.fijar(GS2, "rol", -5).ok).toBe(false);
    });
});

describe("fechas de Madrid (#413, #409)", () => {
    test("convierte invierno y verano, y rechaza lo que no es una fecha", () => {
        expect(new Date(fechaMadridAMs("15/01/2027 10:30")).toISOString()).toBe("2027-01-15T09:30:00.000Z");
        expect(new Date(fechaMadridAMs("15/07/2027 10:30")).toISOString()).toBe("2027-07-15T08:30:00.000Z");
        expect(new Date(fechaMadridAMs("01/12/2026")).toISOString()).toBe("2026-11-30T23:00:00.000Z");
        expect(fechaMadridAMs("31/02/2027")).toBeNull();
        expect(fechaMadridAMs("mañana")).toBeNull();
    });
});
