// Las pantallas de un partido de ⚽ Apuestas: su ficha (cuotas y escudos), sus botones, el formulario de la cantidad y la
// confirmación de la apuesta. Las reglas (cantidad, cuota, cobro), en systems/apuestas/formularioApuesta.js.
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require("discord.js");
const dinero = require("../../systems/dinero");
const marcadorExacto = require("../../systems/apuestas/marcador");
const mercados = require("../../systems/apuestas/mercados");
const formulario = require("../../systems/apuestas/formularioApuesta");
const { filaTrasApostar } = require("../../paneles/misJugadas");
const { filasImporte } = require("../../paneles/importes");

const { MIN_BET_AMOUNT, MAX_BET_AMOUNT } = formulario;

// La ficha de un partido: cuotas, escudos y el texto para elegir.
function embedPartido(partido, badgeHome, badgeAway) {
    const embed = new EmbedBuilder()
        .setTitle(`⚽ ${partido.home_team} vs ${partido.away_team}`)
        .setDescription(
            `¿A qué resultado quieres apostar?\n\n` +
                `🏠 **${partido.home_team}**: cuota \`${partido.cuota_home}\`\n` +
                `🤝 **Empate**: cuota \`${partido.cuota_draw}\`\n` +
                `🚩 **${partido.away_team}**: cuota \`${partido.cuota_away}\`\n` +
                `🎯 **Marcador exacto**: premio fijo de \`×${marcadorExacto.PREMIO}\` lo apostado\n` +
                mercados
                    .botonesDisponibles(partido)
                    .map((b) => `${b.etiqueta}: cuota \`${mercados.cuotaDe(partido, b.eleccion)}\`\n`)
                    .join("") +
                "\nPulsa un botón para elegir tu apuesta.",
        )
        .setColor(0xf1c40f);

    if (badgeHome && badgeAway) {
        embed.setThumbnail(badgeHome).setImage(badgeAway);
    } else if (badgeHome) {
        embed.setThumbnail(badgeHome);
    } else if (badgeAway) {
        embed.setThumbnail(badgeAway);
    }
    return embed;
}

// Las filas de un partido: 1X2 y marcador exacto, los mercados (una fila aparte) y el menú de sumar a la combinada.
function filasPartido(partido, match_id) {
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`apuesta_home_${match_id}`).setLabel(`🏠 ${partido.home_team}`).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`apuesta_draw_${match_id}`).setLabel("🤝 Empate").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`apuesta_away_${match_id}`).setLabel(`🚩 ${partido.away_team}`).setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId(`apuesta_exacto_${match_id}`)
            .setLabel(`🎯 Marcador exacto (×${marcadorExacto.PREMIO})`)
            .setStyle(ButtonStyle.Secondary),
    );

    // Mercados de goles y de hándicap, si la API dio su cuota para este partido (una fila aparte).
    const filas = [row];
    const botonesMercado = mercados
        .botonesDisponibles(partido)
        .map((b) =>
            new ButtonBuilder()
                .setCustomId(`apuesta_mercado_${b.eleccion}_${match_id}`)
                .setLabel(b.etiqueta.slice(0, 80))
                .setStyle(ButtonStyle.Secondary),
        );
    if (botonesMercado.length) filas.push(new ActionRowBuilder().addComponents(botonesMercado));
    // 🧩 Sumar a mi combinada: el mismo partido con la elección que se quiera (una pata por partido).
    const opciones = [
        partido.cuota_home && { value: "home", label: `🏠 ${partido.home_team} · cuota ${partido.cuota_home}` },
        partido.cuota_draw && { value: "draw", label: `🤝 Empate · cuota ${partido.cuota_draw}` },
        partido.cuota_away && { value: "away", label: `🚩 ${partido.away_team} · cuota ${partido.cuota_away}` },
        ...mercados.botonesDisponibles(partido).map((b) => ({
            value: b.eleccion,
            label: `${b.etiqueta} · cuota ${mercados.cuotaDe(partido, b.eleccion)}`,
        })),
    ].filter(Boolean);
    if (opciones.length) {
        filas.push(
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`combinada_sumar_${match_id}`)
                    .setPlaceholder("🧩 Sumar a mi combinada…")
                    .addOptions(opciones.map((o) => ({ ...o, label: o.label.slice(0, 100) }))),
            ),
        );
    }
    return filas;
}

// El formulario de la cantidad. En el marcador exacto, además, los goles de cada equipo.
function modalApuesta(eleccion, match) {
    const modal = new ModalBuilder().setCustomId(`apuestas_modal_${eleccion}_${match.match_id}`).setTitle("¿Cuánto quieres apostar?");

    if (eleccion === "exacto") {
        const goles = (id, equipo) =>
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId(id)
                    .setLabel(`Goles de ${equipo}`.slice(0, 45))
                    .setStyle(TextInputStyle.Short)
                    .setMinLength(1)
                    .setMaxLength(2)
                    .setPlaceholder("0")
                    .setRequired(true),
            );
        modal.setTitle(`🎯 Marcador exacto (×${marcadorExacto.PREMIO})`);
        modal.addComponents(goles("goles_local", match.home_team), goles("goles_visitante", match.away_team));
    }
    modal.addComponents(
        ...filasImporte({
            textoEtiqueta: `Otra cantidad (${MIN_BET_AMOUNT}-${MAX_BET_AMOUNT})`,
            placeholder: "Ejemplo: 100",
        }),
    );
    return modal;
}

// La confirmación de una apuesta cobrada.
async function confirmarApuesta(interaction, { userId, match, eleccion, linea, cantidad, cuota }) {
    const saldoActual = dinero.efectivo(userId);
    const resultadoTxt = marcadorExacto.marcadorDe(eleccion)
        ? `Marcador exacto ${match.home_team} ${marcadorExacto.marcadorDe(eleccion)} ${match.away_team}`
        : mercados.textoEleccion({ eleccion, linea, home_team: match.home_team, away_team: match.away_team });
    const embed = new EmbedBuilder()
        .setTitle("✅ ¡Apuesta registrada!")
        .setDescription(
            `**Partido:** ${match.home_team} vs ${match.away_team}\n` +
                `**Opción:** ${resultadoTxt}\n` +
                `**Cantidad:** \`${cantidad}\` monedas\n` +
                `**Cuota:** \`${cuota}\`\n\n` +
                `💵 **Tu efectivo:** \`${saldoActual}\` monedas\n\n` +
                "¡Suerte!",
        )
        .setColor(0x27ae60);

    await interaction.reply({
        embeds: [embed],
        components: [filaTrasApostar(userId, { deporte: match.deporte || "laliga" })],
    });
}

module.exports = { embedPartido, filasPartido, modalApuesta, confirmarApuesta };
