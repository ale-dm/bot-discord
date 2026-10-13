// #473: los repositorios (src/repositorios) con la base en memoria: cada consulta devuelve lo que los paneles esperan, y los
// paneles, comandos y juegos ya no escriben SQL (db.prepare) por su cuenta.
const fs = require("fs");
const path = require("path");
const db = require("../src/core/db");
const dinero = require("../src/repositorios/dinero");
const casino = require("../src/repositorios/casino");
const catalogo = require("../src/repositorios/catalogo");
const apuestas = require("../src/repositorios/apuestas");
const sistema = require("../src/repositorios/sistema");

describe("dinero", () => {
    test("sumar al banco, al negro o al efectivo, resetear la cuenta y leer el resumen", () => {
        db.prepare("INSERT INTO banco (userId, saldo, enMano, negro) VALUES ('repo-1', 10, 20, 30)").run();
        dinero.sumarA("banco", 5, "repo-1");
        dinero.sumarA("negro", 7, "repo-1");
        dinero.sumarA("efectivo", 100, "repo-1");
        expect(dinero.resumenCuenta("repo-1")).toEqual({ saldo: 15, enMano: 120, negro: 37 });
        dinero.resetearCuenta("repo-1", 1000);
        expect(dinero.resumenCuenta("repo-1")).toEqual({ saldo: 0, enMano: 1000, negro: 0 });
        expect(dinero.totalCuentas()).toBeGreaterThanOrEqual(1);
    });

    test("el historial se pagina, se resume y se borra por persona", () => {
        for (let i = 0; i < 7; i++) {
            db.prepare("INSERT INTO historial (userId, fecha, descripcion, cantidad, tipo) VALUES ('repo-2', ?, ?, ?, 'otro')").run(
                `2026-01-0${i + 1}`,
                `mov ${i}`,
                i,
            );
        }
        expect(dinero.ultimosMovimientos("repo-2", 5).map((m) => m.descripcion)).toEqual(["mov 6", "mov 5", "mov 4", "mov 3", "mov 2"]);
        expect(dinero.historialGlobal(3, 0)).toHaveLength(3);
        expect(dinero.totalMovimientos()).toBeGreaterThanOrEqual(7);
        dinero.borrarHistorial("repo-2");
        expect(dinero.ultimosMovimientos("repo-2", 5)).toEqual([]);
    });

    test("registrar un usuario no pisa uno que ya existe", () => {
        dinero.registrarUsuario("repo-3", "Ana", "ana#1", "2026-01-01");
        dinero.registrarUsuario("repo-3", "Otra", "otra#2", "2026-02-02");
        expect(db.prepare("SELECT nombre FROM usuarios WHERE id = 'repo-3'").get().nombre).toBe("Ana");
    });
});

describe("casino", () => {
    test("resumen, favorito, últimas partidas y totales de quien juega", () => {
        const ins = db.prepare(
            "INSERT INTO casino (userId, juego, fecha, apuesta, resultado, detalle) VALUES ('repo-4', ?, ?, ?, ?, '{}')",
        );
        ins.run("ruleta", "2026-01-01T10:00:00Z", 100, 100);
        ins.run("ruleta", "2026-01-01T11:00:00Z", 100, -100);
        ins.run("ppt", "2026-01-01T12:00:00Z", 50, -50);
        expect(casino.resumenJugador("repo-4", "", [])).toMatchObject({
            total: 3,
            apostado: 250,
            ganancia: -50,
            mejor: 100,
            wins: 1,
            losses: 2,
        });
        expect(casino.resumenJugador("repo-4", " AND juego = ?", ["ruleta"]).total).toBe(2);
        expect(casino.juegoFavorito("repo-4")).toMatchObject({ juego: "ruleta", cnt: 2 });
        expect(casino.ultimasPartidas("repo-4", 2).map((p) => p.juego)).toEqual(["ppt", "ruleta"]);
        expect(casino.porJuego("repo-4", "", []).map((p) => [p.juego, p.p])).toEqual([
            ["ruleta", 2],
            ["ppt", 1],
        ]);
        expect(casino.historialReciente("repo-4")).toHaveLength(3);
        expect(casino.totalesCasino("repo-4")).toEqual({ ganado: 100, perdido: 150 });
        expect(casino.estadisticasBlackjack("repo-4").partidas).toBe(0);
    });
});

describe("catálogo", () => {
    test("crear un objeto, ponerlo a la venta, cambiarlo, quitarlo y borrarlo", () => {
        const { lastInsertRowid: id } = catalogo.crearObjeto("Gorro", "Un gorro", null, "cosmetico", null, null);
        expect(catalogo.objetoPorId(id)).toMatchObject({ nombre: "Gorro", unico: 0 });
        catalogo.ponerEnVenta(id, 50, null);
        expect(catalogo.objetoEstaEnVenta(id)).toBe(true);
        const venta = catalogo.ventaDeObjeto(id);
        catalogo.cambiarVenta(80, 3, venta.id);
        expect(catalogo.listarObjetosConVenta().find((o) => o.id === id)).toMatchObject({ precio: 80, stock: 3 });
        catalogo.editarCampoObjeto("nombre", "Gorro rojo", id);
        expect(catalogo.objetoPorId(id).nombre).toBe("Gorro rojo");
        expect(catalogo.quitarDeVenta(id).changes).toBe(1);
        expect(catalogo.alguienTieneObjeto(id)).toBe(false);
        catalogo.borrarObjeto(id);
        expect(catalogo.objetoPorId(id)).toBeUndefined();
    });
});

describe("apuestas y sistema", () => {
    test("las consultas sin datos devuelven vacío, no fallan", () => {
        expect(apuestas.quinielaAbierta(999999)).toBeUndefined();
        expect(apuestas.ultimaQuinielaAbierta("laliga")).toBeUndefined();
        expect(apuestas.yaApostoQuiniela(999999, "x")).toBe(false);
        expect(apuestas.boteQuiniela(999999)).toBe(0);
        expect(apuestas.pendientesPorDeporte()).toEqual([]);
        expect(apuestas.quinielasAbiertas()).toEqual([]);
        expect(apuestas.partidosCaducadosDesde("2026-01-01")).toBe(0);
        expect(sistema.usuariosDelBanco()).toBeGreaterThanOrEqual(0);
        expect(sistema.ultimoPrecioTtcl()).toMatchObject({ precio: expect.any(Number) });
        expect(sistema.tenedoresDeTtcl()).toBe(0);
    });
});

test("paneles, panel de admin, comandos y juegos no escriben SQL: pasan por los repositorios", () => {
    const sql = [];
    const recorrer = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) recorrer(p);
            else if (e.name.endsWith(".js") && /\.prepare\(/.test(fs.readFileSync(p, "utf8")))
                sql.push(path.relative(path.join(__dirname, ".."), p));
        }
    };
    for (const d of ["paneles", "adminPanel", "commands", "juegos"]) recorrer(path.join(__dirname, "../src", d));
    expect(sql).toEqual([]);
});
