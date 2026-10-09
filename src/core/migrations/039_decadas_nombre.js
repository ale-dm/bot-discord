// Los trofeos de década creados antes se llamaban «Máquina del tiempo: los 80» (dos dígitos, que se leía mal con los
// años 1920). Ahora el nombre y la descripción llevan el año entero. Solo cambia el texto de los que el código creó
// (nombre_ia = 0); el id (decada:1980) no cambia, así que la persona que ya lo tenía lo sigue teniendo.

function up(db) {
    const filas = db
        .prepare(
            "SELECT guildId, id, nombre, descripcion FROM plex_trofeos WHERE tipo = 'decada' AND nombre_ia = 0 AND nombre LIKE 'Máquina del tiempo: los %'",
        )
        .all();
    const actualizar = db.prepare("UPDATE plex_trofeos SET nombre = ?, descripcion = ? WHERE guildId = ? AND id = ?");
    for (const f of filas) {
        const anio = Number(f.id.replace("decada:", ""));
        if (!Number.isInteger(anio)) continue;
        actualizar.run(`Máquina del tiempo: los años ${anio}`, f.descripcion.replace(/los años \S+$/, `los años ${anio}`), f.guildId, f.id);
    }
}

module.exports = { up };
