// 🚫 Bloqueos de retos (#450): quien bloquea no recibe retos de la persona bloqueada. Es en un solo sentido: la fila
// (bloqueador, bloqueado) no impide que el bloqueador rete al bloqueado. Ver systems/retos/bloqueos.js.
function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS retos_bloqueos (
            bloqueador TEXT NOT NULL,
            bloqueado TEXT NOT NULL,
            creado_en INTEGER NOT NULL,
            PRIMARY KEY (bloqueador, bloqueado)
        );
    `);
}

module.exports = { up };
