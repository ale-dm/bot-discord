// 🔔 El botón de alerta de cuota de la ficha de un partido (#345): un formulario con la elección (1, X, 2, goles o hándicap), la cuota
// objetivo y si el aviso es cuando suba o cuando baje. Las reglas están en systems/apuestas/alertasCuota; las alertas se ven y se cancelan en
// 📋 Mis jugadas.
const {
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    LabelBuilder,
    StringSelectMenuBuilder,
    RadioGroupBuilder,
    MessageFlags,
} = require("discord.js");
const alertas = require("../../systems/apuestas/alertasCuota");
const { partidoPorMatch } = require("../../systems/apuestas/apostar");
const mercados = require("../../systems/apuestas/mercados");

const PREFIJO_BOTON = "apuesta_alerta_";
const PREFIJO_MODAL = "apuestas_modal_alerta_";

const efimero = (content) => ({ content, flags: MessageFlags.Ephemeral });
const nombreEn = (eleccion, partido) =>
    mercados.textoEleccion({
        eleccion,
        linea: mercados.lineaDe(partido, eleccion),
        home_team: partido.home_team,
        away_team: partido.away_team,
    });

/** El formulario de la alerta de un partido: las elecciones con cuota, el objetivo y la dirección. */
function modalAlerta(partido) {
    const opciones = alertas.eleccionesConCuota(partido).map(({ eleccion, cuota }) => ({
        label: `${nombreEn(eleccion, partido)} · ahora ${cuota}`.slice(0, 100),
        value: eleccion,
    }));
    return new ModalBuilder()
        .setCustomId(`${PREFIJO_MODAL}${partido.match_id}`)
        .setTitle("🔔 Alerta de cuota")
        .addLabelComponents(
            new LabelBuilder()
                .setLabel("Qué cuota vigilas")
                .setStringSelectMenuComponent(
                    new StringSelectMenuBuilder()
                        .setCustomId("eleccion")
                        .setPlaceholder("Elige una opción")
                        .setRequired(true)
                        .addOptions(opciones),
                ),
            new LabelBuilder()
                .setLabel("Cuota objetivo")
                .setTextInputComponent(
                    new TextInputBuilder()
                        .setCustomId("objetivo")
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setMaxLength(7)
                        .setPlaceholder("2,80"),
                ),
            new LabelBuilder()
                .setLabel("Avísame cuando")
                .setRadioGroupComponent(
                    new RadioGroupBuilder()
                        .setCustomId("direccion")
                        .setRequired(true)
                        .addOptions(
                            { label: "La cuota llegue o suba", value: "arriba", default: true },
                            { label: "La cuota llegue o baje", value: "abajo" },
                        ),
                ),
        );
}

/** apuesta_alerta_{matchId}: abre el formulario si el partido aún no ha empezado. */
async function handleButton(client, interaction) {
    const partido = partidoPorMatch(interaction.customId.slice(PREFIJO_BOTON.length));
    if (!partido || partido.estado !== "abierto" || Date.parse(partido.start_time) <= Date.now()) {
        return interaction.reply(efimero("❌ Ese partido ya ha empezado o no está disponible."));
    }
    if (!alertas.eleccionesConCuota(partido).length) return interaction.reply(efimero("❌ Este partido no tiene cuotas ahora mismo."));
    return interaction.showModal(modalAlerta(partido));
}

/** apuestas_modal_alerta_{matchId}: crea la alerta (o dice por qué no). */
async function handleModal(client, interaction) {
    const matchId = interaction.customId.slice(PREFIJO_MODAL.length);
    const eleccion = interaction.fields.getStringSelectValues("eleccion", false)?.[0];
    const direccion = interaction.fields.getRadioGroup("direccion");
    const objetivo = interaction.fields.getTextInputValue("objetivo");
    const r = alertas.crear({ userId: interaction.user.id, matchId, eleccion, objetivo, direccion });
    if (!r.ok) return interaction.reply(efimero(r.mensaje));
    const partido = partidoPorMatch(matchId);
    const valor = Number(String(objetivo).replace(",", "."));
    return interaction.reply(
        efimero(
            `🔔 Alerta creada: te aviso por DM cuando **${nombreEn(eleccion, partido)}** en ${partido.home_team} vs ${partido.away_team} ` +
                `${alertas.DIRECCIONES[direccion].texto} **${valor}** (ahora está a ${r.actual}). Las ves y las cancelas en /juegos → 📋 Mis jugadas.`,
        ),
    );
}

module.exports = {
    componentHandlers: [
        { types: ["button"], prefixes: [PREFIJO_BOTON], method: "handleButton", acl: "juegos" },
        { types: ["modal"], prefixes: [PREFIJO_MODAL], method: "handleModal", acl: "juegos" },
    ],
    PREFIJO_BOTON,
    modalAlerta,
    handleButton,
    handleModal,
};
