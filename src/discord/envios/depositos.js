// 📈 Depósitos a plazo vencidos (#518): el sistema ya ha devuelto el dinero al banco; aquí solo se avisa
// por DM (no se puede apagar: es un movimiento de dinero). Si los DM están cerrados, el dinero ya está igual.
const depositos = require("../../systems/depositos");
const avisosDm = require("../../systems/avisosDm");
const { createLogger } = require("../../core/logger");

const log = createLogger("Depósitos");

/** Paga los vencidos y avisa a cada persona de lo que ha vuelto al banco. Devuelve los pagados. */
async function procesarYAvisar(client, ahora = Date.now()) {
    const pagados = depositos.procesarVencidos(ahora);
    for (const p of pagados) {
        const ok = await avisosDm.sendDm(client, p.userId, {
            content:
                `📈 Tu depósito a plazo de **${p.importe.toLocaleString("es")}** 🪙 ha vencido: han vuelto al banco ` +
                `**${p.total.toLocaleString("es")}** 🪙 (interés +${p.interes.toLocaleString("es")}).`,
        });
        if (ok) log.info(`Aviso de depósito vencido enviado a ${p.userId}`);
    }
    return pagados;
}

module.exports = { procesarYAvisar };
