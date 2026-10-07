// 🧙 Botones de lo que propone el Duende desde el chat (duende_acepto_* y duende_no_*, F-DU-03): solo los pulsa a quien
// se lo propuso, y es aquí, al aceptar, cuando se mueve el dinero. Un reto aceptado convierte la propuesta en el mensaje
// del reto (se juega y se repinta como cualquier otro: juegos/retos/retos); un préstamo, en su resumen.
// También el cron de los préstamos vencidos (revisarPrestamos), que avisa por DM de lo cobrado y de lo que se debe.
const { MessageFlags } = require("discord.js");
const retos = require("../../systems/retos");
const prestamos = require("../../systems/prestamos");
const paneles = require("../../paneles/retos");
const propuestas = require("../../paneles/duendeEconomia");
const { createLogger } = require("../../core/logger");

const log = createLogger("Duende");

const privado = (content) => ({ content, flags: MessageFlags.Ephemeral });
const fmt = (n) => Number(n || 0).toLocaleString("es");

/** Cron: cobra los préstamos vencidos y avisa a cada uno por DM (best-effort). */
async function revisarPrestamos(client) {
    const cobros = prestamos.vencer();
    for (const c of cobros) {
        const texto =
            c.falta > 0
                ? `🧙 Tu préstamo del Duende ha vencido: te he cobrado **${fmt(c.cobrado)}** 🪙 y aún debes **${fmt(c.falta)}** 🪙. ` +
                  "Se irá cobrando de lo que ganes, y hasta saldarlo no hay otro préstamo ni apuestas conmigo."
                : `🧙 Tu préstamo del Duende ha vencido y te he cobrado los **${fmt(c.cobrado)}** 🪙 que faltaban. Estamos en paz.`;
        try {
            const usuario = await client.users.fetch(c.userId);
            await usuario.send(texto);
        } catch (e) {
            log.debug(`No se pudo avisar por DM del préstamo vencido de ${c.userId}: ${e.message}`);
        }
    }
    return cobros.length;
}

module.exports = {
    componentHandlers: [{ types: ["button"], prefixes: ["duende_acepto_", "duende_no_"], method: "handleButton", acl: "duende" }],

    async handleButton(client, i) {
        const p = propuestas.leerPropuesta(i.customId);
        if (!p) return i.reply(privado("❌ Esta propuesta no es válida."));
        if (p.userId !== i.user.id) return i.reply(privado("⛔ Esto el Duende se lo ha propuesto a otra persona: pídele tú lo tuyo."));
        if (p.accion === "no") return i.update(propuestas.mensajeCerrada(p, "no"));
        if (Date.now() > p.caduca) return i.update(propuestas.mensajeCerrada(p, "caducada"));

        if (p.tipo === "prestamo") {
            const r = prestamos.aceptar(p.userId, p.cantidad, i.guildId);
            if (!r.ok) return i.reply(privado(r.mensaje));
            return i.update(propuestas.mensajePrestamo(r.prestamo));
        }
        const r = retos.crearContraDuende({
            userId: p.userId,
            cantidad: p.cantidad,
            ...(p.tipo === "partido" ? { matchId: p.matchId, eleccion: p.eleccion } : {}),
            guildId: i.guildId,
            channelId: i.channelId,
            messageId: i.message?.id,
        });
        if (!r.ok) return i.reply(privado(r.mensaje));
        log.info(`${i.user.tag} acepta el reto ${r.reto.id} contra el Duende (${p.tipo}, ${p.cantidad})`);
        return i.update(paneles.mensajeReto(r.reto));
    },

    revisarPrestamos,
};
