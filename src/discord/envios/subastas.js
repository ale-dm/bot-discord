// 🔨 Las subastas en Discord (#519): cerrar las que han vencido (cron cada minuto y al arrancar) y los DM: a quien superan en
// una puja, al ganador, a quien vendió y, si nadie pujó, que el objeto ha vuelto. Los DM se apagan en /avisos → 🔨 Subastas.
const subastas = require("../../systems/subastas");
const avisosDm = require("../../systems/avisosDm");
const { fmtNumero } = require("../../core/formato");
const { createLogger } = require("../../core/logger");

const log = createLogger("Subastas");

const avisar = (client, userId, content) => avisosDm.enviarAviso(client, userId, "subastas", { content, allowedMentions: { parse: [] } });

/** DM a quien acaban de superar en una puja. */
async function avisarSuperado(client, s, superado) {
    if (!superado) return;
    await avisar(
        client,
        superado.userId,
        `🔨 Te han superado en la subasta **#${s.id} ${s.nombre}**: te he devuelto **${fmtNumero(superado.cantidad)}** 🪙. ` +
            `La puja mínima ahora es de **${fmtNumero(subastas.minimaPuja(s))}** 🪙 (/subastas).`,
    );
}

/** DM al ganador y al vendedor (o solo al vendedor, si nadie pujó). */
async function avisarCierre(client, s) {
    if (s.estado === "desierta") {
        return avisar(client, s.vendedor, `🔨 Tu subasta **#${s.id} ${s.nombre}** ha acabado sin pujas: el objeto vuelve a tu inventario.`);
    }
    await avisar(
        client,
        s.ganador,
        `🏆 ¡Has ganado la subasta **#${s.id} ${s.nombre}** por **${fmtNumero(s.precio_final)}** 🪙! Ya está en tu inventario.`,
    );
    await avisar(
        client,
        s.vendedor,
        `🔨 Has vendido **${s.nombre}** en subasta por **${fmtNumero(s.precio_final)}** 🪙. ` +
            `Recibes **${fmtNumero(s.precio_final - s.comision)}** 🪙 (comisión de ${fmtNumero(s.comision)}).`,
    );
}

/** Cron: cierra las subastas vencidas y avisa. @returns {Promise<number>} cuántas se han cerrado */
async function revisar(client, ahora = Date.now()) {
    let cerradas = 0;
    for (const id of subastas.vencidas(ahora)) {
        try {
            const s = subastas.cerrar(id, ahora);
            if (!s) continue;
            cerradas++;
            await avisarCierre(client, s);
        } catch (e) {
            log.warn(`Falló cerrar la subasta ${id}: ${e.message}`);
        }
    }
    if (cerradas) log.info(`Subastas cerradas: ${cerradas}`);
    return cerradas;
}

module.exports = { avisarSuperado, avisarCierre, revisar };
