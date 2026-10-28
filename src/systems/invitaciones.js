// 📨 Recompensa por invitar (#522): se apunta quién invitó a cada miembro que entra con una invitación creada por un miembro
// (la vanity del servidor no cuenta) y, cuando el invitado «madura» (7 días en el servidor y nivel 5), quien invitó cobra
// 500 monedas, más 2.500, 5.000 y 15.000 al llegar a 5, 10 y 25 invitados madurados.
// Anti-abuso: cada persona solo cuenta una vez por servidor (salir y volver no paga otra vez); no cuentan las cuentas de
// Discord de menos de 7 días, invitarse a uno mismo, las invitaciones cruzadas (A invita a B y B a A) ni las ráfagas (más de
// 10 invitados en 24 h: los que pasan de ahí quedan inválidos); si el invitado se va antes de madurar, no se paga.
// Sin Discord: averiguar qué invitación se usó y el cron están en discord/envios/invitaciones.js.
const db = require("../core/db");
const dinero = require("./dinero");

const DIA_MS = 24 * 3600 * 1000;
const DIAS_MADURAR = 7;
const NIVEL_MADURAR = 5;
const EDAD_CUENTA_DIAS = 7;
const RAFAGA_MAX = 10;
const RECOMPENSA = 500;
const HITOS = [
    { invitados: 5, premio: 2500 },
    { invitados: 10, premio: 5000 },
    { invitados: 25, premio: 15000 },
];

/**
 * Qué invitación se ha usado: la que ha subido de usos respecto a la foto anterior, o una nueva con un uso. Sin la vanity.
 * @param {Map<string, number>} antes código → usos
 * @param {{ code: string, uses: number, inviterId: string | null }[]} despues
 * @returns {{ code: string, inviterId: string } | null} null si no se sabe (ninguna o más de una)
 */
function invitacionUsada(antes, despues, vanity = null) {
    const candidatas = despues.filter(
        (i) => i.inviterId && i.code !== vanity && (antes.has(i.code) ? i.uses > antes.get(i.code) : i.uses === 1),
    );
    return candidatas.length === 1 ? { code: candidatas[0].code, inviterId: candidatas[0].inviterId } : null;
}

/** Por qué una entrada no cuenta, o null si cuenta. */
function motivoInvalida({ guildId, invitadoId, invitadorId, cuentaCreada }, ahora) {
    if (String(invitadoId) === String(invitadorId)) return "autoinvitación";
    if (cuentaCreada && ahora - cuentaCreada < EDAD_CUENTA_DIAS * DIA_MS) return "cuenta nueva";
    const cruzada = db
        .prepare("SELECT 1 FROM invitaciones WHERE guildId = ? AND invitadoId = ? AND invitadorId = ?")
        .get(String(guildId), String(invitadorId), String(invitadoId));
    if (cruzada) return "invitación cruzada";
    const recientes = db
        .prepare("SELECT COUNT(*) FROM invitaciones WHERE guildId = ? AND invitadorId = ? AND entro_en > ?")
        .pluck()
        .get(String(guildId), String(invitadorId), ahora - DIA_MS);
    if (recientes >= RAFAGA_MAX) return "ráfaga";
    return null;
}

/**
 * Apunta una entrada. Si esa persona ya entró antes en el servidor (aunque saliera), no se apunta otra vez.
 * @returns {{ ok: true, estado: string, motivo: string | null } | { ok: false, motivo: string }}
 */
