// 👑 /presidente: los poderes de quien gana las elecciones, solo durante su mandato. Mover, desconectar, silenciar o ensordecer
// a alguien en voz (nunca a admins, staff, bots ni roles más altos, con una espera por persona y un máximo de minutos), y crear
// y borrar canales en su categoría (con tope; se borran al acabar). `estado` lo puede ver cualquiera. Reglas en
// systems/elecciones/poderes.js; lo que toca Discord, en discord/envios/presidencia.js.
const { SlashCommandBuilder, ChannelType, EmbedBuilder } = require("discord.js");
const { poderes, presidencia: repoP, ajustes } = require("../../systems/elecciones");
const acciones = require("../../discord/envios/presidencia");
const { efimero } = require("../../discord/respuestas");
const { createLogger } = require("../../core/logger");

const log = createLogger("Presidencia");

const usuario = (s) => s.addUserOption((o) => o.setName("usuario").setDescription("A quién").setRequired(true));
const minutos = (s) => s.addIntegerOption((o) => o.setName("minutos").setDescription("Cuántos minutos").setRequired(true).setMinValue(1));

/** Lo que enseña `/presidente estado`: quién manda, hasta cuándo, sus canales y sus últimas acciones. */
function pantallaEstado(guildId) {
    const actual = poderes.presidenteActual(guildId);
    if (!actual) return efimero("🏛️ Ahora mismo el servidor no tiene presidente.");
    const { eleccion } = actual;
    const a = ajustes.ajustes(guildId);
    const canales = repoP.canalesActivos(eleccion.id);
    const ultimas = repoP.acciones(eleccion.id, 5);
    const embed = new EmbedBuilder()
        .setTitle("👑 Presidencia del servidor")
        .setColor(0xf39c12)
        .setDescription(`<@${actual.userId}> es el presidente hasta <t:${Math.floor(eleccion.fase_fin / 1000)}:f>.`)
        .addFields(
            {
                name: `Canales (${canales.length}/${a.maxCanales})`,
                value: canales.map((c) => `<#${c.channelId}>`).join("\n") || "Ninguno.",
            },
            {
                name: "Últimas acciones",
                value:
                    ultimas
                        .map((x) => `<t:${Math.floor(x.creada_en / 1000)}:R> · ${x.accion}${x.objetivoId ? ` → <@${x.objetivoId}>` : ""}`)
                        .join("\n") || "Ninguna.",
            },
        );
    return efimero({ embeds: [embed], allowedMentions: { parse: [] } });
}

/** Ejecuta un subcomando de poder ya comprobado que quien lo usa es el presidente. */
async function ejecutar(ctx, sub, interaction) {
    const opciones = interaction.options;
    const objetivo = async () => {
        const u = opciones.getUser("usuario");
        return u ? ctx.guild.members.fetch(u.id).catch(() => null) : null;
    };
    switch (sub) {
        case "mover":
            return acciones.mover(ctx, await objetivo(), opciones.getChannel("canal"));
        case "desconectar":
            return acciones.desconectar(ctx, await objetivo());
        case "silenciar":
            return acciones.sancionar(ctx, await objetivo(), "silencio", opciones.getInteger("minutos"));
        case "ensordecer":
            return acciones.sancionar(ctx, await objetivo(), "sordera", opciones.getInteger("minutos"));
        case "liberar": {
            const m = await objetivo();
            return m ? acciones.liberar(ctx, m) : { ok: false, mensaje: "❌ Esa persona no está en el servidor." };
        }
        case "crear-canal":
            return acciones.crearCanal(ctx, opciones.getString("nombre"), opciones.getString("tipo") || "texto");
        case "borrar-canal":
            return acciones.borrarCanal(ctx, opciones.getChannel("canal")?.id);
        default:
            return { ok: false, mensaje: "❓ Subcomando desconocido." };
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName("presidente")
        .setDescription("👑 Los poderes del presidente del servidor (solo durante su mandato)")
        .addSubcommand((s) => s.setName("estado").setDescription("Quién es el presidente, sus canales y sus últimas acciones"))
        .addSubcommand((s) =>
            usuario(s.setName("mover").setDescription("Mueve a alguien a otro canal de voz")).addChannelOption((o) =>
                o
                    .setName("canal")
                    .setDescription("Canal de voz de destino")
                    .setRequired(true)
                    .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice),
            ),
        )
        .addSubcommand((s) => usuario(s.setName("desconectar").setDescription("Saca a alguien del canal de voz")))
        .addSubcommand((s) => minutos(usuario(s.setName("silenciar").setDescription("Silencia el micro de alguien en voz un rato"))))
        .addSubcommand((s) => minutos(usuario(s.setName("ensordecer").setDescription("Hace que alguien no oiga nada en voz un rato"))))
        .addSubcommand((s) => usuario(s.setName("liberar").setDescription("Quita antes de tiempo el silencio o la sordera que pusiste")))
        .addSubcommand((s) =>
            s
                .setName("crear-canal")
                .setDescription("Crea un canal en la categoría del presidente (se borra al acabar el mandato)")
                .addStringOption((o) => o.setName("nombre").setDescription("Nombre del canal").setRequired(true).setMaxLength(50))
                .addStringOption((o) =>
                    o
                        .setName("tipo")
                        .setDescription("Texto o voz (texto si no dices nada)")
                        .addChoices({ name: "💬 Texto", value: "texto" }, { name: "🔊 Voz", value: "voz" }),
                ),
        )
        .addSubcommand((s) =>
            s
                .setName("borrar-canal")
                .setDescription("Borra uno de los canales que has creado")
                .addChannelOption((o) => o.setName("canal").setDescription("El canal").setRequired(true)),
        ),

    async run(client, interaction) {
        if (!interaction.guildId) return interaction.reply(efimero("Esto solo funciona en un servidor."));
        const sub = interaction.options.getSubcommand();
        if (sub === "estado") return interaction.reply(pantallaEstado(interaction.guildId));
        const eleccion = poderes.mandatoDe(interaction.guildId, interaction.user.id);
        if (!eleccion) return interaction.reply(efimero("👑 Solo el presidente del servidor, durante su mandato, puede usar esto."));
        await interaction.deferReply(efimero({}));
        const ctx = { guild: interaction.guild, eleccion, presidente: interaction.member, ahora: Date.now() };
        try {
            const r = await ejecutar(ctx, sub, interaction);
            return interaction.editReply({ content: r.mensaje, allowedMentions: { parse: [] } });
        } catch (e) {
            log.warn(`/presidente ${sub} falló en ${interaction.guildId}: ${e.message}`);
            return interaction.editReply("⚠️ Discord no me ha dejado hacerlo: puede que me falten permisos o que el canal ya no exista.");
        }
    },
};
