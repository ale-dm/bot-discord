// ⚽ Apuestas y quinielas, fase 4 (#340, #345, #361, #384):
// - quiniela_borrador: los pronósticos a medio elegir de una quiniela (uno por persona y quiniela, «1X-2…» con «-» donde falta).
// - quiniela_recordadas: a quién ya se le avisó de una quiniela sin enviar (una vez por quiniela y persona).
// - apuestas_resumen_semanal: a quién ya se le mandó el resumen de una semana (`semana` = el lunes, AAAA-MM-DD, en Madrid).
// - alertas_cuota: el aviso por DM cuando la cuota de una elección llega a un valor (`direccion`: arriba o abajo). Se borra al
//   dispararse o al empezar el partido. Ver systems/apuestas/ (borradorQuiniela, recordatorios, resumenSemanal y alertasCuota).
function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS quiniela_borrador (
            userId TEXT NOT NULL,
            quinielaId INTEGER NOT NULL,
            pronosticos TEXT NOT NULL,
            actualizado_en INTEGER NOT NULL,
            PRIMARY KEY (userId, quinielaId)
        );
        CREATE TABLE IF NOT EXISTS quiniela_recordadas (
            quinielaId INTEGER NOT NULL,
            userId TEXT NOT NULL,
            enviado_en INTEGER NOT NULL,
            PRIMARY KEY (quinielaId, userId)
        );
        CREATE TABLE IF NOT EXISTS apuestas_resumen_semanal (
            userId TEXT NOT NULL,
            semana TEXT NOT NULL,
            enviado_en INTEGER NOT NULL,
            PRIMARY KEY (userId, semana)
        );
        CREATE TABLE IF NOT EXISTS alertas_cuota (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            userId TEXT NOT NULL,
            match_id TEXT NOT NULL,
            eleccion TEXT NOT NULL,
            objetivo REAL NOT NULL,
            direccion TEXT NOT NULL,
            creada_en INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_alertas_cuota_partido ON alertas_cuota (match_id);
        CREATE INDEX IF NOT EXISTS idx_alertas_cuota_usuario ON alertas_cuota (userId);
    `);
}

module.exports = { up };
