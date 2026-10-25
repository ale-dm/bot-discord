// 🔁 Exchange (#533): los botones, formularios y menús. Se entra desde la ficha de un partido (🔁 Exchange). Todo es privado:
// el libro, las confirmaciones (con lo que se gana, la comisión y lo que se arriesga) y «Mis órdenes».
const { MessageFlags } = require("discord.js");
const exchange = require("../../systems/apuestas/exchange");
const { vistaLibro, formulario, confirmarPublicar, confirmarCasar, vistaMias } = require("../../paneles/exchange");
const { efimero } = require("../../discord/respuestas");

const CONFIRMAR = /^exchange_ok(pub|cas)_(.+)_(home|draw|away)_(\d+)_(\d+)$/;

const privado = (interaction, payload) => interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
const sinPartido = (interaction) => interaction.reply(efimero("❌ Ese partido ya ha empezado o no está abierto."));

/** Pinta en el mismo mensaje si sale de uno del exchange; si no (desde la ficha del partido), en privado. */
const pintar = (interaction, payload) =>
    interaction.message?.flags?.has?.(MessageFlags.Ephemeral) ? interaction.update(payload) : privado(interaction, payload);

async function confirmar(interaction, m) {
    const [, tipo, matchId, eleccion, centesimas, cantidad] = m;
    const datos = { userId: interaction.user.id, matchId, eleccion, cantidad: Number(cantidad) };
    const r =
        tipo === "pub"
            ? exchange.publicar({ ...datos, cuota: Number(centesimas) / 100 })
            : exchange.casar({ ...datos, cuotaMax: Number(centesimas) / 100 });
    const p = exchange.partidoAbierto(matchId);
    if (!p) return interaction.update(vistaMias(interaction.user.id, r.ok ? "✅ Hecho." : `❌ ${r.motivo}`));
    const aviso = !r.ok
        ? `❌ ${r.motivo}`
        : tipo === "pub"
          ? `✅ Orden #${r.id} publicada.`
          : `✅ Cruzado ${r.cubierto.toLocaleString("es")} 🪙 con un riesgo de ${r.riesgo.toLocaleString("es")} 🪙.`;
    return interaction.update(vistaLibro(p, aviso));
}

module.exports = {
    componentHandlers: [
        { types: ["button"], prefixes: ["exchange_"], method: "handleButton", acl: "juegos" },
        { types: ["modal"], prefixes: ["exchange_modal_"], method: "handleModal", acl: "juegos" },
        { types: ["stringSelect"], ids: ["exchange_cancelar"], method: "handleSelect", acl: "juegos" },
    ],

    async handleButton(client, interaction) {
        const id = interaction.customId;
        if (id === "exchange_mias") return pintar(interaction, vistaMias(interaction.user.id));
        const m = CONFIRMAR.exec(id);
        if (m) return confirmar(interaction, m);
        const accion = /^exchange_(ver|publicar|casar)_(.+)$/.exec(id);
        if (!accion) return undefined;
        const p = exchange.partidoAbierto(accion[2]);
        if (!p) return sinPartido(interaction);
        if (accion[1] === "ver") return pintar(interaction, vistaLibro(p));
        return interaction.showModal(formulario(accion[1], p));
    },

    async handleModal(client, interaction) {
        const m = /^exchange_modal_(publicar|casar)_(.+)$/.exec(interaction.customId);
        if (!m) return undefined;
        const p = exchange.partidoAbierto(m[2]);
        if (!p) return sinPartido(interaction);
        const eleccion = interaction.fields.getStringSelectValues("eleccion", false)?.[0];
        const cuota = exchange.cuotaValida(interaction.fields.getTextInputValue("cuota"));
        const cantidad = Number(String(interaction.fields.getTextInputValue("cantidad")).replace(/[.\s]/g, ""));
        if (!exchange.ELECCIONES.includes(eleccion)) return privado(interaction, vistaLibro(p, "❌ Elige un resultado."));
        if (!cuota) return privado(interaction, vistaLibro(p, `❌ La cuota va de ${exchange.MIN_CUOTA} a ${exchange.MAX_CUOTA}.`));
        if (!exchange.cantidadValida(cantidad))
            return privado(interaction, vistaLibro(p, `❌ El importe mínimo es ${exchange.MIN_CANTIDAD}.`));
        if (m[1] === "publicar") return privado(interaction, confirmarPublicar(p, eleccion, cuota, cantidad));
        const plan = exchange.previsualizar({ userId: interaction.user.id, matchId: p.match_id, eleccion, cuotaMax: cuota, cantidad });
        if (!plan.cruces.length) return privado(interaction, vistaLibro(p, "❌ No hay órdenes a esa cuota o mejor para cruzar."));
        return privado(interaction, confirmarCasar(p, eleccion, cuota, cantidad, plan));
    },

    async handleSelect(client, interaction) {
        const r = exchange.cancelar(interaction.user.id, interaction.values[0]);
        return interaction.update(
            vistaMias(interaction.user.id, r.ok ? `🚫 Devueltas ${r.devuelto.toLocaleString("es")} 🪙.` : `❌ ${r.motivo}`),
        );
    },
};
