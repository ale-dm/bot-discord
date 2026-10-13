// 🔁 Repetir la última apuesta (#349): un botón de 📋 Mis jugadas que propone tu última apuesta a un partido (misma elección y mismo
// importe) sobre el partido que elijas, a la cuota de ahora. Primero eliges el partido, luego se enseña lo que se apostaría y
// solo se cobra al confirmar, con las mismas comprobaciones que una apuesta normal (partido abierto, duplicada, topes...).
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, MessageFlags } = require("discord.js");
const jugadas = require("../../systems/apuestas/misJugadas");
const apostar = require("../../systems/apuestas/apostar");
const mercados = require("../../systems/apuestas/mercados");
const formulario = require("../../systems/apuestas/formularioApuesta");
const { buildMisJugadas, filaTrasApostar } = require("../../paneles/misJugadas");
const { paginaDeLista, filaPaginas } = require("../../paneles/menuPaginado");
const { embedApuestaRegistrada } = require("./partido");
const { textoRechazo } = require("./rechazo");
const { logInfo } = require("../../core/logger");

const fecha = (iso) => new Date(iso).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Cómo se llama la elección en un partido concreto («Sevilla», «Más de 2,5 goles»...). */
const eleccionEn = (eleccion, partido) =>
    mercados.textoEleccion({
        eleccion,
        linea: formulario.lineaDeApuesta(eleccion, partido),
        home_team: partido.home_team,
        away_team: partido.away_team,
    });

const filaVolver = (userId) =>
    new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`misapuestas_activas_${userId}`).setLabel("◀ Mis jugadas").setStyle(ButtonStyle.Secondary),
    );

/** La pantalla para elegir el partido en el que repetir la última apuesta, o un aviso si no se puede. */
function pantallaElegir(userId, pagina = 0) {
    const ultima = jugadas.ultimaApuestaAPartido(userId);
    if (!ultima) return buildMisJugadas(userId, "activas", "🔁 Todavía no tienes ninguna apuesta a un partido que repetir.");
    const candidatos = apostar
        .partidosParaApostar(ultima.eleccion)
        .filter((p) => !apostar.yaApostadoApuesta(userId, p.match_id, ultima.eleccion));
    if (!candidatos.length)
        return buildMisJugadas(userId, "activas", "🔁 Ahora mismo no hay ningún partido abierto en el que repetir tu última apuesta.");

    const pag = paginaDeLista(candidatos, pagina);
    const menu = new StringSelectMenuBuilder()
        .setCustomId(`misapuestas_repetirsel_${userId}`)
        .setPlaceholder("Elige el partido")
        .addOptions(
            pag.items.map((p) => ({
                label: `${p.home_team} vs ${p.away_team}`.slice(0, 100),
                description:
                    `${fecha(p.start_time)} · ${eleccionEn(ultima.eleccion, p)} · cuota ${apostar.cuotaDeEleccion(ultima.eleccion, p)}`.slice(
                        0,
                        100,
                    ),
                value: p.match_id,
            })),
        );
    const embed = new EmbedBuilder()
        .setTitle("🔁 Repetir tu última apuesta")
        .setColor(0x3498db)
        .setDescription(
            `Tu última apuesta fue **${ultima.cantidad.toLocaleString("es")}** 🪙 a «${eleccionEn(ultima.eleccion, candidatos[0])}» (o su equivalente en otro partido).\n` +
                "Elige el partido: te enseño lo que apostarías, a la cuota de ahora, y solo se cobra si confirmas.",
        );
    const paginas = filaPaginas(`misapuestas_repetirpag_${userId}_`, pag);
    return {
        content: "",
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(menu), ...(paginas ? [paginas] : []), filaVolver(userId)],
    };
}

