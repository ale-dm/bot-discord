// 📊 /encuesta: una pregunta con de 2 a 5 opciones. El bot publica un mensaje con un botón por opción y el recuento en vivo; cada
// persona vota una vez (puede cambiar su voto) y se cierra al cabo de un tiempo (24 h si no se dice otra cosa) o cuando la cierra
// quien la creó. Solo se ve el recuento, no quién votó qué. Reglas en systems/encuestas.js, mensaje en paneles/encuesta.js.
const { SlashCommandBuilder } = require("discord.js");
const encuestas = require("../../systems/encuestas");
const { mensajeEncuesta } = require("../../paneles/encuesta");
const { efimero } = require("../../discord/respuestas");
const { createLogger } = require("../../core/logger");

const log = createLogger("Encuestas");

const NUMERO_OPCIONES = 5;

/** Repinta el mensaje de una encuesta en su canal (best-effort: si se borró o no hay permisos, se sigue). */
async function repintar(client, encuesta) {
    if (!encuesta.channelId || !encuesta.messageId) return false;
    try {
        const canal = await client.channels.fetch(encuesta.channelId);
        await canal.messages.edit(encuesta.messageId, mensajeEncuesta(encuesta));
        return true;
    } catch (e) {
        log.debug(`No se pudo actualizar el mensaje de la encuesta ${encuesta.id}: ${e.message}`);
        return false;
    }
}

/** Cron (cada minuto): cierra las encuestas cuyo tiempo ha acabado y repinta su mensaje con el resultado final. */
async function cerrarVencidas(client) {
    const cerradas = encuestas.cerrarVencidas();
    for (const encuesta of cerradas) await repintar(client, encuesta);
    return cerradas.length;
}

const data = new SlashCommandBuilder()
    .setName("encuesta")
    .setDescription("📊 Lanza una encuesta rápida con botones para votar")
    .addStringOption((o) => o.setName("pregunta").setDescription("Qué se pregunta").setRequired(true).setMaxLength(encuestas.MAX_PREGUNTA));
for (let n = 1; n <= NUMERO_OPCIONES; n++) {
    data.addStringOption((o) =>
        o
            .setName(`opcion${n}`)
            .setDescription(n <= 2 ? `Opción ${n}` : `Opción ${n} (opcional)`)
            .setRequired(n <= 2)
            .setMaxLength(encuestas.MAX_OPCION),
    );
}
data.addIntegerOption((o) =>
    o
        .setName("horas")
        .setDescription(`Cuánto dura (por defecto ${encuestas.HORAS_POR_DEFECTO} h)`)
        .setMinValue(encuestas.MIN_HORAS)
        .setMaxValue(encuestas.MAX_HORAS),
);

module.exports = {
    componentHandlers: [{ types: ["button"], prefixes: ["encuesta_"], method: "handleButton", acl: "encuesta" }],
    data,
    repintar,
    cerrarVencidas,

    async run(client, interaction) {
        if (!interaction.guildId) return interaction.reply(efimero("Esto solo funciona en un servidor."));
        const opciones = [];
        for (let n = 1; n <= NUMERO_OPCIONES; n++) {
            const o = interaction.options.getString(`opcion${n}`);
            if (o !== null && o !== undefined) opciones.push(o);
        }
        const r = encuestas.crear({
            guildId: interaction.guildId,
            channelId: interaction.channelId,
            creador: interaction.user.id,
            pregunta: interaction.options.getString("pregunta"),
            opciones,
            horas: interaction.options.getInteger("horas") ?? encuestas.HORAS_POR_DEFECTO,
        });
        if (!r.ok) return interaction.reply(efimero(r.mensaje));
        await interaction.reply(mensajeEncuesta(r.encuesta));
        const mensaje = await interaction.fetchReply();
        encuestas.guardarMensaje(r.encuesta.id, interaction.channelId, mensaje.id);
    },

    // encuesta_voto_{id}_{opción}: vota y repinta el recuento · encuesta_cerrar_{id}: la cierra quien la creó.
    async handleButton(client, interaction) {
        const [accion, id, opcion] = interaction.customId.slice("encuesta_".length).split("_");
        if (accion === "cerrar") {
            const r = encuestas.cerrar(id, interaction.user.id);
            if (!r.ok) return interaction.reply(efimero(r.mensaje));
            return interaction.update(mensajeEncuesta(r.encuesta));
        }
        const r = encuestas.votar(id, interaction.user.id, Number(opcion));
        if (!r.ok) return interaction.reply(efimero(r.mensaje));
        await interaction.update(mensajeEncuesta(r.encuesta));
        const nombre = r.encuesta.opciones[Number(opcion)];
        const aviso = r.antes === null ? `✅ Has votado **${nombre}**.` : `🔄 Has cambiado tu voto a **${nombre}**.`;
        await interaction.followUp(efimero(aviso));
    },
};
