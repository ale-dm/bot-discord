// 🧩 Combinadas (#1): un boleto con varios partidos (de 2 a 5, un partido por pata). La cuota total es el producto de las
// cuotas de las patas y el premio es lo apostado × esa cuota; se gana solo si aciertan todas. Una pata que falla cierra el
// boleto al liquidarse su partido. Si un partido se caduca sin resultado, el boleto se devuelve entero.
// Las elecciones son 1X2 y los mercados de goles y hándicap (no el marcador exacto: su premio es fijo y no cuadra aquí).
// Lo que cada uno va sumando antes de apostar está en combinada_borrador: es privado (se ve solo a quien lo arma).
const db = require("../../core/db");
const dinero = require("../dinero");
const limites = require("./limites");
const mercados = require("./mercados");
const directo = require("./directo");
const { logInfo } = require("../../core/logger");

const MIN_PATAS = 2;
const MAX_PATAS = 5;
const MIN_APUESTA = Number(process.env.MIN_BET_AMOUNT || 10);
const MAX_APUESTA = Number(process.env.MAX_BET_AMOUNT || 1000);
const ELECCIONES_1X2 = ["home", "draw", "away"];

/** Cuota total de un boleto: el producto de las cuotas de las patas, con dos decimales. */
function cuotaTotal(cuotas) {
    return Math.round(cuotas.reduce((producto, c) => producto * c, 1) * 100) / 100;
}
const premioDe = (cantidad, cuota) => Math.round(cantidad * cuota);

/** La cuota de una elección en un partido abierto, o null si no se puede apostar a ella ahora. */
function cuotaDeEleccion(partido, eleccion) {
    if (!directo.abiertoParaApostar(partido)) return null;
    if (ELECCIONES_1X2.includes(eleccion)) {
        const cuota = { home: partido.cuota_home, draw: partido.cuota_draw, away: partido.cuota_away }[eleccion];
        return cuota && cuota >= 1 ? cuota : null;
    }
    if (mercados.esMercado(eleccion)) {
        const cuota = mercados.cuotaDe(partido, eleccion);
        return cuota && cuota >= 1 ? cuota : null;
    }
    return null;
}

const nombreDeEleccion = (partido, eleccion) =>
    mercados.textoEleccion({ ...partido, eleccion, linea: mercados.lineaDe(partido, eleccion) });

/** Lo que tiene armado alguien: [{ matchId, eleccion, cuota, linea, partido }] con los datos del partido. */
function borrador(userId) {
    return db
        .prepare(
            `SELECT b.match_id AS matchId, b.eleccion, b.cuota, b.linea, p.*
             FROM combinada_borrador b JOIN apuestas_partidos p ON p.match_id = b.match_id
             WHERE b.user_id = ? ORDER BY p.start_time ASC`,
        )
        .all(String(userId))
        .map((r) => ({ matchId: r.matchId, eleccion: r.eleccion, cuota: r.cuota, linea: r.linea, partido: r }));
}

/**
 * Suma una elección de un partido al boleto (sustituye la que hubiera de ese partido: un partido, una pata).
 * @returns {{ ok: boolean, mensaje: string }}
 */
function sumar(userId, matchId, eleccion) {
    const partido = db.prepare("SELECT * FROM apuestas_partidos WHERE match_id = ?").get(String(matchId));
    const cuota = cuotaDeEleccion(partido, eleccion);
    if (!cuota) return { ok: false, mensaje: "❌ Ese partido ya ha empezado o no tiene cuota para esa elección." };
    const actual = borrador(userId);
    const yaEsta = actual.some((p) => p.matchId === partido.match_id);
    if (!yaEsta && actual.length >= MAX_PATAS) {
        return { ok: false, mensaje: `❌ Una combinada admite como mucho **${MAX_PATAS}** partidos. Quita uno antes.` };
    }
    const linea = mercados.esMercado(eleccion) ? mercados.lineaDe(partido, eleccion) : null;
    db.prepare(
        `INSERT INTO combinada_borrador (user_id, match_id, eleccion, cuota, linea) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id, match_id) DO UPDATE SET eleccion = excluded.eleccion, cuota = excluded.cuota, linea = excluded.linea`,
    ).run(String(userId), partido.match_id, eleccion, cuota, linea);
    const pata = nombreDeEleccion(partido, eleccion);
    return { ok: true, mensaje: `✅ **${pata}** en ${partido.home_team} vs ${partido.away_team} (cuota ${cuota}).` };
}

