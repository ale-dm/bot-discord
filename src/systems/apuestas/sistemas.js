// 🎛️ Apuestas de sistema (#534): con las patas del boleto de la combinada (3, 4 o 5 partidos) se juegan todas las
// subcombinaciones de un tamaño: 2 de 3 (3 combinaciones), 3 de 4 (4) o 3 de 5 (10). El importe es por combinación y el coste,
// el importe × las combinaciones, se cobra una vez. Al liquidar, cada subcombinación acertada paga importe × sus cuotas
// (redondeado por combinación); las falladas no. Una pata anulada (partido sin resultado) cuenta con cuota 1,00 y, si se
// anulan todas, se devuelve lo apostado. Coste máximo 50.000. Una jugada es de un tipo: no se mezcla con una combinada.
const db = require("../../core/db");
const dinero = require("../dinero");
const limites = require("./limites");
const combinadas = require("./combinadas");
const mercados = require("./mercados");
const { logInfo } = require("../../core/logger");

const TAMANOS = [
    { k: 2, m: 3 },
    { k: 3, m: 4 },
    { k: 3, m: 5 },
];
const MAX_PATAS = 6;
const MAX_COSTE = 50_000;

/** Los tamaños que se pueden jugar con `m` patas (los «k de m» permitidos). */
const tamanosPara = (m) => TAMANOS.filter((t) => t.m === m).map((t) => t.k);

/** Todas las subcombinaciones de k índices entre 0 y m − 1, en orden: [[0, 1], [0, 2], …]. */
function combinaciones(m, k) {
    const res = [];
    const paso = (desde, actual) => {
        if (actual.length === k) return void res.push([...actual]);
        for (let i = desde; i < m; i++) paso(i + 1, [...actual, i]);
    };
    paso(0, []);
    return res;
}

const cuotaDe = (cuotas) => Math.round(cuotas.reduce((p, c) => p * c, 1) * 100) / 100;

/**
 * Lo que costaría y podría pagar un sistema con esas patas: combinaciones, coste, premio si aciertan todas y cuántas patas
 * pueden fallar sin perderlo todo. null si el tamaño no vale para ese número de patas.
 */
function presupuesto(cuotas, k, cantidad) {
    const m = cuotas.length;
    if (!tamanosPara(m).includes(k)) return null;
    const combos = combinaciones(m, k).map((idx) => cuotaDe(idx.map((i) => cuotas[i])));
    return {
        k,
        m,
        combinaciones: combos.length,
        coste: combos.length * cantidad,
        premioMaximo: combos.reduce((t, c) => t + Math.round(cantidad * c), 0),
        puedenFallar: m - k,
    };
}

/**
 * Juega el boleto como sistema «k de m». Comprueba de nuevo cada partido y cada cuota, el importe, el coste, el saldo y los
 * límites; cobra el coste y guarda patas y combinaciones en una transacción, y vacía el boleto.
 * @returns {{ ok: true, id, ...presupuesto } | { ok: false, mensaje }}
 */
