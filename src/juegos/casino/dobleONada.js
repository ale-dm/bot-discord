// 🎲 Doble o nada (#462): el botón casino_doble_{juego} que sale al ganar en un juego del casino. Se juega la ganancia a una
// tirada de 50 %: si se gana, se cobra el doble de lo jugado; si se pierde, solo se pierde esa ganancia (la apuesta original ya
// estaba cobrada y no se toca). Se registra como una partida distinta («doble_o_nada») y no se puede encadenar. La oferta y
// su caducidad están en systems/casino/dobleONada.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const { descontarExtra, procesarGanancia, procesarPerdida, obtenerSaldo } = require("../../systems/casinoTransactions");
const dobleONada = require("../../systems/casino/dobleONada");
const { NOMBRE } = require("../../paneles/casinoComun");
const { createLogger } = require("../../core/logger");

const log = createLogger("Casino");

const privado = (content) => ({ content, flags: MessageFlags.Ephemeral });
const fmt = (n) => n.toLocaleString("es");

/** Lo que sale tras el doble o nada: otra apuesta del mismo juego, sus stats o volver. Sin 🔄 Repetir ni otra oferta. */
function filaFin(juego) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(juego === "ruleta" ? "casino_ruleta" : `casino_pick_${juego}`)
            .setLabel("🎲 Otra apuesta")
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`casino_stats_${dobleONada.JUEGO}`).setLabel("📊 Stats").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("casino_home").setLabel("◀ Casino").setStyle(ButtonStyle.Secondary),
    );
}

function embedResultado(gana, juego, ganancia, saldo) {
    return new EmbedBuilder()
        .setTitle(gana ? "🎲 ¡Doble! Ganaste el doble o nada" : "🎲 Nada. Perdiste el doble o nada")
        .setColor(gana ? 0x2ecc71 : 0xe74c3c)
        .setDescription(
            `Te jugaste **${fmt(ganancia)}** 🪙 de lo ganado en ${NOMBRE[juego] || juego}.\n\n` +
                (gana
                    ? `💰 Ahora son **${fmt(ganancia * 2)}** 🪙 (ganas otras **${fmt(ganancia)}**).`
                    : `💸 Pierdes esa ganancia de **${fmt(ganancia)}** 🪙. Lo que tenías antes de la partida sigue intacto.`) +
                `\n💳 Saldo actual: **${fmt(saldo)}** monedas`,
        )
        .setFooter({ text: "El Duende Casino • Doble o nada: 50 %" });
}

module.exports = {
    componentHandlers: [{ types: ["button"], prefixes: ["casino_doble_"], method: "handleButton", acl: "juegos" }],

    async handleButton(client, interaction) {
        const userId = interaction.user.id;
        const juego = interaction.customId.slice("casino_doble_".length);
        const dueno = interaction.message?.interaction?.user?.id || interaction.message?.interactionMetadata?.user?.id;
        if (dueno && dueno !== userId) return interaction.reply(privado("⛔ Solo quien usó el comando puede interactuar."));

        // Se retira la oferta antes de cobrar nada: un doble clic no puede jugarla dos veces.
        const oferta = dobleONada.tomar(userId, juego);
        if (!oferta) {
            return interaction.reply(
                privado("⌛ Esta oferta de doble o nada ya no está disponible (solo se puede usar una vez por victoria)."),
            );
        }
        const guildId = oferta.guildId || interaction.guildId;
        const extra = descontarExtra(userId, oferta.ganancia, guildId);
        if (!extra.exito) {
            dobleONada.ofrecer(userId, juego, oferta.ganancia, { apuesta: oferta.apuesta, guildId });
            return interaction.reply(privado(extra.mensaje));
        }

        const gana = Math.random() < dobleONada.PROBABILIDAD;
        const descripcion = `Doble o nada tras ganar en ${NOMBRE[juego] || juego}: ${gana ? "ganado" : "perdido"} (${oferta.ganancia})`;
        const detalle = { origen: juego, ganancia: oferta.ganancia, gana, guildId };
        const exito = gana
            ? procesarGanancia(userId, dobleONada.JUEGO, oferta.ganancia, oferta.ganancia * 2, descripcion, detalle)
            : procesarPerdida(userId, dobleONada.JUEGO, oferta.ganancia, descripcion, detalle);
        if (!exito) {
            log.error(`Doble o nada: no se pudo registrar el resultado de ${userId} (${oferta.ganancia})`);
            return interaction.update({
                content: "❌ Hubo un error procesando el doble o nada. Contacta a un administrador.",
                embeds: [],
                components: [],
            });
        }
        log.info(`Doble o nada de ${userId} tras ${juego}: ${gana ? "gana" : "pierde"} ${oferta.ganancia}`);
        return interaction.update({
            content: "",
            embeds: [embedResultado(gana, juego, oferta.ganancia, obtenerSaldo(userId))],
            components: [filaFin(juego)],
        });
    },
};
