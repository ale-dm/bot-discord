// 🤝 /prestamo (#520): préstamos entre jugadores. `proponer` manda la propuesta por DM (cantidad, interés y plazo) y `ver`
// enseña los tuyos para aceptar, rechazar, cancelar o pagar. Los botones también funcionan en el DM. Reglas en
// systems/prestamosJugadores.js, pantallas en paneles/prestamosJugadores.js y avisos en discord/envios/prestamosJugadores.js.
const { SlashCommandBuilder } = require("discord.js");
const prestamos = require("../../systems/prestamosJugadores");
const envios = require("../../discord/envios/prestamosJugadores");
const { pantallaPrestamos, pantallaPrestamo, modalPagar } = require("../../paneles/prestamosJugadores");
const { paginaDeId } = require("../../paneles/menuPaginado");
const { fmtNumero } = require("../../core/formato");
const { efimero } = require("../../discord/respuestas");

const numero = (texto) => Number(String(texto ?? "").replace(/[.\s]/g, ""));

async function proponer(interaction) {
    const usuario = interaction.options.getUser("usuario");
    if (usuario.bot) return interaction.reply(efimero("🤖 A un bot no se le presta dinero."));
    const r = prestamos.proponer({
        guildId: interaction.guildId,
        prestamista: interaction.user.id,
        prestatario: usuario.id,
        cantidad: interaction.options.getInteger("cantidad"),
        interes: interaction.options.getInteger("interes"),
        dias: interaction.options.getInteger("dias"),
    });
    if (!r.ok) return interaction.reply(efimero(`❌ ${r.motivo}`));
    const llego = await envios.enviarPropuesta(interaction.client, r.prestamo);
    const aviso = llego
        ? `📨 Propuesta enviada por DM a <@${usuario.id}>.`
        : `📨 Propuesta creada, pero <@${usuario.id}> tiene los DM cerrados: puede aceptarla con \`/prestamo ver\`.`;
    return interaction.reply(efimero(pantallaPrestamo(interaction.user.id, r.prestamo.id, aviso)));
}

/** Aceptar, rechazar, cancelar o pagar todo, y repintar la ficha (o el DM, si viene de ahí). */
async function accion(interaction, que, id) {
    const userId = interaction.user.id;
    let r;
    let hecho;
    if (que === "aceptar") {
        r = prestamos.aceptar(id, userId);
        hecho = r.ok && `✅ Aceptado: tienes **${fmtNumero(r.prestamo.cantidad)}** 🪙 más en el banco.`;
    } else if (que === "pagartodo") {
        r = prestamos.pagar(id, userId);
        hecho = r.ok && `💸 Has pagado **${fmtNumero(r.pagado)}** 🪙.${r.prestamo.estado === "devuelto" ? " ¡Préstamo saldado!" : ""}`;
    } else {
        r = prestamos.descartar(id, userId);
        hecho = r.ok && (r.prestamo.estado === "rechazado" ? "❌ Propuesta rechazada." : "✖️ Propuesta cancelada.");
    }
    await interaction.update(pantallaPrestamo(userId, id, r.ok ? hecho : `❌ ${r.motivo}`));
    if (r.ok && (que === "aceptar" || r.prestamo.estado === "rechazado")) await envios.avisarRespuesta(interaction.client, r.prestamo);
}

module.exports = {
    componentHandlers: [
        { types: ["button"], prefixes: ["prest_"], method: "handleButton", acl: "prestamo" },
        { types: ["stringSelect"], ids: ["prest_sel"], method: "handleSelect", acl: "prestamo" },
        { types: ["modal"], prefixes: ["prest_modal_"], method: "handleModal", acl: "prestamo" },
    ],
    data: new SlashCommandBuilder()
        .setName("prestamo")
        .setDescription("🤝 Préstamos entre jugadores, con interés y plazo")
        .addSubcommand((s) =>
            s
                .setName("proponer")
                .setDescription("Ofrece un préstamo a alguien (de tu banco al suyo)")
                .addUserOption((o) => o.setName("usuario").setDescription("A quién").setRequired(true))
                .addIntegerOption((o) => o.setName("cantidad").setDescription("Cuánto prestas").setRequired(true).setMinValue(1))
                .addIntegerOption((o) =>
                    o
                        .setName("interes")
                        .setDescription(`Interés total, de 0 a ${prestamos.INTERES_MAX} %`)
                        .setRequired(true)
                        .setMinValue(0)
                        .setMaxValue(prestamos.INTERES_MAX),
                )
                .addIntegerOption((o) =>
                    o
                        .setName("dias")
                        .setDescription(`Plazo para devolverlo, de 1 a ${prestamos.PLAZO_MAX} días`)
                        .setRequired(true)
                        .setMinValue(1)
                        .setMaxValue(prestamos.PLAZO_MAX),
                ),
        )
        .addSubcommand((s) => s.setName("ver").setDescription("Tus préstamos dados y recibidos")),

    async run(client, interaction) {
        if (!interaction.guildId) return interaction.reply(efimero("Esto solo funciona en un servidor."));
        if (interaction.options.getSubcommand() === "proponer") return proponer(interaction);
        return interaction.reply(efimero(pantallaPrestamos(interaction.user.id)));
    },

    async handleButton(client, interaction) {
        const id = interaction.customId;
        if (id === "prest_inicio") return interaction.update(pantallaPrestamos(interaction.user.id));
        const pagina = paginaDeId("prest_pag_", id);
        if (pagina !== null) return interaction.update(pantallaPrestamos(interaction.user.id, "", pagina));
        const m = /^prest_(aceptar|rechazar|cancelar|pagartodo|pagarparte)_(\d+)$/.exec(id);
        if (!m) return;
        if (m[1] !== "pagarparte") return accion(interaction, m[1], Number(m[2]));
        const p = prestamos.obtener(Number(m[2]));
        if (!p || p.prestatario !== interaction.user.id || !["activo", "deuda"].includes(p.estado)) {
            return interaction.update(pantallaPrestamo(interaction.user.id, Number(m[2]), "❌ Ese préstamo ya no está abierto."));
        }
        return interaction.showModal(modalPagar(p));
    },

    async handleSelect(client, interaction) {
        return interaction.update(pantallaPrestamo(interaction.user.id, Number(interaction.values[0])));
    },

    async handleModal(client, interaction) {
        const id = Number(interaction.customId.slice("prest_modal_pagar_".length));
        const r = prestamos.pagar(id, interaction.user.id, numero(interaction.fields.getTextInputValue("cantidad")));
        const aviso = r.ok
            ? `💰 Has pagado **${fmtNumero(r.pagado)}** 🪙.${r.prestamo.estado === "devuelto" ? " ¡Préstamo saldado!" : ""}`
            : `❌ ${r.motivo}`;
        return interaction.update(pantallaPrestamo(interaction.user.id, id, aviso));
    },
};
