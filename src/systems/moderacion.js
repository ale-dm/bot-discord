// ⚠️ Avisos y strikes de moderación (#542): las reglas y la BD, sin Discord. Cada aviso del staff es un strike; solo cuentan
// los de los últimos `moderacion.caducidad_dias` que no se hayan retirado, y el histórico no se borra nunca. Al cruzar un
// umbral se sugiere una medida (aviso serio, silenciar 24 h, expulsión o ban), pero el bot no sanciona solo.
const db = require("../core/db");
const guildSettings = require("./guildSettings");

const DIA_MS = 24 * 60 * 60 * 1000;
const MOTIVO_MIN = 3;
const MOTIVO_MAX = 300;
const UMBRAL_MAX = 100;
const CADUCIDAD_MAX = 3650;
/** Las medidas que se sugieren, en orden, con el ajuste de su umbral. */
const MEDIDAS = [
    { clave: "aviso", ajuste: "umbral_aviso", texto: "⚠️ Aviso serio" },
    { clave: "mute", ajuste: "umbral_mute", texto: "🔇 Silenciar 24 horas" },
    { clave: "expulsion", ajuste: "umbral_expulsion", texto: "👢 Expulsión" },
    { clave: "ban", ajuste: "umbral_ban", texto: "🔨 Ban" },
];

/** Los ajustes de moderación del servidor, ya con los umbrales en orden. */
function ajustes(guildId) {
    const m = guildSettings.getSettings(guildId).moderacion;
    return {
        staffRol: String(m.staff_rol || ""),
        canalLog: String(m.canal_log || ""),
        caducidadDias: Number(m.caducidad_dias) || 90,
        umbrales: MEDIDAS.map((medida) => ({ ...medida, n: Number(m[medida.ajuste]) })),
    };
}

/** ¿Puede avisar? Con Moderar miembros, siendo admin o con el rol de staff configurado. */
function puedeAvisar(member, guildId) {
    if (!member) return false;
    const permisos = member.permissions;
    if (permisos?.has?.("ModerateMembers") || permisos?.has?.("Administrator")) return true;
    const rol = ajustes(guildId).staffRol;
    return Boolean(rol) && Boolean(member.roles?.cache?.has?.(rol));
}

const desde = (guildId, ahora) => ahora - ajustes(guildId).caducidadDias * DIA_MS;

/** Cuántos strikes vigentes tiene: no retirados y de dentro del plazo de caducidad. */
function vigentes(guildId, userId, ahora = Date.now()) {
    return db
        .prepare("SELECT COUNT(*) AS n FROM strikes WHERE guildId = ? AND userId = ? AND estado = 'vigente' AND creado > ?")
        .get(String(guildId), String(userId), desde(guildId, ahora)).n;
}

/** El umbral que se cruza al pasar de `antes` a `despues` strikes, o null. */
function umbralCruzado(guildId, antes, despues) {
    return (
        ajustes(guildId)
            .umbrales.filter((u) => u.n > antes && u.n <= despues)
            .at(-1) || null
    );
}

/** La medida que toca con `n` strikes vigentes (la del umbral más alto alcanzado), o null. */
function medidaPara(guildId, n) {
    return (
        ajustes(guildId)
            .umbrales.filter((u) => n >= u.n)
            .at(-1) || null
    );
}

/**
 * Apunta un aviso. @returns {{ ok: true, id, vigentes, umbral } | { ok: false, motivo: string }}
 */
function avisar({ guildId, userId, staffId, motivo }, ahora = Date.now()) {
    const texto = String(motivo ?? "").trim();
    if (texto.length < MOTIVO_MIN || texto.length > MOTIVO_MAX)
        return { ok: false, motivo: `El motivo tiene que tener de ${MOTIVO_MIN} a ${MOTIVO_MAX} caracteres.` };
    if (String(userId) === String(staffId)) return { ok: false, motivo: "No puedes avisarte a ti mismo." };
    const antes = vigentes(guildId, userId, ahora);
    const { lastInsertRowid } = db
        .prepare("INSERT INTO strikes (guildId, userId, staffId, motivo, creado) VALUES (?, ?, ?, ?, ?)")
        .run(String(guildId), String(userId), String(staffId), texto, ahora);
    const despues = vigentes(guildId, userId, ahora);
    return { ok: true, id: Number(lastInsertRowid), vigentes: despues, umbral: umbralCruzado(guildId, antes, despues) };
}

