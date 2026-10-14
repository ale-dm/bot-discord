// 🏪 Negocios y blanqueo (F-EC-06d, #80). Se compran con dinero del banco. Cada uno da una capacidad de
// blanqueo al día (un tope conjunto que se reinicia a las 00:00, hora de Madrid) y un ingreso diario en efectivo.
// El dinero negro que se deposita se limpia en 24 h, repartido a lo largo del día, y al limpiarse pasa al efectivo
// pagando impuesto como cualquier ingreso (dinero.pagarConImpuesto).
const db = require("../core/db");
const dinero = require("./dinero");
const { madridDateStr } = require("./xp/rachas");
const { createLogger } = require("../core/logger");
const { fmtNumero } = require("../core/formato");

const log = createLogger("Negocios");

const LIMPIEZA_MS = 24 * 3600 * 1000;
/** % del precio pagado que se recupera al vender un negocio (va al banco). */
const VENTA_PCT = 50;

const CATALOGO = {
    lavanderia: { nombre: "Lavandería", emoji: "🧺", precio: 15000, blanqueoDia: 7500, ingresoDia: 100 },
    correos: { nombre: "Oficina de correos", emoji: "📦", precio: 38000, blanqueoDia: 15000, ingresoDia: 250 },
    tunel: { nombre: "Túnel de lavado", emoji: "🚗", precio: 75000, blanqueoDia: 22500, ingresoDia: 500 },
    taco: { nombre: "Taco Ticklers", emoji: "🌮", precio: 190000, blanqueoDia: 30000, ingresoDia: 800 },
};

/** Mejoras (#387): hasta el nivel 3. `multiplicador` escala el blanqueo y el ingreso diarios del negocio; `coste` (× el precio base) es lo que cuesta subir a ese nivel. */
const NIVELES = {
    1: { multiplicador: 1, coste: 0 },
    2: { multiplicador: 1.5, coste: 1 },
    3: { multiplicador: 2, coste: 2 },
};
const NIVEL_MAX = 3;

/** El blanqueo y el ingreso diarios de un negocio según su nivel (redondeados hacia abajo). */
function valoresDeNivel(tipo, nivel = 1) {
    const c = CATALOGO[tipo];
    const m = NIVELES[nivel]?.multiplicador ?? 1;
    return { blanqueoDia: Math.floor(c.blanqueoDia * m), ingresoDia: Math.floor(c.ingresoDia * m) };
}

/** Lo que cuesta subir un negocio de `tipo` al nivel `nivel`. */
const costeDeMejora = (tipo, nivel) => Math.floor(CATALOGO[tipo].precio * NIVELES[nivel].coste);

const diaDe = (ahora) => madridDateStr(new Date(ahora));

function negociosDe(userId) {
    return db
        .prepare("SELECT userId, tipo, guildId, pagado, comprado_en, ultimo_ingreso_dia, nivel FROM negocios_usuario WHERE userId = ?")
        .all(String(userId));
}

function capacidadDiaria(userId) {
    return negociosDe(userId).reduce((total, n) => total + (CATALOGO[n.tipo] ? valoresDeNivel(n.tipo, n.nivel).blanqueoDia : 0), 0);
}

function usadoHoy(userId, ahora = Date.now()) {
    const row = db.prepare("SELECT depositado FROM blanqueo_dia WHERE userId = ? AND dia = ?").get(String(userId), diaDe(ahora));
    return Number(row?.depositado || 0);
}

function disponibleHoy(userId, ahora = Date.now()) {
    return Math.max(0, capacidadDiaria(userId) - usadoHoy(userId, ahora));
}

function enLimpieza(userId) {
    return db
        .prepare("SELECT COALESCE(SUM(cantidad - liberado), 0) AS n FROM blanqueo_lotes WHERE userId = ? AND liberado < cantidad")
        .get(String(userId)).n;
}

/** Compra un negocio con el dinero del banco. Lo que se paga queda guardado para calcular la venta. */
function comprar(userId, guildId, tipo, ahora = Date.now()) {
    const n = CATALOGO[tipo];
    if (!n) return { ok: false, mensaje: "❌ Ese negocio no existe." };
    if (negociosDe(userId).some((x) => x.tipo === tipo)) return { ok: false, mensaje: `❌ Ya tienes ${n.nombre}.` };
    return db.transaction(() => {
        if (!dinero.cobrarBanco(userId, n.precio)) {
            return {
                ok: false,
                mensaje: `❌ Para comprar ${n.nombre} necesitas **${fmtNumero(n.precio)}** 🪙 en el banco. Ingresa antes (🏦 Ingresar).`,
            };
        }
        dinero.apuntar(userId, "negocio", `Compra: ${n.nombre}`, -n.precio);
        // El primer ingreso diario llega el día siguiente a la compra.
        db.prepare(
            "INSERT INTO negocios_usuario (userId, tipo, guildId, pagado, comprado_en, ultimo_ingreso_dia) VALUES (?, ?, ?, ?, ?, ?)",
        ).run(String(userId), tipo, guildId, n.precio, ahora, diaDe(ahora));
        log.info(`${userId} compra ${tipo} por ${n.precio}`);
        return { ok: true, mensaje: `🏪 Has comprado **${n.nombre}** por **${fmtNumero(n.precio)}** 🪙 del banco.` };
    })();
}

