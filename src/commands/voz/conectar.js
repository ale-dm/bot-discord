// 🔌 /conectar: el bot entra a un canal de voz y se queda el tiempo que elijas (30 minutos por defecto), para que /sonidos
// suene sin entrar y salir cada vez. Sin canal: si ya está conectado, se sale (o, con tiempo, se renueva); si no, entra al
// canal de quien lo pide. Si el bot está de guardia (🛡️ en /duende), no hace nada y lo avisa. Ver systems/presencia.js.
const { SlashCommandBuilder, ChannelType, MessageFlags } = require("discord.js");
const presencia = require("../../systems/presencia");
const sonidos = require("../../systems/sonidos");
const ajustes = require("../../systems/sonidos/ajustes");
const { MAX_OPCIONES } = require("../../paneles/menuPaginado");
const { efimero } = require("../../discord/respuestas");
const { createLogger } = require("../../core/logger");

const log = createLogger("Conectar");

// Cómo se nombra una duración en minutos: "15 minutos", "1 hora", "2 horas".
function etiquetaDuracion(minutos) {
    if (minutos < 60) return `${minutos} minutos`;
    return minutos === 60 ? "1 hora" : `${minutos / 60} horas`;
}

const OPCIONES_DURACION = presencia.DURACIONES.map((m) => ({ name: etiquetaDuracion(m), value: m }));

/**
 * El sonido de entrada (#301): suena una vez, justo al entrar. Si no existe, no lo puede usar quien lo pide o no se puede tocar,
 * la conexión sigue igual y queda en el log. @returns {string} lo que se añade a la respuesta ("" si no hubo sonido o va bien)
 */
function sonarAlEntrar(interaction) {
    const elegido = interaction.options.getString("sonido");
    if (!elegido) return "";
    const sonido = sonidos.obtener(interaction.guildId, elegido);
    if (!sonido) {
        log.warn(`El sonido de entrada ${elegido} no existe en ${interaction.guildId}`);
        return "\n⚠️ Ese sonido ya no existe, así que he entrado sin sonido.";
    }
    if (!ajustes.puedeUsar(sonido.id, interaction.member).ok)
        return "\n🔒 Ese sonido es solo para algunos roles, así que he entrado sin sonido.";
    // No se espera a que acabe: el sonido puede durar minutos.
    sonidos
        .reproducir(interaction.guildId, null, sonido, { sinCola: true })
        .then((r) => !r.ok && log.warn(`No sonó el sonido de entrada «${sonido.nombre}» en ${interaction.guildId}: ${r.motivo}`))
        .catch((e) => log.warn(`Falló el sonido de entrada «${sonido.nombre}»: ${e.message}`));
    return "";
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName("conectar")
        .setDescription("🔌 Entra a un canal de voz el tiempo que elijas, para que /sonidos suene sin entrar y salir")
        .addChannelOption((o) =>
            o
                .setName("canal")
                .setDescription("El canal de voz (por defecto, el tuyo; sin canal y ya conectado, me salgo)")
                .addChannelTypes(ChannelType.GuildVoice)
                .setRequired(false),
        )
        .addIntegerOption((o) =>
            o
                .setName("minutos")
                .setDescription("Cuánto tiempo me quedo (por defecto, 30 minutos). Con el bot ya conectado, renueva el tiempo")
                .addChoices(...OPCIONES_DURACION)
                .setRequired(false),
        )
        .addStringOption((o) =>
            o.setName("sonido").setDescription("Un sonido de /sonidos que suena al entrar (por defecto, ninguno)").setAutocomplete(true),
        ),

    // Los sonidos del servidor que encajan con lo escrito (hasta 25, que es lo que admite Discord).
    async autocomplete(client, interaction) {
        const texto = String(interaction.options.getFocused() ?? "");
        const lista = sonidos.listar(interaction.guildId, { texto }).slice(0, MAX_OPCIONES);
        await interaction.respond(lista.map((s) => ({ name: s.nombre.slice(0, 100), value: String(s.id) })));
    },

    async run(client, interaction) {
        const elegido = interaction.options.getChannel("canal");
        const minutos = interaction.options.getInteger("minutos");
        const guildId = interaction.guildId;
        // 🛡️ De guardia (#553): /conectar no la sustituye, ni la renueva, ni la cierra.
        const presente = presencia.actual(guildId);
        if (presente?.guardia) return interaction.reply(efimero(presencia.avisoGuardia(presente)));
        if (!elegido && presente) {
            // Ya estoy conectado: con tiempo, renuevo; sin tiempo, me salgo como siempre.
            if (minutos) {
                const r = presencia.renovar(guildId, minutos);
                return interaction.reply(efimero(`🔌 Me quedo ${etiquetaDuracion(minutos)}, hasta <t:${Math.floor(r.expira / 1000)}:t>.`));
            }
            presencia.desconectar(guildId);
            return interaction.reply(efimero("🔌 Me he salido del canal."));
        }
        const canal = elegido || interaction.member?.voice?.channel;
        if (!canal) return interaction.reply(efimero("🔌 Entra a un canal de voz, o elige uno en la opción *canal*."));

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const r = await presencia.conectar(canal, { minutos: minutos || presencia.MINUTOS });
        if (!r.ok) return interaction.editReply(`❌ ${r.motivo}`);
        const hasta = Math.floor(r.expira / 1000);
        const aviso = sonarAlEntrar(interaction);
        return interaction.editReply(
            `🔌 Conectado a **${r.canal}**. Me quedo hasta <t:${hasta}:t> (${etiquetaDuracion(minutos || presencia.MINUTOS)}): ya puedes usar /sonidos.${aviso}`,
        );
    },
};
