// Liga de pronósticos por temporada (F-AP-12, #8): guarda qué temporada ya se liquidó en cada servidor, con sus
// campeones y los premios pagados. Los puntos no se guardan aquí: salen de quiniela_apuestas (ver systems/apuestas/liga.js).
function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS liga_temporadas (
            guildId TEXT NOT NULL,
            temporada TEXT NOT NULL,
            campeones TEXT NOT NULL DEFAULT '[]',
            liquidada_en INTEGER NOT NULL,
            PRIMARY KEY (guildId, temporada)
        );
    `);
}

module.exports = { up };
