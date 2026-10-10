// Liquidación de apuestas a partidos, retos 1 contra 1 a un partido y quinielas (cron de cada hora en index.js, y el
// botón 💸 Liquidar ahora del panel de admin → ⚽ Apuestas; antes el comando /pagarapuestas). Después: DM a quien
// cobra y, si el servidor tiene canal de resultados, un resumen público de lo cerrado.

const { AUTO_MIN_HORAS_DESDE_INICIO, minimoAciertosQuiniela } = require("./liquidacion/caducidad");
const { liquidarApuestas } = require("./liquidacion/orquesta");
const { avisarGanadores, resultadosEmbed, anunciarResultados, resumenEmbed } = require("./liquidacion/anuncios");

module.exports = {
    liquidarApuestas,
    avisarGanadores,
    anunciarResultados,
    resultadosEmbed,
    minimoAciertosQuiniela,
    resumenEmbed,
    AUTO_MIN_HORAS_DESDE_INICIO,
};