function apostar(guildId, userId, k, cantidad) {
    const patas = combinadas.borrador(userId);
    if (patas.length > MAX_PATAS) return { ok: false, mensaje: `❌ Un sistema admite como mucho ${MAX_PATAS} partidos.` };
    if (!tamanosPara(patas.length).includes(Number(k)))
        return { ok: false, mensaje: "❌ Ese sistema no vale para tu boleto: 2 de 3, 3 de 4 o 3 de 5 partidos." };
    if (!Number.isInteger(cantidad) || cantidad < combinadas.MIN_APUESTA || cantidad > combinadas.MAX_APUESTA)
        return { ok: false, mensaje: `❌ El importe por combinación va de ${combinadas.MIN_APUESTA} a ${combinadas.MAX_APUESTA}.` };
    for (const p of patas) {
        const ahora = combinadas.cuotaDeEleccion(p.partido, p.eleccion);
        if (!ahora || Math.abs(ahora - p.cuota) > 1e-9)
            return {
                ok: false,
                mensaje: `❌ **${p.partido.home_team} vs ${p.partido.away_team}** ha empezado o ha cambiado de cuota. Vuelve a sumarlo.`,
            };
    }
    const p = presupuesto(
        patas.map((x) => x.cuota),
        Number(k),
        cantidad,
    );
    if (p.coste > MAX_COSTE)
        return { ok: false, mensaje: `❌ El coste total (${p.coste}) pasa del máximo de ${MAX_COSTE.toLocaleString("es")}.` };
    if (dinero.saldoGastable(userId) < p.coste) return { ok: false, mensaje: "❌ No te llega el efectivo para el coste total." };
    const limite = limites.comprobar(guildId, userId, p.coste);
    if (limite) return { ok: false, mensaje: `🚦 ${limite}` };

    const id = db.transaction(() => {
        if (!dinero.cobrarCombinado(userId, p.coste)) return null;
        const { lastInsertRowid } = db
            .prepare("INSERT INTO sistemas (user_id, k, m, cantidad, combinaciones, coste, creada_en) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .run(String(userId), p.k, p.m, cantidad, p.combinaciones, p.coste, new Date().toISOString());
        const pata = db.prepare(
            "INSERT INTO sistema_patas (sistema_id, orden, match_id, eleccion, cuota, linea) VALUES (?, ?, ?, ?, ?, ?)",
        );
        patas.forEach((x, i) => pata.run(lastInsertRowid, i, x.matchId, x.eleccion, x.cuota, x.linea));
        const combo = db.prepare("INSERT INTO sistema_combinaciones (sistema_id, indices, cuota) VALUES (?, ?, ?)");
        for (const idx of combinaciones(p.m, p.k)) combo.run(lastInsertRowid, idx.join(","), cuotaDe(idx.map((i) => patas[i].cuota)));
        dinero.apuntar(userId, "apuestas", `Sistema ${p.k} de ${p.m} (${p.combinaciones} combinaciones de ${cantidad})`, -p.coste);
        combinadas.vaciar(userId);
        return Number(lastInsertRowid);
    })();
    if (id === null) return { ok: false, mensaje: "❌ No te llega el efectivo para el coste total." };
    logInfo(`[Sistemas] ${userId} jugó un sistema ${p.k} de ${p.m} por ${p.coste} (máximo ${p.premioMaximo})`);
    return { ok: true, id, ...p };
}

/**
 * Cierra un sistema si ya no le queda ninguna pata pendiente: paga cada combinación acertada o, si todas sus patas se
 * anularon, devuelve el coste. Va dentro de la transacción de la liquidación. @returns {object | null} el pago, si lo hay
 */
function cerrar(sistemaId) {
    const s = db.prepare("SELECT * FROM sistemas WHERE id = ? AND estado = 'abierta'").get(sistemaId);
    if (!s) return null;
    const patas = db.prepare("SELECT * FROM sistema_patas WHERE sistema_id = ? ORDER BY orden").all(s.id);
    if (patas.some((p) => p.resultado === "pendiente")) return null;
    const ahora = new Date().toISOString();
    if (patas.every((p) => p.resultado === "anulada")) {
        db.prepare("UPDATE sistemas SET estado = 'reembolsada', premio = ?, resuelta_en = ? WHERE id = ?").run(s.coste, ahora, s.id);
        dinero.pagar(s.user_id, s.coste);
        dinero.apuntar(s.user_id, "apuestas", `Reembolso: sistema ${s.k} de ${s.m} sin ningún partido jugado`, s.coste);
        return { userId: s.user_id, premio: s.coste, descripcion: "Reembolso de un sistema sin partidos jugados", reembolso: true };
    }
    let total = 0;
    for (const c of db.prepare("SELECT * FROM sistema_combinaciones WHERE sistema_id = ?").all(s.id)) {
        const suyas = c.indices.split(",").map((i) => patas[Number(i)]);
        const premio = suyas.some((p) => p.resultado === "falla")
            ? 0
            : Math.round(s.cantidad * suyas.reduce((t, p) => t * (p.resultado === "anulada" ? 1 : p.cuota), 1));
        db.prepare("UPDATE sistema_combinaciones SET premio = ? WHERE id = ?").run(premio, c.id);
        total += premio;
    }
    db.prepare("UPDATE sistemas SET estado = 'resuelta', premio = ?, resuelta_en = ? WHERE id = ?").run(total, ahora, s.id);
    if (!total) return null;
    dinero.pagar(s.user_id, total);
    dinero.apuntar(s.user_id, "apuestas", `Sistema ${s.k} de ${s.m} ganado`, total);
    logInfo(`[Sistemas] Sistema ${s.id} de ${s.user_id}: ${total} monedas`);
    return { userId: s.user_id, premio: total, descripcion: `Sistema ${s.k} de ${s.m}` };
}

/** Marca las patas de un partido (acierta, falla o anulada) y cierra los sistemas que ya no tienen nada pendiente. */
function marcarPartido(matchId, decidir) {
    const patas = db
        .prepare(
            `SELECT pa.* FROM sistema_patas pa JOIN sistemas s ON s.id = pa.sistema_id
             WHERE pa.match_id = ? AND pa.resultado = 'pendiente' AND s.estado = 'abierta'`,
        )
        .all(String(matchId));
    for (const p of patas) db.prepare("UPDATE sistema_patas SET resultado = ? WHERE id = ?").run(decidir(p), p.id);
    return [...new Set(patas.map((p) => p.sistema_id))].map(cerrar).filter(Boolean);
}

/** Se liquida un partido. @returns {object[]} los pagos hechos ahora */
const resolverPartido = (matchId, resultado, marcador) =>
    marcarPartido(matchId, (p) => (mercados.acierta(p.eleccion, resultado, marcador, p.linea) ? "acierta" : "falla"));

/** Un partido se caduca sin resultado: sus patas se anulan (cuota 1,00). @returns {object[]} los pagos hechos ahora */
const caducarPartido = (matchId) => marcarPartido(matchId, () => "anulada");

/** Los sistemas de alguien (abiertos o ya cerrados), con sus patas y combinaciones. */
function de(userId, { abiertas = true, limite = 3 } = {}) {
    return db
        .prepare(`SELECT * FROM sistemas WHERE user_id = ? AND estado ${abiertas ? "=" : "!="} 'abierta' ORDER BY id DESC LIMIT ?`)
        .all(String(userId), limite)
        .map((s) => ({
            ...s,
            patas: db
                .prepare(
                    `SELECT pa.*, p.home_team, p.away_team FROM sistema_patas pa LEFT JOIN apuestas_partidos p ON p.match_id = pa.match_id
                     WHERE pa.sistema_id = ? ORDER BY pa.orden`,
                )
                .all(s.id),
            combinaciones: db.prepare("SELECT * FROM sistema_combinaciones WHERE sistema_id = ? ORDER BY id").all(s.id),
        }));
}

module.exports = {
    TAMANOS,
    MAX_PATAS,
    MAX_COSTE,
    tamanosPara,
    combinaciones,
    presupuesto,
    apostar,
    cerrar,
    resolverPartido,
    caducarPartido,
    de,
};
