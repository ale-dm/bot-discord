// 🏦 Patrimonio (F-EC-10, #81). Cada persona tiene su propio ciclo semanal sobre el banco: primero paga el interés
// del saldo del banco y después el impuesto, sobre lo que pasa del umbral. Para el impuesto, la base es el banco más
// lo pagado por sus negocios (#80). Lo que no se pueda pagar del banco no se cobra (no genera deuda).
// La configuración es global (el dinero también lo es) y se edita desde Config Global → Impuestos.
const db = require("../core/db");
const dinero = require("./dinero");
const impuestos = require("./impuestos");
const { createLogger } = require("../core/logger");

const log = createLogger("Patrimonio");

const DIA_MS = 24 * 3600 * 1000;
const DEFECTO = { umbral: 50000, porcentaje: 1, interes: 0.5, dias: 7, destino: "bote", rolesExentos: [] };

// Quién tiene qué roles lo sabe Discord, no esta parte: index.js registra una función (guildId, userId) => lista de ids de rol (#397).
let rolesDe = () => [];
function usarResolutorDeRoles(fn) {
    rolesDe = fn;
}

function configuracion() {
    const guardada = db.prepare("SELECT valor FROM config WHERE clave = 'patrimonio'").get()?.valor;
    let c = {};
    try {
        c = guardada ? JSON.parse(guardada) : {};
    } catch {
        c = {};
    }
    return { ...DEFECTO, ...c };
}

/**
 * Valida y guarda la configuración. @returns {{ ok: true, cfg } | { ok: false, mensaje }}
 */
function guardarConfiguracion(entrada) {
    const umbral = Number(entrada.umbral);
    const porcentaje = Number(entrada.porcentaje);
    const interes = Number(entrada.interes);
    const dias = Number(entrada.dias);
    const destino = String(entrada.destino || "")
        .trim()
        .toLowerCase();
    if (!Number.isInteger(umbral) || umbral < 0) return { ok: false, mensaje: "El umbral tiene que ser un número entero, 0 o más." };
    if (!Number.isFinite(porcentaje) || porcentaje < 0 || porcentaje > 100)
        return { ok: false, mensaje: "El porcentaje del impuesto tiene que estar entre 0 y 100." };
    if (!Number.isFinite(interes) || interes < 0 || interes > 100)
        return { ok: false, mensaje: "El interés tiene que estar entre 0 y 100." };
    if (!Number.isInteger(dias) || dias < 1 || dias > 365)
        return { ok: false, mensaje: "Los días entre cobros tienen que estar entre 1 y 365." };
    if (!["bote", "sumidero"].includes(destino)) return { ok: false, mensaje: "El destino tiene que ser `bote` o `sumidero`." };
    const rolesExentos = Array.isArray(entrada.rolesExentos) ? entrada.rolesExentos.map(String) : configuracion().rolesExentos;
    const cfg = { umbral, porcentaje, interes, dias, destino, rolesExentos };
    db.prepare("INSERT INTO config (clave, valor) VALUES ('patrimonio', ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor").run(
        JSON.stringify(cfg),
    );
    return { ok: true, cfg };
}

/** El servidor donde se usó la economía por última vez (para el bote). null si no hay ninguno. */
function guildDe(userId) {
    return (
        db.prepare("SELECT guildId FROM xp_users WHERE userId = ? ORDER BY ultimo_msg DESC LIMIT 1").get(String(userId))?.guildId || null
    );
}

function valorNegocios(userId) {
    return db.prepare("SELECT COALESCE(SUM(pagado), 0) AS n FROM negocios_usuario WHERE userId = ?").get(String(userId)).n;
}

/** ¿Tiene alguno de los roles exentos del impuesto (#397)? El interés del banco lo cobra igual. */
function esExento(userId, cfg) {
    if (!cfg.rolesExentos?.length) return false;
    const guildId = guildDe(userId);
    return Boolean(guildId) && rolesDe(guildId, userId).some((r) => cfg.rolesExentos.includes(String(r)));
}

/** Lo que cobraría un ciclo ahora (sin tocar nada): { interes, impuesto }. Es el cálculo de aplicarCiclo (#347). */
function calcularCiclo(userId, cfg) {
    const banco = dinero.banco(userId);
    const interes = Math.floor((banco * cfg.interes) / 100);
    const base = banco + interes + valorNegocios(userId);
    const exceso = base - cfg.umbral;
    const deuda = exceso > 0 && !esExento(userId, cfg) ? Math.floor((exceso * cfg.porcentaje) / 100) : 0;
    return { interes, impuesto: Math.min(deuda, banco + interes) };
}

