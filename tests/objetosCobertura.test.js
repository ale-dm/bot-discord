// Inventario y uso de objetos (systems/objetos.js): qué tiene cada persona (agrupado y con filtros), qué objetos se
// pueden usar y qué pasa al usarlos: rol de Discord, consumibles (monedas, mensaje, sin efecto) y fallos. Usa la BD en
// memoria real (objeto, inventario, banco); el miembro y el servidor son objetos simulados.
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const objetos = require("../src/systems/objetos");

const G = "g-objetos";
let uid = 0;
const nuevoUsuario = () => `obj-user-${++uid}`;

function crearObjeto({ nombre, tipo, rolId = null, efecto = null, categoria = "general", rareza = "comun" }) {
    return Number(
        db
            .prepare("INSERT INTO objeto (nombre, descripcion, tipo, rolId, efecto, categoria, rareza) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .run(nombre, `${nombre} de prueba`, tipo, rolId, efecto, categoria, rareza).lastInsertRowid,
    );
}

function dar(userId, itemId, fecha = new Date().toISOString()) {
    return Number(db.prepare("INSERT INTO inventario (userId, itemId, fecha) VALUES (?, ?, ?)").run(userId, itemId, fecha).lastInsertRowid);
}

const cuantos = (userId, itemId) =>
    db.prepare("SELECT COUNT(*) AS n FROM inventario WHERE userId = ? AND itemId = ?").get(userId, itemId).n;

// Colección con find (como la de discord.js), además de get/has/keys del Map.
function coleccion(items) {
    const m = new Map(items.map((r) => [r.id, r]));
    m.find = (fn) => [...m.values()].find(fn);
    return m;
}

function servidor(roles = []) {
    return { id: G, name: "Servidor de objetos", roles: { cache: coleccion(roles) } };
}

function miembro(id, roles = []) {
    const cache = new Map(roles.map((r) => [r.id, r]));
    return {
        id,
        roles: {
            cache,
            add: jest.fn(async (rol) => {
                cache.set(rol.id, rol);
            }),
        },
    };
}

afterEach(() => jest.restoreAllMocks());

describe("esUsable", () => {
    test("solo los roles y los consumibles se pueden usar, sin distinguir mayúsculas", () => {
        expect(objetos.esUsable({ tipo: "rol" })).toBe(true);
        expect(objetos.esUsable({ tipo: "CONSUMIBLE" })).toBe(true);
        expect(objetos.esUsable({ tipo: "coleccionable" })).toBe(false);
        expect(objetos.esUsable({ tipo: null })).toBe(false);
        expect(objetos.esUsable(undefined)).toBe(false);
    });
});

describe("inventarioDe: qué tiene cada persona", () => {
    test("agrupa las copias de cada objeto y pone primero lo más reciente", () => {
        const u = nuevoUsuario();
        const a = crearObjeto({ nombre: "Pulsera", tipo: "coleccionable" });
        const b = crearObjeto({ nombre: "Pergamino", tipo: "coleccionable" });
        dar(u, a);
        dar(u, b);
        dar(u, a);

        const inv = objetos.inventarioDe(u);

        expect(inv.map((o) => [o.nombre, o.cantidad])).toEqual([
            ["Pulsera", 2],
            ["Pergamino", 1],
        ]);
        expect(inv[0].itemId).toBe(a);
    });

    test("los filtros por categoría y rareza se combinan", () => {
        const u = nuevoUsuario();
        const epico = crearObjeto({ nombre: "Corona", tipo: "coleccionable", categoria: "lujo", rareza: "epica" });
        const comun = crearObjeto({ nombre: "Piedra", tipo: "coleccionable", categoria: "lujo", rareza: "comun" });
        const otra = crearObjeto({ nombre: "Pala", tipo: "coleccionable", categoria: "trabajo", rareza: "epica" });
        dar(u, epico);
        dar(u, comun);
        dar(u, otra);

        expect(objetos.inventarioDe(u, { categoria: "lujo" }).map((o) => o.nombre)).toEqual(["Piedra", "Corona"]);
        expect(objetos.inventarioDe(u, { rareza: "epica" }).map((o) => o.nombre)).toEqual(["Pala", "Corona"]);
        expect(objetos.inventarioDe(u, { categoria: "lujo", rareza: "epica" }).map((o) => o.nombre)).toEqual(["Corona"]);
    });

    test("no mezcla el inventario de otras personas", () => {
        const u = nuevoUsuario();
        const otro = nuevoUsuario();
        const a = crearObjeto({ nombre: "Ajeno", tipo: "coleccionable" });
        dar(otro, a);

        expect(objetos.inventarioDe(u)).toEqual([]);
    });
});

describe("usarObjeto: aplicar el efecto de un objeto", () => {
    test("un objeto que no está en el inventario no se puede usar", async () => {
        const u = nuevoUsuario();
        const id = crearObjeto({ nombre: "Ajeno", tipo: "consumible", efecto: "mensaje:hola" });

        const r = await objetos.usarObjeto(u, id, miembro(u), servidor(), "tester");

        expect(r).toEqual({ ok: false, mensaje: "❌ No tienes ese objeto en tu inventario.", obj: null });
    });

    describe("consumibles", () => {
        test("monedas: se gasta una copia y el dinero entra por el cauce normal (con impuesto si lo hay)", async () => {
            const u = nuevoUsuario();
            const id = crearObjeto({ nombre: "Saco", tipo: "consumible", efecto: "monedas:500" });
            dar(u, id);
            dar(u, id);
            const pagar = jest.spyOn(dinero, "pagarConImpuesto");
            const antes = dinero.efectivo(u);

            const r = await objetos.usarObjeto(u, id, miembro(u), servidor(), "tester");

            expect(r.ok).toBe(true);
            expect(r.mensaje).toBe("🪙 ¡Has recibido **500 monedas**!");
            expect(pagar).toHaveBeenCalledWith(u, G, "objeto", "Efecto consumible: Saco", 500);
            expect(dinero.efectivo(u)).toBeGreaterThan(antes);
            expect(cuantos(u, id)).toBe(1);
        });

        test("con monedas que no son un número, el efecto da 0 y el objeto se gasta igualmente", async () => {
            const u = nuevoUsuario();
            const id = crearObjeto({ nombre: "Saco roto", tipo: "consumible", efecto: "monedas:abc" });
            dar(u, id);

            const r = await objetos.usarObjeto(u, id, miembro(u), servidor(), "tester");

            expect(r).toMatchObject({ ok: true, mensaje: "🪙 ¡Has recibido **0 monedas**!" });
            expect(cuantos(u, id)).toBe(0);
        });

        test("mensaje: muestra el texto tal cual, aunque lleve dos puntos", async () => {
            const u = nuevoUsuario();
            const id = crearObjeto({ nombre: "Nota", tipo: "consumible", efecto: "mensaje:Hora: a dormir" });
            dar(u, id);

            const r = await objetos.usarObjeto(u, id, miembro(u), servidor(), "tester");

            expect(r).toMatchObject({ ok: true, mensaje: "✨ Hora: a dormir" });
            expect(cuantos(u, id)).toBe(0);
        });

        test("sin efecto definido solo se consume y lo dice", async () => {
            const u = nuevoUsuario();
            const id = crearObjeto({ nombre: "Caramelo", tipo: "consumible", efecto: null });
            dar(u, id);

            const r = await objetos.usarObjeto(u, id, miembro(u), servidor(), "tester");

            expect(r).toMatchObject({ ok: true, mensaje: "✅ Has usado **Caramelo**." });
            expect(cuantos(u, id)).toBe(0);
        });

        test("el tipo no distingue mayúsculas al decidir si se gasta", async () => {
            const u = nuevoUsuario();
            const id = crearObjeto({ nombre: "Mayus", tipo: "Consumible", efecto: "mensaje:ok" });
            dar(u, id);

            await objetos.usarObjeto(u, id, miembro(u), servidor(), "tester");

            expect(cuantos(u, id)).toBe(0);
        });

        test("usa la copia más antigua del inventario", async () => {
            const u = nuevoUsuario();
            const id = crearObjeto({ nombre: "Doble", tipo: "consumible", efecto: "mensaje:x" });
            const primera = dar(u, id);
            const segunda = dar(u, id);

            await objetos.usarObjeto(u, id, miembro(u), servidor(), "tester");

            const quedan = db
                .prepare("SELECT id FROM inventario WHERE userId = ? AND itemId = ?")
                .all(u, id)
                .map((f) => f.id);
            expect(quedan).toEqual([segunda]);
            expect(quedan).not.toContain(primera);
        });

        test("si el efecto falla, el objeto vuelve al inventario y se avisa", async () => {
            const u = nuevoUsuario();
            const id = crearObjeto({ nombre: "Saco maldito", tipo: "consumible", efecto: "monedas:100" });
            dar(u, id);
            jest.spyOn(dinero, "pagarConImpuesto").mockImplementationOnce(() => {
                throw new Error("BD caída");
            });

            const r = await objetos.usarObjeto(u, id, miembro(u), servidor(), "tester");

            expect(r.ok).toBe(false);
            expect(r.mensaje).toBe("⚠️ Ha fallado al aplicar el efecto. No has perdido el objeto.");
            expect(r.obj).toMatchObject({ nombre: "Saco maldito" });
            expect(cuantos(u, id)).toBe(1);
        });
    });

    describe("roles de Discord", () => {
        test("asigna el rol por su ID y no gasta el objeto", async () => {
            const u = nuevoUsuario();
            const rol = { id: "9001", name: "VIP" };
            const id = crearObjeto({ nombre: "Pase VIP", tipo: "rol", rolId: "9001" });
            dar(u, id);
            const m = miembro(u);

            const r = await objetos.usarObjeto(u, id, m, servidor([rol]), "tester");

            expect(r).toMatchObject({ ok: true, mensaje: "🎭 Se te ha asignado el rol **VIP**." });
            expect(m.roles.add).toHaveBeenCalledWith(rol);
            expect(cuantos(u, id)).toBe(1);
        });

        test("si el ID ya no existe busca el rol por nombre, sin distinguir mayúsculas", async () => {
            const u = nuevoUsuario();
            const rol = { id: "9002", name: "Moderador" };
            const id = crearObjeto({ nombre: "moderador", tipo: "rol", rolId: null });
            dar(u, id);
            const m = miembro(u);

            const r = await objetos.usarObjeto(u, id, m, servidor([rol]), "tester");

            expect(r.ok).toBe(true);
            expect(m.roles.add).toHaveBeenCalledWith(rol);
        });

        test("si el rol no existe en el servidor, no se asigna nada", async () => {
            const u = nuevoUsuario();
            const id = crearObjeto({ nombre: "Fantasma", tipo: "rol", rolId: "404" });
            dar(u, id);
            const m = miembro(u);

            const r = await objetos.usarObjeto(u, id, m, servidor([]), "tester");

            expect(r).toMatchObject({ ok: false, mensaje: "❌ No se encontró el rol de Discord correspondiente." });
            expect(m.roles.add).not.toHaveBeenCalled();
        });

        test("si ya tiene el rol, lo dice y no lo vuelve a dar", async () => {
            const u = nuevoUsuario();
            const rol = { id: "9003", name: "Ya lo tengo" };
            const id = crearObjeto({ nombre: "Ya lo tengo", tipo: "rol", rolId: "9003" });
            dar(u, id);
            const m = miembro(u, [rol]);

            const r = await objetos.usarObjeto(u, id, m, servidor([rol]), "tester");

            expect(r).toMatchObject({ ok: false, mensaje: "❌ Ya tienes el rol **Ya lo tengo**." });
            expect(m.roles.add).not.toHaveBeenCalled();
        });

        test("si Discord rechaza la asignación, falla con aviso y el objeto se conserva", async () => {
            const u = nuevoUsuario();
            const rol = { id: "9004", name: "Protegido" };
            const id = crearObjeto({ nombre: "Protegido", tipo: "rol", rolId: "9004" });
            dar(u, id);
            const m = miembro(u);
            m.roles.add.mockRejectedValueOnce(new Error("Missing Permissions"));

            const r = await objetos.usarObjeto(u, id, m, servidor([rol]), "tester");

            expect(r).toMatchObject({ ok: false, mensaje: "⚠️ Ha fallado al aplicar el efecto. No has perdido el objeto." });
            expect(cuantos(u, id)).toBe(1);
        });
    });

    test("un objeto de otro tipo (coleccionable) no tiene efecto y no se gasta", async () => {
        const u = nuevoUsuario();
        const id = crearObjeto({ nombre: "Cromo", tipo: "coleccionable" });
        dar(u, id);

        const r = await objetos.usarObjeto(u, id, miembro(u), servidor(), "tester");

        expect(r).toMatchObject({ ok: false, mensaje: "⚠️ Este objeto no tiene un efecto definido." });
        expect(cuantos(u, id)).toBe(1);
    });
});
