// Pasos para lanzar un reto (partido, duelo o porra): elegir el partido o el juego, el lado, a quién se reta, y la
// cantidad o las opciones de la porra en un formulario. Solo construye mensajes.
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    UserSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require("discord.js");
const retos = require("../systems/retos");
const { DEPORTES } = require("../services/oddsApi");
const { fmtNumero } = require("../core/formato");
const { ts, corto, VOLVER } = require("./retosComun");

// ─── Pasos para lanzar un reto ───────────────────────────────────────────────

function buildElegirPartido(partidos) {
    const embed = new EmbedBuilder()
        .setTitle("⚽ Retar a un partido")
        .setDescription(
            partidos.length
                ? "Elige el partido. Después dices qué crees que pasará y a quién retas: el otro va con lo contrario, y el que acierte se lleva lo de los dos."
                : "No hay partidos próximos ahora mismo.",
        )
        .setColor(0x3498db);
    const components = [];
    if (partidos.length) {
        components.push(
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId("retos_partido_select")
                    .setPlaceholder("Elige un partido")
                    .addOptions(
                        partidos.map((p) => ({
                            label: corto(`${p.home_team} vs ${p.away_team}`, 100),
                            description: `${DEPORTES[p.deporte]?.name || p.deporte} · ${new Date(p.start_time).toLocaleString("es-ES", {
                                day: "2-digit",
                                month: "2-digit",
                                hour: "2-digit",
                                minute: "2-digit",
                            })}`,
                            value: p.match_id,
                        })),
                    ),
            ),
        );
    }
    components.push(new ActionRowBuilder().addComponents(VOLVER()));
    return { embeds: [embed], components };
}

function buildElegirLado(p) {
    const embed = new EmbedBuilder()
        .setTitle(`⚽ ${p.home_team} vs ${p.away_team}`)
        .setDescription(`${ts(Date.parse(p.start_time), "f")} (${ts(Date.parse(p.start_time))})\n\n¿Qué crees que pasará?`)
        .setColor(0x3498db);
    const lado = (eleccion, label, style) =>
        new ButtonBuilder().setCustomId(`retos_lado_${eleccion}_${p.match_id}`).setLabel(corto(label, 80)).setStyle(style);
    return {
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(
                lado("home", `🏠 Gana ${p.home_team}`, ButtonStyle.Success),
                lado("draw", "🤝 Empate", ButtonStyle.Primary),
                lado("away", `🚩 Gana ${p.away_team}`, ButtonStyle.Danger),
            ),
            new ActionRowBuilder().addComponents(VOLVER()),
        ],
    };
}

function buildElegirJuego() {
    const embed = new EmbedBuilder()
        .setTitle("🎲 Duelo")
        .setDescription(
            "Elige el juego. Los dos ponéis lo mismo y el que gane se lo lleva todo.\n\n" +
                "🪨 **Piedra, papel o tijera**: cada uno elige en secreto. Si empatáis, otra ronda.\n" +
                "🎲 **Dados**: dos dados cada uno al aceptar; gana la suma más alta.\n" +
                "🃏 **Blackjack**: cada uno juega su mano sin ver la del otro; gana quien más se acerque a 21 sin pasarse.",
        )
        .setColor(0x3498db);
    return {
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(
                Object.entries(retos.JUEGOS).map(([id, j]) =>
                    new ButtonBuilder().setCustomId(`retos_juego_${id}`).setLabel(`${j.emoji} ${j.nombre}`).setStyle(ButtonStyle.Primary),
                ),
            ),
            new ActionRowBuilder().addComponents(VOLVER()),
        ],
    };
}

/** Elegir a quién se reta. `clave`: p_{eleccion}_{matchId} (partido) o d_{juego} (duelo). */
function buildElegirRival(clave, texto) {
    const embed = new EmbedBuilder().setTitle("⚔️ ¿A quién retas?").setDescription(texto).setColor(0x3498db);
    return {
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(
                new UserSelectMenuBuilder()
                    .setCustomId(`retos_rival_${clave}`)
                    .setPlaceholder("Elige a quién retas")
                    .setMinValues(1)
                    .setMaxValues(1),
            ),
            new ActionRowBuilder().addComponents(VOLVER()),
        ],
    };
}

function modalCantidad(customId, titulo, efectivo) {
    return new ModalBuilder()
        .setCustomId(customId)
        .setTitle(corto(titulo, 45))
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId("cantidad")
                    .setLabel(`Cuánto pone cada uno (${retos.MIN}-${fmtNumero(retos.MAX)})`)
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder(`Tienes ${fmtNumero(efectivo)} en efectivo`)
                    .setMaxLength(7)
                    .setRequired(true),
            ),
        );
}

function modalPorra() {
    const input = (id, label, style, extra = (b) => b) =>
        new ActionRowBuilder().addComponents(extra(new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style)));
    return new ModalBuilder()
        .setCustomId("retos_modal_porra")
        .setTitle("🗳️ Nueva porra")
        .addComponents(
            input("pregunta", "Pregunta", TextInputStyle.Short, (b) =>
                b.setPlaceholder("¿Llegará Jorge tarde?").setMaxLength(200).setRequired(true),
            ),
            input("opciones", `Opciones (una por línea, de 2 a ${retos.PORRA_MAX_OPCIONES})`, TextInputStyle.Paragraph, (b) =>
                b.setPlaceholder("Sí\nNo").setMaxLength(300).setRequired(false),
            ),
            input("cantidad", `Entrada para cada uno (${retos.MIN}-${fmtNumero(retos.MAX)})`, TextInputStyle.Short, (b) =>
                b.setPlaceholder("100").setMaxLength(7).setRequired(true),
            ),
        );
}

module.exports = { buildElegirPartido, buildElegirLado, buildElegirJuego, buildElegirRival, modalCantidad, modalPorra };
