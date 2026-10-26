// 🗳️ Partido político y eslogan de cada candidato a las elecciones: los escribe el finalista junto con su programa y salen en
// el panel, en la papeleta, en los programas que llegan por DM y en los resultados. Ver systems/elecciones/candidatos.js.
function up(db) {
    const columnas = new Set(
        db
            .prepare("PRAGMA table_info(elecciones_candidatos)")
            .all()
            .map((c) => c.name),
    );
    if (!columnas.has("partido")) db.exec("ALTER TABLE elecciones_candidatos ADD COLUMN partido TEXT");
    if (!columnas.has("eslogan")) db.exec("ALTER TABLE elecciones_candidatos ADD COLUMN eslogan TEXT");
}

module.exports = { up };
