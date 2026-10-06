// Caché de embeddings de las notas del Duende (ver systems/duende/perfiles.notasRelevantes):
// un vector por nota, para buscar las más relacionadas con el mensaje actual en vez de darlas
// siempre todas. Solo caché: si se borra, se vuelve a calcular sola la próxima vez que haga falta.
function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS duende_notas_vectores (
            perfil_id INTEGER NOT NULL,
            nota_hash TEXT NOT NULL,
            vector TEXT NOT NULL,
            creado_en INTEGER,
            PRIMARY KEY (perfil_id, nota_hash)
        );
    `);
}

module.exports = { up };
