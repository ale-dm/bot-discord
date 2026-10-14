// 🛒 Economía, tienda e impuestos, fase 7:
// - tienda: precio_base (el precio sin el ajuste por demanda, #412; NULL = el precio actual es el base) y la oferta temporal
//   (#413: descuento en % entre oferta_inicio y oferta_fin, en ms).
// - mercado_ofertas (#374): objetos a la venta entre jugadores. El objeto sale del inventario del vendedor mientras está aquí.
// - tienda_deseos (#404): objetos de la tienda que sigue cada persona.
// - codigos / codigos_canjes (#409): códigos canjeables de monedas u objeto, con usos máximos y caducidad.
// - impuestos_tramos (#392): tramos de una regla de impuesto de ingreso (el porcentaje de la regla vale desde 0).
// - impuestos_meta (#415): la meta comunitaria del bote de cada servidor.
// - sueldos_rol / sueldos_pagos (#416): sueldo diario por rol de Discord y el registro de lo pagado cada día.
// - negocios_usuario.nivel (#387): nivel de mejora de cada negocio (1 a 3).
const { addColumnIfMissing } = require("./index");

const TABLAS = `
        CREATE TABLE IF NOT EXISTS mercado_ofertas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            vendedor TEXT NOT NULL,
            objetoId INTEGER NOT NULL,
            precio INTEGER NOT NULL,
            creada INTEGER NOT NULL,
            caduca INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mercado_vendedor ON mercado_ofertas(vendedor);
        CREATE TABLE IF NOT EXISTS tienda_deseos (
            userId TEXT NOT NULL,
            tiendaId INTEGER NOT NULL,
            PRIMARY KEY (userId, tiendaId)
        );
        CREATE TABLE IF NOT EXISTS codigos (
            codigo TEXT PRIMARY KEY,
            monedas INTEGER NOT NULL DEFAULT 0,
            objetoId INTEGER,
            usos_max INTEGER NOT NULL,
            usos INTEGER NOT NULL DEFAULT 0,
            caduca INTEGER,
            activo INTEGER NOT NULL DEFAULT 1,
            creado INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS codigos_canjes (
            codigo TEXT NOT NULL,
            userId TEXT NOT NULL,
            fecha INTEGER NOT NULL,
            PRIMARY KEY (codigo, userId)
        );
        CREATE TABLE IF NOT EXISTS impuestos_tramos (
            reglaId INTEGER NOT NULL,
            desde INTEGER NOT NULL,
            porcentaje REAL NOT NULL,
            PRIMARY KEY (reglaId, desde)
        );
        CREATE TABLE IF NOT EXISTS impuestos_meta (
            guildId TEXT PRIMARY KEY,
            meta INTEGER NOT NULL,
            recompensa INTEGER NOT NULL,
            creada INTEGER NOT NULL,
            cumplida_en INTEGER
        );
        CREATE TABLE IF NOT EXISTS sueldos_rol (
            guildId TEXT NOT NULL,
            roleId TEXT NOT NULL,
            cantidad INTEGER NOT NULL,
            PRIMARY KEY (guildId, roleId)
        );
        CREATE TABLE IF NOT EXISTS sueldos_pagos (
            guildId TEXT NOT NULL,
            userId TEXT NOT NULL,
            dia TEXT NOT NULL,
            cantidad INTEGER NOT NULL,
            PRIMARY KEY (guildId, userId, dia)
        );
    `;

function up(db) {
    addColumnIfMissing(db, "tienda", "precio_base", "INTEGER");
    addColumnIfMissing(db, "tienda", "descuento", "INTEGER NOT NULL DEFAULT 0");
    addColumnIfMissing(db, "tienda", "oferta_inicio", "INTEGER");
    addColumnIfMissing(db, "tienda", "oferta_fin", "INTEGER");
    addColumnIfMissing(db, "negocios_usuario", "nivel", "INTEGER NOT NULL DEFAULT 1");
    db.exec(TABLAS);
}

module.exports = { up };
