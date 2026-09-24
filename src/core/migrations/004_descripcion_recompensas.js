// Descripción de lo que desbloquea cada rol de recompensa (se muestra en /nivel → Recompensas).
// Antes estaban escritas en nivel.js con los IDs de los roles de este servidor; ahora van en
// la BD y se editan en Panel admin → Niveles → Recompensas → Descripción.
const { addColumnIfMissing } = require("./index");

// Lo que había en nivel.js: roleId -> [emoji, descripción].
const DESCRIPCIONES_ANTERIORES = {
    "1474059393531117568": ["👍", "Añadir reacciones"],
    "1474049838722187557": ["✏️", "Cambiar tu propio apodo"],
    "1474047749732171981": ["🔊", "Acceso al panel de sonidos"],
    "1474049913829462016": ["🚶", "Mover usuarios entre canales de voz"],
    "1474059221128446067": ["🚪", "Echar usuarios de canales de voz"],
    "1474049727493312643": ["📝", "Cambiar el apodo de otros usuarios"],
    "1474059347117080769": ["🔇", "Silenciar usuarios en voz"],
};

function up(db, { log }) {
    addColumnIfMissing(db, "xp_role_rewards", "descripcion", "TEXT");
    addColumnIfMissing(db, "xp_role_rewards", "emoji", "TEXT");
    const upd = db.prepare("UPDATE xp_role_rewards SET emoji = ?, descripcion = ? WHERE roleId = ? AND descripcion IS NULL");
    let n = 0;
    for (const [roleId, [emoji, desc]] of Object.entries(DESCRIPCIONES_ANTERIORES)) n += upd.run(emoji, desc, roleId).changes;
    if (n) log.info(`${n} descripciones de recompensas copiadas a la BD`);
}

module.exports = { up };