/** La pantalla de confirmación: el partido, la elección, el importe y la cuota de ahora. */
function pantallaConfirmar(userId, ultima, partido) {
    const cuota = apostar.cuotaDeEleccion(ultima.eleccion, partido);
    const embed = new EmbedBuilder()
        .setTitle("🔁 ¿Repetir la apuesta?")
        .setColor(0xf1c40f)
        .setDescription(
            `**${partido.home_team}** vs **${partido.away_team}** · ${fecha(partido.start_time)}\n` +
                `🎯 ${eleccionEn(ultima.eleccion, partido)} · **${ultima.cantidad.toLocaleString("es")}** 🪙 @${cuota}\n` +
                `🏆 Si aciertas cobras **${Math.round(ultima.cantidad * cuota).toLocaleString("es")}** 🪙.`,
        );
    const fila = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`misapuestas_repetirok_${userId}_${partido.match_id}`)
            .setLabel("✅ Apostar")
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`misapuestas_repetir_${userId}`).setLabel("◀ Elegir otro partido").setStyle(ButtonStyle.Secondary),
    );
    return { content: "", embeds: [embed], components: [fila] };
}

async function soloSuyas(interaction, userId) {
    if (interaction.user.id === userId) return true;
    await interaction.reply({ content: "❌ Solo puedes repetir tus propias apuestas.", flags: MessageFlags.Ephemeral });
    return false;
}

/** El botón ✅ Apostar: cobra con las mismas comprobaciones de siempre; si algo falla, el aviso sale en privado y la pantalla se queda. */
async function apostarRepetida(interaction, userId, matchId) {
    const ultima = jugadas.ultimaApuestaAPartido(userId);
    if (!ultima) return interaction.update(buildMisJugadas(userId, "activas", "🔁 Ya no tienes una apuesta que repetir."));
    const apuesta = formulario.apostarAPartido({
        userId,
        guildId: interaction.guildId,
        matchId,
        eleccion: ultima.eleccion,
        cantidad: ultima.cantidad,
    });
    if (apuesta.motivo) {
        const { titulo, descripcion } = textoRechazo(apuesta);
        const aviso = new EmbedBuilder().setColor(0xe74c3c).setTitle(titulo).setDescription(descripcion);
        return interaction.reply({ embeds: [aviso], flags: MessageFlags.Ephemeral });
    }
    logInfo(
        `[Apuestas] ${interaction.user.tag} (${userId}) repitió su apuesta: ${apuesta.cantidad} a "${apuesta.eleccion}" en ${apuesta.match.home_team} vs ${apuesta.match.away_team}`,
    );
    return interaction.update({
        content: "",
        embeds: [embedApuestaRegistrada(apuesta)],
        components: [filaTrasApostar(userId, { deporte: apuesta.match.deporte || "laliga" })],
    });
}

// misapuestas_repetir_{userId} · misapuestas_repetirpag_{userId}_{página} · misapuestas_repetirok_{userId}_{matchId}
async function handleButton(client, interaction) {
    const [, accion, userId, ...resto] = interaction.customId.split("_");
    if (!(await soloSuyas(interaction, userId))) return;
    if (accion === "repetir") return interaction.update(pantallaElegir(userId));
    if (accion === "repetirpag") return interaction.update(pantallaElegir(userId, Number(resto[0]) || 0));
    if (accion === "repetirok") return apostarRepetida(interaction, userId, resto.join("_"));
}

// misapuestas_repetirsel_{userId}: el partido elegido → la confirmación.
async function handleSelect(client, interaction) {
    const userId = interaction.customId.split("_")[2];
    if (!(await soloSuyas(interaction, userId))) return;
    const ultima = jugadas.ultimaApuestaAPartido(userId);
    const partido = apostar.partidoPorMatch(interaction.values[0]);
    if (!ultima || !partido || !apostar.cuotaDeEleccion(ultima.eleccion, partido)) {
        return interaction.update(buildMisJugadas(userId, "activas", "🔁 Ese partido ya no está disponible para repetir la apuesta."));
    }
    return interaction.update(pantallaConfirmar(userId, ultima, partido));
}

module.exports = {
    componentHandlers: [
        { types: ["button"], prefixes: ["misapuestas_repetir"], method: "handleButton", acl: "juegos" },
        { types: ["stringSelect"], prefixes: ["misapuestas_repetirsel_"], method: "handleSelect", acl: "juegos" },
    ],
    pantallaElegir,
    pantallaConfirmar,
    handleButton,
    handleSelect,
};
