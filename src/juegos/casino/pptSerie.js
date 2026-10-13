// ✂️ Piedra, papel o tijera al mejor de tres contra el Duende (#457): botones casino_ppt3_ini_{apuesta}_{jugada} (empieza la serie
// con la primera mano: cobra la apuesta una sola vez) y casino_ppt3_sig_{jugada} (las manos siguientes). Las reglas y el cobro
// están en systems/casino/pptSerie; aquí solo se piden las jugadas y se pintan los mensajes.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const { registrarUsuario, descontarApuesta, obtenerSaldo } = require("../../systems/casinoTransactions");
const serie = require("../../systems/casino/pptSerie");
const activeGames = require("../../systems/activeGames");
const casino = require("../../paneles/casino");
const { OPCIONES } = require("../../systems/casino/ppt");
const { createLogger } = require("../../core/logger");

const log = createLogger("Casino");

const EMOJI = { piedra: "🪨", papel: "📄", tijera: "✂️" };
const TITULO = { victoria: "🎉 ¡Ganaste la serie!", derrota: "💀 Perdiste la serie", empate: "🤝 Serie empatada" };
const COLOR = { victoria: 0x2ecc71, derrota: 0xe74c3c, empate: 0xf1c40f };
const privado = (content) => ({ content, flags: MessageFlags.Ephemeral });

const lineasManos = (s) =>
    s.manos.map((m, n) => {
        const icono = m.tipo === "victoria" ? "✅" : m.tipo === "derrota" ? "❌" : "🤝";
        return `${icono} Mano ${n + 1}: ${EMOJI[m.usuario]} ${m.usuario} contra ${EMOJI[m.duende]} ${m.duende}`;
    });

/** La serie a medias: las manos jugadas, el marcador y los botones de la mano siguiente. */
function mensajeEnCurso(s) {
    const { ganadas, perdidas } = serie.marcador(s);
    const embed = new EmbedBuilder()
        .setTitle(`✂️ PPT al mejor de 3 · mano ${s.manos.length + 1}`)
        .setColor(0xf39c12)
        .setDescription(
            `${lineasManos(s).join("\n")}\n\n**Marcador:** tú ${ganadas} – ${perdidas} Duende · apuesta **${s.apuesta.toLocaleString("es")}** 🪙 (fija)\n¿Qué sacas?`,
        )
        .setFooter({ text: "El Duende Casino • Gana quien llegue a 2 manos, o quien lleve más tras la tercera" });
    const fila = new ActionRowBuilder().addComponents(
        Object.keys(OPCIONES).map((j) =>
            new ButtonBuilder()
                .setCustomId(`casino_ppt3_sig_${j}`)
                .setLabel(`${EMOJI[j]} ${j[0].toUpperCase()}${j.slice(1)}`)
                .setStyle(ButtonStyle.Primary),
        ),
    );
    return { embeds: [embed], components: [fila] };
}

/** El resultado final: las manos, lo que se ha cobrado o perdido y la fila de fin de partida. */
function mensajeFinal(s, final, ganancia, saldo) {
    const { ganadas, perdidas } = serie.marcador(s);
    const dinero =
        final === "victoria"
            ? `💰 Ganaste **${(ganancia - s.apuesta).toLocaleString("es")}** monedas.`
            : final === "empate"
              ? "💰 Recuperas tu apuesta."
              : `💰 Perdiste **${s.apuesta.toLocaleString("es")}** monedas.`;
    const embed = new EmbedBuilder()
        .setTitle(TITULO[final])
        .setColor(COLOR[final])
        .setDescription(
            `${lineasManos(s).join("\n")}\n\n**Marcador final:** tú ${ganadas} – ${perdidas} Duende\n${dinero}\n💳 Saldo actual: **${saldo}** monedas`,
        )
        .setFooter({ text: "El Duende Casino • Piedra, papel o tijera al mejor de 3" });
    return { embeds: [embed], components: [casino.filaFinJuego("ppt", s.apuesta, { userId: s.userId })] };
}

/** Juega una mano de la serie de `userId` y devuelve lo que hay que mostrar (en curso o final). */
function jugar(userId, jugada) {
    const { serie: s, final } = serie.jugarMano(userId, jugada);
    if (!final) return mensajeEnCurso(s);
    const { exito, ganancia } = serie.liquidar(userId, final);
    if (!exito) return { content: "❌ Hubo un error procesando la partida. Contacta a un administrador.", embeds: [], components: [] };
    return mensajeFinal(s, final, ganancia, obtenerSaldo(userId));
}

module.exports = {
    componentHandlers: [{ types: ["button"], prefixes: ["casino_ppt3_"], method: "handleButton", acl: "juegos" }],
    mensajeEnCurso,
    mensajeFinal,

    async handleButton(client, interaction) {
        const id = interaction.customId;
        const userId = interaction.user.id;
        // Solo quien abrió el panel puede jugar su serie.
        const dueno = interaction.message?.interaction?.user?.id || interaction.message?.interactionMetadata?.user?.id;
        if (dueno && dueno !== userId) return interaction.reply(privado("⛔ Solo quien usó el comando puede interactuar."));

        if (id.startsWith("casino_ppt3_sig_")) {
            const jugada = id.slice("casino_ppt3_sig_".length);
            if (!serie.de(userId) || !OPCIONES[jugada]) {
                return interaction.update({ content: "⌛ Esta serie ya no está en curso.", embeds: [], components: [] });
            }
            return interaction.update(jugar(userId, jugada));
        }

        // casino_ppt3_ini_{apuesta}_{jugada}: la primera mano; cobra la apuesta una sola vez.
        const [apuestaTxt, jugada] = id.slice("casino_ppt3_ini_".length).split("_");
        const apuesta = parseInt(apuestaTxt, 10);
        if (!OPCIONES[jugada] || !Number.isInteger(apuesta)) return interaction.reply(privado("❌ Esa jugada no es válida."));
        const previa = serie.de(userId);
        if (previa && !activeGames.estaAbandonada(previa.ultimaAccion)) {
            return interaction.reply(
                privado("✂️ Ya tienes una serie de piedra, papel o tijera en curso. Termínala antes de empezar otra."),
            );
        }
        if (previa) serie.abandonar(userId);

        registrarUsuario(userId, interaction.user.username, interaction.user.tag);
        const cobro = descontarApuesta(userId, apuesta, interaction.guildId, "ppt");
        if (!cobro.exito) return interaction.reply(privado(cobro.mensaje));
        serie.iniciar(userId, interaction.guildId, apuesta);
        log.info(`PPT al mejor de 3 de ${userId}: apuesta ${apuesta}`);
        return interaction.update(jugar(userId, jugada));
    },
};