function quitar(userId, matchId) {
    return db.prepare("DELETE FROM combinada_borrador WHERE user_id = ? AND match_id = ?").run(String(userId), String(matchId)).changes > 0;
}

function vaciar(userId) {
    db.prepare("DELETE FROM combinada_borrador WHERE user_id = ?").run(String(userId));
}

/**
 * Pone la combinada en juego: cobra el importe (efectivo y dinero negro, como las demás apuestas) y guarda el boleto con
 * sus patas. Comprueba otra vez cada partido y cada cuota, por si han cambiado desde que se sumaron.
 * @returns {{ ok: boolean, mensaje: string, id?: number, cuota?: number, premio?: number }}
 */
function apostar(guildId, userId, cantidad) {
    const patas = borrador(userId);
    if (patas.length < MIN_PATAS) {
        return { ok: false, mensaje: `❌ Una combinada necesita al menos **${MIN_PATAS}** partidos.` };
    }
    if (!Number.isInteger(cantidad) || cantidad < MIN_APUESTA || cantidad > MAX_APUESTA) {
        return { ok: false, mensaje: `❌ La cantidad debe estar entre ${MIN_APUESTA} y ${MAX_APUESTA} monedas.` };
    }
    for (const p of patas) {
        const ahora = cuotaDeEleccion(p.partido, p.eleccion);
        if (!ahora)
            return {
                ok: false,
                mensaje: `❌ **${p.partido.home_team} vs ${p.partido.away_team}** ya ha empezado o ha dejado de tener cuota. Quítalo y vuelve a sumarlo.`,
            };
        if (Math.abs(ahora - p.cuota) > 1e-9) {
            return {
                ok: false,
                mensaje: `❌ Ha cambiado la cuota de **${p.partido.home_team} vs ${p.partido.away_team}** (ahora ${ahora}). Vuelve a sumarlo.`,
            };
        }
    }
    if (dinero.saldoGastable(userId) < cantidad)
        return { ok: false, mensaje: "❌ No te llega el efectivo. Saca dinero del banco (💵 Sacar)." };
    const limite = limites.comprobar(guildId, userId, cantidad);
    if (limite) return { ok: false, mensaje: `🚦 ${limite}` };

    const cuota = cuotaTotal(patas.map((p) => p.cuota));
    const premio = premioDe(cantidad, cuota);
    const id = db.transaction(() => {
        if (!dinero.cobrarCombinado(userId, cantidad)) return null;
        const { lastInsertRowid } = db
            .prepare("INSERT INTO combinadas (user_id, cantidad, cuota, estado, creada_en) VALUES (?, ?, ?, 'abierta', ?)")
            .run(String(userId), cantidad, cuota, new Date().toISOString());
        const insertPata = db.prepare(
            "INSERT INTO combinada_patas (combinada_id, match_id, eleccion, cuota, linea, resultado) VALUES (?, ?, ?, ?, ?, 'pendiente')",
        );
        for (const p of patas) insertPata.run(lastInsertRowid, p.matchId, p.eleccion, p.cuota, p.linea);
        dinero.apuntar(userId, "apuestas", `Combinada de ${patas.length} partidos (cuota ${cuota})`, -cantidad);
        vaciar(userId);
        return lastInsertRowid;
    })();
    if (id === null) return { ok: false, mensaje: "❌ No te llega el efectivo. Saca dinero del banco (💵 Sacar)." };
    logInfo(`[Combinadas] ${userId} apostó ${cantidad} a una combinada de ${patas.length} partidos (cuota ${cuota}, premio ${premio})`);
    return { ok: true, mensaje: "✅ Combinada registrada.", id, cuota, premio };
}

