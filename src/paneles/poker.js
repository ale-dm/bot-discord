// 🃏 El mensaje de una mesa de póker (#531): las cartas comunitarias, el bote, cada asiento con sus fichas, lo apostado, el
// botón y de quién es el turno, con los botones de jugar (o los de sentarse, empezar y levantarse entre manos); el resultado
// de la mano y los formularios de sentarse y de subir. Solo construye mensajes; las reglas están en systems/poker/.
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require("discord.js");
const mesas = require("../systems/poker/mesas");
const mano = require("../systems/poker/mano");
const { fmtNumero } = require("../core/formato");

const COLOR = 0x0b6623;
const CALLE = { preflop: "Antes del flop", flop: "Flop", turn: "Turn", river: "River" };

const boton = (id, etiqueta, estilo = ButtonStyle.Secondary, desactivado = false) =>
    new ButtonBuilder().setCustomId(id).setLabel(etiqueta).setStyle(estilo).setDisabled(desactivado);
const cartas = (lista) => lista.map((c) => `\`${c.texto}\``).join(" ");

function lineasMano(m) {
    return m.jugadores
        .map((j, i) => {
            const marcas = `${i === m.turno ? "▶️ " : ""}${i === m.boton ? "🔘 " : ""}`;
            const estado = j.retirado ? " · 🏳️ se retira" : j.allIn ? " · 🔥 all-in" : "";
            const apuesta = j.apostadoCalle ? ` · apuesta ${fmtNumero(j.apostadoCalle)}` : "";
            return `${marcas}<@${j.userId}> · ${fmtNumero(j.fichas)} fichas${apuesta}${estado}`;
        })
        .join("\n");
}

function lineasMesa(mesaId) {
    const lista = mesas.asientos(mesaId);
    return (
        lista.map((a) => `<@${a.userId}> · ${fmtNumero(a.fichas)} fichas${a.fuera ? " · 💤 sentado fuera" : ""}`).join("\n") ||
        "Nadie sentado."
    );
}

/** El mensaje de la mesa: con una mano en juego (`m`) o entre manos. `aviso`: el resultado de la última mano. */
function mensajeMesa(mesa, m = null, aviso = "") {
    const { sb, bb } = mesas.CIEGAS;
    const embed = new EmbedBuilder().setTitle(`🃏 Mesa de póker #${mesa.id} · ciegas ${sb}/${bb}`).setColor(COLOR);
    if (m && !m.fin) {
        const a = mano.acciones(m);
        embed.setDescription(
            `**${CALLE[m.calle]}** · 💰 Bote **${fmtNumero(mano.bote(m))}**\n🂠 ${m.mesa.length ? cartas(m.mesa) : "—"}\n\n${lineasMano(m)}\n\n` +
                `Turno de <@${a.userId}> (45 segundos).`,
        );
        const igualar = a.pasar ? "✋ Pasar" : `📞 Igualar ${fmtNumero(a.igualar)}`;
        const id = mesa.id;
        return {
            content: aviso,
            embeds: [embed],
            components: [
                new ActionRowBuilder().addComponents(
                    boton(`poker_retirarse_${id}`, "🏳️ Retirarse", ButtonStyle.Danger),
                    boton(`poker_igualar_${id}`, igualar, ButtonStyle.Primary),
                    boton(`poker_subir_${id}`, "⬆️ Subir", ButtonStyle.Success, !a.puedeSubir || a.subirMin >= a.subirMax),
                    boton(`poker_allin_${id}`, "🔥 All-in", ButtonStyle.Danger),
                ),
                new ActionRowBuilder().addComponents(boton(`poker_cartas_${id}`, "🃏 Mis cartas")),
            ],
            allowedMentions: { parse: [] },
        };
    }
    const cerrada = mesa.estado === "cerrada";
    embed.setDescription(
        (cerrada
            ? "🔒 Mesa cerrada: se han devuelto las fichas.\n\n"
            : "Siéntate con de " +
              `${fmtNumero(mesas.COMPRA_MIN)} a ${fmtNumero(mesas.COMPRA_MAX)} fichas (con efectivo). ` +
              `Hacen falta ${mesas.MIN_JUGADORES}; caben ${mesas.MAX_JUGADORES}. Al levantarte cobras tus fichas.\n\n`) +
            lineasMesa(mesa.id),
    );
    const components = cerrada
        ? []
        : [
              new ActionRowBuilder().addComponents(
                  boton(`poker_sentarse_${mesa.id}`, "🪑 Sentarse", ButtonStyle.Success),
                  boton(`poker_empezar_${mesa.id}`, "▶️ Repartir", ButtonStyle.Primary),
                  boton(`poker_volver_${mesa.id}`, "🔙 Volver a jugar"),
                  boton(`poker_levantarse_${mesa.id}`, "🚪 Levantarse", ButtonStyle.Danger),
              ),
          ];
    return { content: aviso, embeds: [embed], components, allowedMentions: { parse: [] } };
}

/** El resumen de una mano terminada: quién gana y, si hubo showdown, las manos. */
function textoResultado(m) {
    const ganan = [...m.resultado.pagos].filter(([, x]) => x > 0).map(([u, x]) => `<@${u}> gana **${fmtNumero(x)}**`);
    if (!m.resultado.showdown) return `🃏 ${ganan.join(" · ")} (sin enseñar cartas).`;
    const manos = [...m.resultado.manos].map(([u, h]) => {
        const j = m.jugadores.find((x) => x.userId === u);
        return `<@${u}> ${cartas(j.cartas)} · ${h.nombre}`;
    });
    return `🃏 Mesa: ${cartas(m.mesa)}\n${manos.join("\n")}\n${ganan.join(" · ")}`;
}

const campo = (id, etiqueta, valor) =>
    new ActionRowBuilder().addComponents(
        new TextInputBuilder()
            .setCustomId(id)
            .setLabel(etiqueta)
            .setStyle(TextInputStyle.Short)
            .setMaxLength(7)
            .setRequired(true)
            .setValue(valor),
    );

function modalSentarse(mesaId) {
    return new ModalBuilder()
        .setCustomId(`poker_modal_sentarse_${mesaId}`)
        .setTitle("🪑 Sentarse a la mesa")
        .addComponents(
            campo("compra", `Fichas (${fmtNumero(mesas.COMPRA_MIN)} a ${fmtNumero(mesas.COMPRA_MAX)})`, String(mesas.COMPRA_MIN * 2)),
        );
}

function modalSubir(mesaId, a) {
    return new ModalBuilder()
        .setCustomId(`poker_modal_subir_${mesaId}`)
        .setTitle("⬆️ Subir")
        .addComponents(campo("total", `Subir hasta un total de (${a.subirMin} a ${a.subirMax})`, String(a.subirMin)));
}

module.exports = { mensajeMesa, textoResultado, modalSentarse, modalSubir, cartas };
