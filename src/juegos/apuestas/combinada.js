// 🧩 Combinadas (#1): los botones y formularios del boleto. El boleto se arma en un mensaje efímero (solo lo ve quien lo
// arma): ⚽ Apuestas → 🧩 Combinada lo abre, y 🧩 Sumar a mi combinada (en un partido) añade una pata.
const { EmbedBuilder, ModalBuilder, MessageFlags } = require("discord.js");
const combinadas = require("../../systems/apuestas/combinadas");
const { pantallaCombinada } = require("../../paneles/combinada");
const { efimero } = require("../../discord/respuestas");
const { filasImporte, importeElegido } = require("../../paneles/importes");
const sistemas = require("../../systems/apuestas/sistemas");
const { formularioSistema, confirmarSistema } = require("../../paneles/sistemas");

/** 🎛️ Apuesta de sistema (#534): el formulario, la confirmación con el coste y el cobro. */
async function botonSistema(interaction, id, userId) {
    const patas = combinadas.borrador(userId);
    if (id === "combinada_sistema") {
        if (!sistemas.tamanosPara(patas.length).length)
            return interaction.update(pantallaCombinada(userId, "🎛️ Un sistema necesita 3, 4 o 5 partidos en el boleto."));
        return interaction.showModal(formularioSistema(patas.length));
    }
    const [, , k, cantidad] = id.split("_");
    const r = sistemas.apostar(interaction.guildId, userId, Number(k), Number(cantidad));
    if (!r.ok) return interaction.update(pantallaCombinada(userId, r.mensaje));
    return interaction.update(
        pantallaCombinada(userId, `✅ Sistema ${r.k} de ${r.m} registrado: ${r.combinaciones} combinaciones, ${r.coste} 🪙. ¡Suerte!`),
    );
}

/** El formulario del sistema: valida y enseña lo que costaría antes de cobrar. */
function modalSistema(interaction) {
    const userId = interaction.user.id;
    const patas = combinadas.borrador(userId);
    const k = Number(interaction.fields.getStringSelectValues("tamano", false)?.[0]);
    const cantidad = importeElegido(interaction.fields);
    if (!Number.isInteger(cantidad) || cantidad < combinadas.MIN_APUESTA || cantidad > combinadas.MAX_APUESTA)
        return interaction.reply(
            efimero(
                pantallaCombinada(userId, `❌ El importe por combinación va de ${combinadas.MIN_APUESTA} a ${combinadas.MAX_APUESTA}.`),
            ),
        );
    const p = sistemas.presupuesto(
        patas.map((x) => x.cuota),
        k,
        cantidad,
    );
    if (!p) return interaction.reply(efimero(pantallaCombinada(userId, "❌ Ese sistema ya no vale para tu boleto.")));
    const aviso = p.coste > sistemas.MAX_COSTE ? `⚠️ Pasa del coste máximo (${sistemas.MAX_COSTE}): baja el importe.` : "";
    return interaction.reply(efimero(confirmarSistema(p, cantidad, aviso)));
}

module.exports = {
    componentHandlers: [
        { types: ["button"], ids: ["combinada_abrir"], method: "handleAbrir", acl: "juegos" },
        { types: ["button"], prefixes: ["combinada_"], method: "handleButton", acl: "juegos" },
        { types: ["stringSelect"], prefixes: ["combinada_sumar_"], method: "handleSumar", acl: "juegos" },
        { types: ["modal"], prefixes: ["combinada_modal_"], method: "handleModal", acl: "juegos" },
    ],

    /** 🧩 Combinada, desde el panel de Apuestas: abre el boleto (efímero). */
    async handleAbrir(client, interaction) {
        return interaction.reply(efimero(pantallaCombinada(interaction.user.id)));
    },

    async handleSumar(client, interaction) {
        const matchId = interaction.customId.replace("combinada_sumar_", "");
        const r = combinadas.sumar(interaction.user.id, matchId, interaction.values[0]);
        return interaction.reply(efimero(pantallaCombinada(interaction.user.id, r.mensaje)));
    },

    async handleButton(client, interaction) {
        const id = interaction.customId;
        const userId = interaction.user.id;
        if (id === "combinada_ver") return interaction.update(pantallaCombinada(userId));
        if (id === "combinada_sistema" || id.startsWith("combinada_sistemaok_")) return botonSistema(interaction, id, userId);
        if (id === "combinada_vaciar") {
            combinadas.vaciar(userId);
            return interaction.update(pantallaCombinada(userId, "🗑️ Boleto vaciado."));
        }
        if (id.startsWith("combinada_quitar_")) {
            const quitada = combinadas.quitar(userId, id.replace("combinada_quitar_", ""));
            return interaction.update(
                pantallaCombinada(userId, quitada ? "✖ Partido quitado." : "Ese partido ya no está en tu combinada."),
            );
        }
        if (id === "combinada_apostar") {
            const modal = new ModalBuilder()
                .setCustomId("combinada_modal_apostar")
                .setTitle("🧩 Apostar combinada")
                .addComponents(
                    ...filasImporte({
                        textoEtiqueta: `Otra cantidad (${combinadas.MIN_APUESTA}-${combinadas.MAX_APUESTA})`,
                        placeholder: "Ejemplo: 100",
                    }),
                );
            return interaction.showModal(modal);
        }
    },

    async handleModal(client, interaction) {
        if (interaction.customId === "combinada_modal_sistema") return modalSistema(interaction);
        if (interaction.customId !== "combinada_modal_apostar") return;
        const userId = interaction.user.id;
        const cantidad = importeElegido(interaction.fields);
        const r = combinadas.apostar(interaction.guildId, userId, cantidad);
        if (!r.ok) return interaction.reply(efimero(pantallaCombinada(userId, r.mensaje)));
        const embed = new EmbedBuilder()
            .setTitle("✅ ¡Combinada registrada!")
            .setDescription(
                `**Importe:** \`${cantidad}\` monedas · **Cuota total:** \`${r.cuota}\`\n` +
                    `**Si aciertas todos:** \`${r.premio}\` monedas.\n\nSe liquida a medida que se juegan sus partidos. ¡Suerte!`,
            )
            .setColor(0x27ae60);
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    },
};
