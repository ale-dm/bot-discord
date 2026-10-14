// 🛡️ Pase de batalla, fase 5 (#300, #334, #335, #348):
// - pase_dias_perfectos: los días en que alguien completó las tres misiones (da un bonus de XP, una vez por día) y de donde sale la racha.
//   No lleva la temporada en la clave: la racha sigue aunque cambie la temporada.
// - pase_racha_premios: los hitos de racha ya premiados en cada racha (`inicio` = el primer día de esa racha), para darlos una sola vez.
// - pase_temporadas: el resumen de cada temporada ya cerrada de cada servidor (quién participó, el top, niveles y recompensas cobradas),
//   guardado una sola vez al cambiar de temporada.
// - pase_avisos_cierre: a quién ya se le avisó, en cada temporada, de las recompensas sin cobrar antes de que acabe.
// Ver systems/pase/ (misiones, rachas, historial y avisos).
function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS pase_dias_perfectos (
            guildId TEXT NOT NULL,
            userId TEXT NOT NULL,
            dia TEXT NOT NULL,
            temporada INTEGER NOT NULL,
            PRIMARY KEY (guildId, userId, dia)
        );
        CREATE TABLE IF NOT EXISTS pase_racha_premios (
            guildId TEXT NOT NULL,
            userId TEXT NOT NULL,
            inicio TEXT NOT NULL,
            hito INTEGER NOT NULL,
            PRIMARY KEY (guildId, userId, inicio, hito)
        );
        CREATE TABLE IF NOT EXISTS pase_temporadas (
            guildId TEXT NOT NULL,
            temporada INTEGER NOT NULL,
            cerrada_en INTEGER NOT NULL,
            participantes INTEGER NOT NULL,
            xp_total INTEGER NOT NULL,
            nivel_max INTEGER NOT NULL,
            reclamados INTEGER NOT NULL,
            monedas INTEGER NOT NULL,
            top TEXT NOT NULL,
            PRIMARY KEY (guildId, temporada)
        );
        CREATE TABLE IF NOT EXISTS pase_avisos_cierre (
            guildId TEXT NOT NULL,
            temporada INTEGER NOT NULL,
            userId TEXT NOT NULL,
            enviado_en INTEGER NOT NULL,
            PRIMARY KEY (guildId, temporada, userId)
        );
    `);
}

module.exports = { up };