/**
 * Se liquida un partido: cada pata que lo tenía pendiente acierta o falla; un boleto con una pata fallida se pierde; uno
 * con todas acertadas (y ninguna pendiente) se paga. Va dentro de la transacción de la liquidación.
 * @returns {{ userId, premio, descripcion }[]} los premios pagados ahora
 */
function resolverPartido(matchId, resultado, marcador) {
    const patas = db
        .prepare(
            `SELECT pa.*, c.user_id, c.cantidad, c.cuota AS cuota_total FROM combinada_patas pa JOIN combinadas c ON c.id = pa.combinada_id
             WHERE pa.match_id = ? AND pa.resultado = 'pendiente' AND c.estado = 'abierta'`,
        )
        .all(String(matchId));
    const pagos = [];
    for (const pata of patas) {
        const acierta = mercados.acierta(pata.eleccion, resultado, marcador, pata.linea);
        db.prepare("UPDATE combinada_patas SET resultado = ? WHERE id = ?").run(acierta ? "acierta" : "falla", pata.id);
        if (!acierta) {
            db.prepare("UPDATE combinadas SET estado = 'perdida', premio = 0 WHERE id = ?").run(pata.combinada_id);
            continue;
        }
        const pendientes = db
            .prepare("SELECT COUNT(*) AS n FROM combinada_patas WHERE combinada_id = ? AND resultado = 'pendiente'")
            .get(pata.combinada_id).n;
        if (pendientes > 0) continue;
        const premio = premioDe(pata.cantidad, pata.cuota_total);
        db.prepare("UPDATE combinadas SET estado = 'ganada', premio = ? WHERE id = ?").run(premio, pata.combinada_id);
        dinero.pagar(pata.user_id, premio);
        dinero.apuntar(pata.user_id, "apuestas", "Combinada ganada", premio);
        pagos.push({ userId: pata.user_id, premio, descripcion: `Combinada ganada (cuota ${pata.cuota_total})` });
        logInfo(`[Combinadas] Combinada ${pata.combinada_id} ganada por ${pata.user_id}: ${premio} monedas`);
    }
    return pagos;
}

/**
 * Se caduca un partido sin resultado: cada boleto abierto con una pata en ese partido se devuelve entero.
 * @param {(userId, cantidad, descripcion) => void} reembolsar
 */
function caducarPartido(matchId, reembolsar) {
    const boletos = db
        .prepare(
            `SELECT DISTINCT c.id, c.user_id, c.cantidad FROM combinadas c JOIN combinada_patas pa ON pa.combinada_id = c.id
             WHERE pa.match_id = ? AND c.estado = 'abierta'`,
        )
        .all(String(matchId));
    for (const b of boletos) {
        db.prepare("UPDATE combinada_patas SET resultado = 'caducada' WHERE combinada_id = ? AND resultado = 'pendiente'").run(b.id);
        db.prepare("UPDATE combinadas SET estado = 'reembolsada', premio = ? WHERE id = ?").run(b.cantidad, b.id);
        reembolsar(b.user_id, b.cantidad, "Reembolso: combinada con un partido sin resultado");
    }
    return boletos.length;
}

/** Las combinadas de alguien: las que siguen en juego y las últimas resueltas. */
function de(userId, limite = 5) {
    const abiertas = db
        .prepare("SELECT * FROM combinadas WHERE user_id = ? AND estado = 'abierta' ORDER BY creada_en DESC LIMIT ?")
        .all(String(userId), limite);
    const patas = (id) => db.prepare("SELECT * FROM combinada_patas WHERE combinada_id = ? ORDER BY id").all(id);
    return abiertas.map((c) => ({ ...c, patas: patas(c.id) }));
}

module.exports = {
    MIN_PATAS,
    MAX_PATAS,
    MIN_APUESTA,
    MAX_APUESTA,
    cuotaTotal,
    premioDe,
    cuotaDeEleccion,
    borrador,
    sumar,
    quitar,
    vaciar,
    apostar,
    resolverPartido,
    caducarPartido,
    de,
};