/** Sube un negocio al siguiente nivel (hasta el 3), pagando del banco. Lo pagado se suma a lo que devuelve la venta. */
function mejorar(userId, tipo) {
    const n = CATALOGO[tipo];
    const suyo = negociosDe(userId).find((x) => x.tipo === tipo);
    if (!n || !suyo) return { ok: false, mensaje: "❌ No tienes ese negocio." };
    if (suyo.nivel >= NIVEL_MAX) return { ok: false, mensaje: `❌ ${n.nombre} ya está al nivel máximo (${NIVEL_MAX}).` };
    const nivel = suyo.nivel + 1;
    const coste = costeDeMejora(tipo, nivel);
    return db.transaction(() => {
        if (!dinero.cobrarBanco(userId, coste)) {
            return {
                ok: false,
                mensaje: `❌ Mejorar ${n.nombre} al nivel ${nivel} cuesta **${fmtNumero(coste)}** 🪙 del banco. Ingresa antes (🏦 Ingresar).`,
            };
        }
        dinero.apuntar(userId, "negocio", `Mejora: ${n.nombre} (nivel ${nivel})`, -coste);
        db.prepare("UPDATE negocios_usuario SET nivel = ?, pagado = pagado + ? WHERE userId = ? AND tipo = ?").run(
            nivel,
            coste,
            String(userId),
            tipo,
        );
        const v = valoresDeNivel(tipo, nivel);
        log.info(`${userId} mejora ${tipo} al nivel ${nivel} por ${coste}`);
        return {
            ok: true,
            mensaje: `⬆️ **${n.nombre}** sube al nivel **${nivel}** por **${fmtNumero(coste)}** 🪙: blanquea ${fmtNumero(v.blanqueoDia)}/día y da +${fmtNumero(v.ingresoDia)} 🪙/día.`,
        };
    })();
}

/** Vende un negocio: vuelve al banco el 50 % de lo pagado. */
function vender(userId, tipo) {
    const n = CATALOGO[tipo];
    const row = db
        .prepare(
            "SELECT userId, tipo, guildId, pagado, comprado_en, ultimo_ingreso_dia FROM negocios_usuario WHERE userId = ? AND tipo = ?",
        )
        .get(String(userId), tipo);
    if (!n || !row) return { ok: false, mensaje: "❌ No tienes ese negocio." };
    const devuelto = Math.floor((row.pagado * VENTA_PCT) / 100);
    return db.transaction(() => {
        db.prepare("DELETE FROM negocios_usuario WHERE userId = ? AND tipo = ?").run(String(userId), tipo);
        dinero.pagarBanco(userId, devuelto);
        dinero.apuntar(userId, "negocio", `Venta: ${n.nombre} (${VENTA_PCT} %)`, devuelto);
        log.info(`${userId} vende ${tipo} por ${devuelto}`);
        return { ok: true, mensaje: `🏪 Has vendido **${n.nombre}**: recuperas **${fmtNumero(devuelto)}** 🪙 en el banco.` };
    })();
}

/** Deposita dinero negro para limpiarlo: sale del negro y se libera en 24 h, dentro del tope del día. */
function depositar(userId, guildId, cantidad, ahora = Date.now()) {
    if (!Number.isInteger(cantidad) || cantidad <= 0) {
        return { ok: false, mensaje: "❌ La cantidad tiene que ser un número entero mayor que cero." };
    }
    if (!negociosDe(userId).length) return { ok: false, mensaje: "❌ No tienes ningún negocio donde limpiar dinero. Compra uno primero." };
    const libre = disponibleHoy(userId, ahora);
    if (cantidad > libre) {
        return {
            ok: false,
            mensaje: libre
                ? `❌ Hoy solo te queda capacidad para **${fmtNumero(libre)}** 🪙 (se reinicia a las 00:00, hora de Madrid).`
                : "❌ Hoy ya has usado toda la capacidad de tus negocios (se reinicia a las 00:00, hora de Madrid).",
        };
    }
    return db.transaction(() => {
        if (!dinero.cobrarNegro(userId, cantidad)) {
            return { ok: false, mensaje: `❌ No tienes tanto dinero negro. Tienes **${fmtNumero(dinero.negro(userId))}** 🪙.` };
        }
        dinero.apuntar(userId, "blanqueo", "Dinero negro a limpiar en los negocios", -cantidad);
        db.prepare("INSERT INTO blanqueo_lotes (userId, guildId, cantidad, liberado, inicio, fin) VALUES (?, ?, ?, 0, ?, ?)").run(
            String(userId),
            guildId,
            cantidad,
            ahora,
            ahora + LIMPIEZA_MS,
        );
        db.prepare(
            "INSERT INTO blanqueo_dia (userId, dia, depositado) VALUES (?, ?, ?) ON CONFLICT(userId, dia) DO UPDATE SET depositado = depositado + excluded.depositado",
        ).run(String(userId), diaDe(ahora), cantidad);
        return {
            ok: true,
            mensaje: `🧼 Has depositado **${fmtNumero(cantidad)}** 🪙 de dinero negro. Se limpiará en 24 h, repartido a lo largo del día.`,
        };
    })();
}

