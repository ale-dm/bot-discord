// 🔔 Avisos de cooldown (#434): quien pulsa «Avisarme» cuando /trabajar o /robar le dicen que espere deja aquí una fila con el
// momento (ms) en que acaba el cooldown. Un cron manda el DM al vencer y la borra, así que cada aviso sale una sola vez, y como
// vive en la base de datos sobrevive a un reinicio. `guildId` es '' para /robar (su cooldown es global, no por servidor). La
// clave evita que pulsar dos veces cree dos avisos. Ver systems/avisosCooldown.js.
function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS avisos_cooldown (
            userId TEXT NOT NULL,
            comando TEXT NOT NULL,
            guildId TEXT NOT NULL DEFAULT '',
            cuando INTEGER NOT NULL,
            PRIMARY KEY (userId, comando, guildId)
        );
        CREATE INDEX IF NOT EXISTS idx_avisos_cooldown_cuando ON avisos_cooldown(cuando);
    `);
}

module.exports = { up };
