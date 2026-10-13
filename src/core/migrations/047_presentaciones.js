// 💬 Presentación personal del perfil (#430): una frase de hasta 150 caracteres que se ve en 👤 Perfil de /perfil. Una por
// persona (el perfil, como el dinero, no es de un servidor). Sin fila = sin presentación. Ver systems/presentaciones.js.
function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS presentaciones (
            userId TEXT PRIMARY KEY,
            texto TEXT NOT NULL,
            actualizado_en INTEGER NOT NULL
        );
    `);
}

module.exports = { up };