/** El historial de una persona, el más reciente primero, con su estado de ahora (vigente, caducado o retirado). */
function historial(guildId, userId, ahora = Date.now()) {
    const limite = desde(guildId, ahora);
    return db
        .prepare("SELECT * FROM strikes WHERE guildId = ? AND userId = ? ORDER BY creado DESC, id DESC")
        .all(String(guildId), String(userId))
        .map((s) => ({ ...s, situacion: s.estado === "retirado" ? "retirado" : s.creado > limite ? "vigente" : "caducado" }));
}

/** Retira un strike (deja quién y cuándo). Solo si es de ese servidor y no estaba retirado. @returns {object | null} */
function retirar(guildId, id, adminId, ahora = Date.now()) {
    const s = db.prepare("SELECT * FROM strikes WHERE id = ? AND guildId = ?").get(Number(id), String(guildId));
    if (!s || s.estado === "retirado") return null;
    db.prepare("UPDATE strikes SET estado = 'retirado', retiradoPor = ?, retiradoEn = ? WHERE id = ?").run(String(adminId), ahora, s.id);
    return s;
}

/** Retira todos los strikes no retirados de una persona. @returns {number} cuántos */
function limpiar(guildId, userId, adminId, ahora = Date.now()) {
    return db
        .prepare(
            "UPDATE strikes SET estado = 'retirado', retiradoPor = ?, retiradoEn = ? WHERE guildId = ? AND userId = ? AND estado = 'vigente'",
        )
        .run(String(adminId), ahora, String(guildId), String(userId)).changes;
}

/** Quienes tienen strikes vigentes, de más a menos. */
function conStrikes(guildId, ahora = Date.now(), limite = 15) {
    return db
        .prepare(
            `SELECT userId, COUNT(*) AS n FROM strikes WHERE guildId = ? AND estado = 'vigente' AND creado > ?
             GROUP BY userId ORDER BY n DESC, MAX(creado) DESC LIMIT ?`,
        )
        .all(String(guildId), desde(guildId, ahora), limite);
}

/**
 * Valida los números del formulario de ajustes: caducidad de 1 a 3650 días y umbrales de 1 a 100, de menor a mayor.
 * @returns {{ ok: true, valores: object } | { ok: false, motivo: string }}
 */
function validarAjustes({ caducidad, aviso, mute, expulsion, ban }) {
    const n = (t) => (/^\d{1,4}$/.test(String(t ?? "").trim()) ? Number(String(t).trim()) : NaN);
    const dias = n(caducidad);
    if (!(dias >= 1 && dias <= CADUCIDAD_MAX)) return { ok: false, motivo: `La caducidad va de 1 a ${CADUCIDAD_MAX} días.` };
    const umbrales = [aviso, mute, expulsion, ban].map(n);
    if (umbrales.some((u) => !(u >= 1 && u <= UMBRAL_MAX))) return { ok: false, motivo: `Cada umbral va de 1 a ${UMBRAL_MAX}.` };
    if (umbrales.some((u, i) => i > 0 && u <= umbrales[i - 1]))
        return { ok: false, motivo: "Los umbrales van de menor a mayor: aviso < silenciar < expulsión < ban." };
    const [a, m, e, b] = umbrales;
    return { ok: true, valores: { caducidad_dias: dias, umbral_aviso: a, umbral_mute: m, umbral_expulsion: e, umbral_ban: b } };
}

module.exports = {
    DIA_MS,
    MOTIVO_MAX,
    MEDIDAS,
    ajustes,
    puedeAvisar,
    vigentes,
    medidaPara,
    avisar,
    historial,
    retirar,
    limpiar,
    conStrikes,
    validarAjustes,
};
