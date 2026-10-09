// Objetos de protección contra robos (F-EC-06c): dos objetos nuevos a la venta en la tienda, con un efecto que /robar
// mira en el inventario de la víctima (ver systems/robar.js). Son objetos normales: después se cambian (precio, stock,
// efecto...) o se crean más en /paneladmin → 🛒 Catálogo. Solo se crean si no hay ya alguno con ese efecto.
const OBJETOS = [
    {
        nombre: "Candado",
        descripcion:
            "Mientras lo tengas en el inventario, al próximo que intente robarte le costará mucho más (un 30 % menos de " +
            "probabilidad). Se gasta con ese intento, salga como salga.",
        efecto: "antirrobo:30",
        precio: 150,
    },
    {
        nombre: "Trampa para ladrones",
        descripcion:
            "Mientras la tengas en el inventario, si alguien intenta robarte y le sale mal, paga el triple de multa. Se gasta " +
            "cuando salta.",
        efecto: "trampa:3",
        precio: 100,
    },
];

function up(db) {
    const insertarObjeto = db.prepare(
        "INSERT INTO objeto (nombre, descripcion, tipo, unico, categoria, rareza, efecto) VALUES (?, ?, 'coleccionable', 0, 'protección', 'común', ?)",
    );
    const aLaVenta = db.prepare("INSERT INTO tienda (objetoId, precio, stock) VALUES (?, ?, NULL)");
    for (const o of OBJETOS) {
        const [tipo] = o.efecto.split(":");
        if (db.prepare("SELECT 1 FROM objeto WHERE efecto LIKE ?").get(`${tipo}:%`)) continue;
        const { lastInsertRowid } = insertarObjeto.run(o.nombre, o.descripcion, o.efecto);
        aLaVenta.run(lastInsertRowid, o.precio);
    }
}

module.exports = { up };