/**
 * Cron: libera lo que ya toca de cada depósito (proporcional al tiempo pasado) y lo paga al efectivo con su
 * impuesto. @returns {number} cuánto se ha blanqueado en esta pasada
 */
function avanzarLotes(ahora = Date.now()) {
    let total = 0;
    for (const lote of db
        .prepare("SELECT id, userId, guildId, cantidad, liberado, inicio, fin FROM blanqueo_lotes WHERE liberado < cantidad")
        .all()) {
        const liberable =
            ahora >= lote.fin ? lote.cantidad : Math.floor((lote.cantidad * (ahora - lote.inicio)) / (lote.fin - lote.inicio));
        const delta = liberable - lote.liberado;
        if (delta <= 0) continue;
        const ok = db.transaction(() => {
            const r = db
                .prepare("UPDATE blanqueo_lotes SET liberado = ? WHERE id = ? AND liberado = ?")
                .run(liberable, lote.id, lote.liberado);
            if (r.changes !== 1) return false;
            dinero.pagarConImpuesto(lote.userId, lote.guildId, "blanqueo", "Dinero blanqueado en los negocios", delta);
            return true;
        })();
        if (ok) total += delta;
    }
    return total;
}

/** Cron: paga el ingreso diario de cada negocio una vez por día (hora de Madrid). @returns {number} pagos hechos */
function pagarIngresosDiarios(ahora = Date.now()) {
    const hoy = diaDe(ahora);
    let pagos = 0;
    for (const n of db
        .prepare(
            "SELECT userId, tipo, guildId, pagado, comprado_en, ultimo_ingreso_dia, nivel FROM negocios_usuario WHERE ultimo_ingreso_dia IS NULL OR ultimo_ingreso_dia < ?",
        )
        .all(hoy)) {
        const c = CATALOGO[n.tipo];
        if (!c) continue;
        db.transaction(() => {
            const r = db
                .prepare(
                    "UPDATE negocios_usuario SET ultimo_ingreso_dia = ? WHERE userId = ? AND tipo = ? AND (ultimo_ingreso_dia IS NULL OR ultimo_ingreso_dia < ?)",
                )
                .run(hoy, n.userId, n.tipo, hoy);
            if (r.changes !== 1) return;
            dinero.pagarConImpuesto(
                n.userId,
                n.guildId,
                "negocio",
                `Ingreso diario: ${c.nombre}`,
                valoresDeNivel(n.tipo, n.nivel).ingresoDia,
            );
            pagos++;
        })();
    }
    return pagos;
}

/** Cron (cada 5 min): avanza el blanqueo y paga los ingresos del día. */
function revisar(ahora = Date.now()) {
    return { blanqueado: avanzarLotes(ahora), ingresos: pagarIngresosDiarios(ahora) };
}

/** Lo que hace falta para pintar el panel de negocios de alguien. */
function estado(userId, ahora = Date.now()) {
    return {
        negocios: negociosDe(userId).map((n) => ({ ...n, ...CATALOGO[n.tipo], ...valoresDeNivel(n.tipo, n.nivel) })),
        capacidad: capacidadDiaria(userId),
        usadoHoy: usadoHoy(userId, ahora),
        disponibleHoy: disponibleHoy(userId, ahora),
        enLimpieza: enLimpieza(userId),
    };
}

module.exports = {
    CATALOGO,

    VENTA_PCT,
    NIVEL_MAX,
    valoresDeNivel,
    costeDeMejora,
    mejorar,
    capacidadDiaria,
    disponibleHoy,
    comprar,
    vender,
    depositar,
    avanzarLotes,
    pagarIngresosDiarios,
    revisar,
    estado,
};
