// 📤 Exportar los movimientos de alguien a CSV (#411): fecha (hora de Madrid), tipo, descripción y cantidad, con el filtro de tipo
// activo. Separador `;` (el que usa Excel en español) y UTF-8 con BOM para que se vean bien las tildes. Con más de TOPE_FILAS
// movimientos se exportan los más recientes y se avisa.
const dinero = require("./dinero");

const TOPE_FILAS = 5000;
const BOM = "﻿";

const FECHA = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
});

/** Un campo de texto de CSV: entre comillas si hace falta, y con ' delante si empezara con = + - @ (para que Excel no lo tome por fórmula). */
function campo(texto) {
    let t = String(texto ?? "").replace(/\r?\n/g, " ");
    if (/^[=+\-@\t]/.test(t)) t = `'${t}`;
    return /[;"]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

/**
 * El CSV de los movimientos de alguien. `tipo`: uno de dinero.TIPOS, o null para todos.
 * @returns {{ csv: string, filas: number, truncado: boolean }}
 */
function csvDeMovimientos(userId, tipo = null) {
    const { filas } = dinero.movimientos(userId, { tipo, limite: TOPE_FILAS + 1, offset: 0 });
    const truncado = filas.length > TOPE_FILAS;
    const usadas = truncado ? filas.slice(0, TOPE_FILAS) : filas;
    const lineas = usadas.map((m) =>
        [FECHA.format(new Date(m.fecha)), campo(dinero.TIPOS[m.tipo] || "Otros"), campo(m.descripcion), m.cantidad].join(";"),
    );
    return {
        csv: `${BOM}fecha;tipo;descripcion;cantidad\r\n${lineas.join("\r\n")}${lineas.length ? "\r\n" : ""}`,
        filas: usadas.length,
        truncado,
    };
}

module.exports = { TOPE_FILAS, BOM, csvDeMovimientos };