/**
 * Para 💰 Economía (#347): cuándo es el próximo cobro (ms; null si aún no se ha marcado su ciclo) y lo que cobraría si fuera ahora.
 * @returns {{ proximo: number|null, interes: number, impuesto: number }}
 */
function prevision(userId) {
    const cfg = configuracion();
    const fila = db.prepare("SELECT ultimo_ciclo FROM patrimonio_usuario WHERE userId = ?").get(String(userId));
    return { proximo: fila ? fila.ultimo_ciclo + cfg.dias * DIA_MS : null, ...calcularCiclo(userId, cfg) };
}

/**
 * Para 💰 Economía (#350): lo que ha dado el interés y lo que se ha llevado el impuesto de patrimonio, desde siempre y en los últimos 30
 * días. El impuesto de ingresos también usa el tipo `impuesto`: se distingue por la descripción. null si nunca ha habido cobros.
 */
function resumen(userId, ahora = Date.now()) {
    const desde = new Date(ahora - 30 * DIA_MS).toISOString();
    const suma = (cond, ...params) =>
        db
            .prepare(`SELECT COALESCE(SUM(cantidad), 0) AS n, COUNT(*) AS c FROM historial WHERE userId = ? AND ${cond}`)
            .get(String(userId), ...params);
    const interes = "tipo = 'patrimonio' AND descripcion = 'Interés semanal del banco'";
    const impuesto = "tipo = 'impuesto' AND descripcion = 'Impuesto de patrimonio'";
    const total = { interes: suma(interes), impuesto: suma(impuesto) };
    if (!total.interes.c && !total.impuesto.c) return null;
    const mes = { interes: suma(`${interes} AND fecha >= ?`, desde), impuesto: suma(`${impuesto} AND fecha >= ?`, desde) };
    const parte = (t) => ({ interes: t.interes.n, impuesto: -t.impuesto.n, neto: t.interes.n + t.impuesto.n });
    return { total: parte(total), mes: parte(mes) };
}

/** Un ciclo: interés sobre el banco y luego impuesto sobre lo que pasa del umbral. */
function aplicarCiclo(userId, cfg) {
    const prev = calcularCiclo(userId, cfg);
    const interes = prev.interes;
    if (interes > 0) {
        dinero.pagarBanco(userId, interes);
        dinero.apuntar(userId, "patrimonio", "Interés semanal del banco", interes);
    }

    const cobrado = prev.impuesto;
    if (cobrado > 0 && dinero.cobrarBanco(userId, cobrado)) {
        dinero.apuntar(userId, "impuesto", "Impuesto de patrimonio", -cobrado);
        if (cfg.destino === "bote") {
            const guildId = guildDe(userId);
            if (guildId) impuestos.sumarBote(guildId, cobrado);
        }
    }
    return { interes, cobrado };
}

/**
 * Cron (cada hora): a cada persona le toca su ciclo cuando han pasado `dias` desde el anterior. La primera vez que
 * aparece solo se marca su fecha, sin cobrar. @returns {{ ciclos, interes, cobrado }}
 */
function revisar(ahora = Date.now()) {
    const cfg = configuracion();
    const periodo = cfg.dias * DIA_MS;
    const total = { ciclos: 0, interes: 0, cobrado: 0 };
    const ultimoCiclo = db.prepare("SELECT ultimo_ciclo FROM patrimonio_usuario WHERE userId = ?");
    for (const { userId } of db.prepare("SELECT userId FROM banco").all()) {
        db.transaction(() => {
            const fila = ultimoCiclo.get(userId);
            if (!fila) {
                db.prepare("INSERT INTO patrimonio_usuario (userId, ultimo_ciclo) VALUES (?, ?)").run(userId, ahora);
                return;
            }
            if (ahora - fila.ultimo_ciclo < periodo) return;
            db.prepare("UPDATE patrimonio_usuario SET ultimo_ciclo = ? WHERE userId = ?").run(ahora, userId);
            const r = aplicarCiclo(userId, cfg);
            total.ciclos++;
            total.interes += r.interes;
            total.cobrado += r.cobrado;
        })();
    }
    if (total.ciclos) log.info(`Ciclo de patrimonio: ${total.ciclos} personas, interés ${total.interes}, impuesto ${total.cobrado}`);
    return total;
}

module.exports = {
    DEFECTO,
    configuracion,
    guardarConfiguracion,
    usarResolutorDeRoles,
    calcularCiclo,
    prevision,
    resumen,
    aplicarCiclo,
    revisar,
};