function registrar({ guildId, invitadoId, invitadorId, codigo = null, cuentaCreada = null }, ahora = Date.now()) {
    const antes = db.prepare("SELECT 1 FROM invitaciones WHERE guildId = ? AND invitadoId = ?").get(String(guildId), String(invitadoId));
    if (antes) return { ok: false, motivo: "ya había entrado antes" };
    const motivo = motivoInvalida({ guildId, invitadoId, invitadorId, cuentaCreada }, ahora);
    const estado = motivo ? "invalida" : "pendiente";
    db.prepare(
        "INSERT INTO invitaciones (guildId, invitadoId, invitadorId, codigo, entro_en, estado, motivo) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(String(guildId), String(invitadoId), String(invitadorId), codigo, ahora, estado, motivo);
    return { ok: true, estado, motivo };
}

/** Las pendientes que ya llevan 7 días (las que hay que mirar si maduran). */
const porMadurar = (ahora = Date.now()) =>
    db.prepare("SELECT * FROM invitaciones WHERE estado = 'pendiente' AND entro_en <= ?").all(ahora - DIAS_MADURAR * DIA_MS);

const maduradas = (guildId, invitadorId) =>
    db
        .prepare("SELECT COUNT(*) FROM invitaciones WHERE guildId = ? AND invitadorId = ? AND estado = 'madurada'")
        .pluck()
        .get(String(guildId), String(invitadorId));

/**
 * Mira si una invitación pendiente madura: si el invitado se ha ido, se cierra sin pagar; si ya tiene el nivel, se paga a
 * quien invitó (y el hito, si toca). Una sola vez. @returns {{ estado, pagado, hito } | null} null si sigue pendiente
 */
function madurar({ guildId, invitadoId, esMiembro, nivel }, ahora = Date.now()) {
    return db.transaction(() => {
        const inv = db
            .prepare("SELECT * FROM invitaciones WHERE guildId = ? AND invitadoId = ? AND estado = 'pendiente'")
            .get(String(guildId), String(invitadoId));
        if (!inv || ahora - inv.entro_en < DIAS_MADURAR * DIA_MS) return null;
        if (!esMiembro) {
            db.prepare("UPDATE invitaciones SET estado = 'salio' WHERE guildId = ? AND invitadoId = ?").run(inv.guildId, inv.invitadoId);
            return { estado: "salio", pagado: 0, hito: null, invitadorId: inv.invitadorId };
        }
        if (nivel < NIVEL_MADURAR) return null;
        const hito = HITOS.find((h) => h.invitados === maduradas(guildId, inv.invitadorId) + 1) || null;
        const pagado = RECOMPENSA + (hito?.premio || 0);
        db.prepare("UPDATE invitaciones SET estado = 'madurada', madurada_en = ?, recompensa = ? WHERE guildId = ? AND invitadoId = ?").run(
            ahora,
            pagado,
            inv.guildId,
            inv.invitadoId,
        );
        dinero.pagarConImpuesto(
            inv.invitadorId,
            guildId,
            "premio",
            `Invitación de ${inv.invitadoId}${hito ? ` (hito de ${hito.invitados} invitados)` : ""}`,
            pagado,
        );
        return { estado: "madurada", pagado, hito, invitadorId: inv.invitadorId };
    })();
}

/** Lo de alguien: sus invitados por estado, lo cobrado y el próximo hito. */
function resumen(guildId, userId) {
    const filas = db
        .prepare("SELECT * FROM invitaciones WHERE guildId = ? AND invitadorId = ? ORDER BY entro_en DESC")
        .all(String(guildId), String(userId));
    const cuenta = (estado) => filas.filter((f) => f.estado === estado).length;
    const hechas = cuenta("madurada");
    return {
        filas,
        pendientes: cuenta("pendiente"),
        maduradas: hechas,
        invalidas: cuenta("invalida"),
        salieron: cuenta("salio"),
        cobrado: filas.reduce((s, f) => s + f.recompensa, 0),
        proximoHito: HITOS.find((h) => h.invitados > hechas) || null,
    };
}

/** Los que más invitados madurados tienen en el servidor. */
const ranking = (guildId, limite = 10) =>
    db
        .prepare(
            `SELECT invitadorId AS userId, COUNT(*) AS invitados FROM invitaciones WHERE guildId = ? AND estado = 'madurada'
             GROUP BY invitadorId ORDER BY invitados DESC, MIN(madurada_en) LIMIT ?`,
        )
        .all(String(guildId), limite);

module.exports = {
    DIAS_MADURAR,
    NIVEL_MADURAR,
    EDAD_CUENTA_DIAS,
    RAFAGA_MAX,
    RECOMPENSA,
    HITOS,
    invitacionUsada,
    registrar,
    porMadurar,
    madurar,
    resumen,
    ranking,
};
