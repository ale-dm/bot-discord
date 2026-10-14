// ✉️ /mensaje: un admin escribe un mensaje de parte del bot: un DM a alguien (opción «usuario») o, con la opción «canal»,
// publicado en ese canal del servidor. El texto va en un formulario (campo de varias líneas) y se manda tal cual. Solo
// admins: un bot que escribe a cualquiera se puede usar mal. Las menciones del texto no notifican a nadie en el canal. Cada
// envío queda en la auditoría (sin el texto, solo cuántos caracteres).
const {
    SlashCommandBuilder,
    ActionRowBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    PermissionFlagsBits,
    ChannelType,
} = require("discord.js");
const { isAdmin } = require("../../adminPanel/common");
const adminAudit = require("../../systems/adminAudit");
const programados = require("../../systems/mensajesProgramados");
const { fechaMadridAMs } = require("../../core/zonaMadrid");
const { createLogger } = require("../../core/logger");
const { efimero } = require("../../discord/respuestas");

const log = createLogger("Mensaje");
const TEXTO_MAX = 1500; // deja sitio a la cabecera dentro de los 2000 caracteres de un DM

const PREFIJO_CANAL = "mensaje_modal_canal_";
const PREFIJO_PROGRAMADO = "mensaje_modal_prog_"; // mensaje_modal_prog_<destinoId>_<milisegundos>

function formulario(customId, titulo, placeholder) {
    const texto = new TextInputBuilder()
        .setCustomId("texto")
        .setLabel("Mensaje")
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder(placeholder)
        .setMaxLength(TEXTO_MAX)
        .setRequired(true);
    return new ModalBuilder()
        .setCustomId(customId)
        .setTitle(titulo.slice(0, 45))
        .addComponents(new ActionRowBuilder().addComponents(texto));
}

/** ¿Puede el bot escribir en ese canal? Si no, el motivo para decírselo al admin. */
function motivoNoPuedeEscribir(client, canal) {
    if (!canal?.isTextBased?.() || typeof canal.send !== "function") return "ese canal no admite mensajes de texto";
    const permisos = canal.permissionsFor?.(client.user);
    if (!permisos?.has?.(PermissionFlagsBits.ViewChannel) || !permisos.has(PermissionFlagsBits.SendMessages)) {
        return "no tengo permiso para escribir en él";
    }
    return null;
}

/** Publica el texto en un canal del servidor (#433): sin menciones que notifiquen y con la auditoría sin el texto. */
async function publicarEnCanal(client, interaction, canalId, texto) {
    const canal = await interaction.guild?.channels?.fetch(canalId).catch(() => null);
    if (!canal) return interaction.reply(efimero("❌ No encuentro ese canal en este servidor."));
    const motivo = motivoNoPuedeEscribir(client, canal);
    if (motivo) return interaction.reply(efimero(`❌ No puedo publicar en <#${canal.id}>: ${motivo}.`));
    try {
        await canal.send({ content: texto, allowedMentions: { parse: [] } });
    } catch (e) {
        log.warn(`No pude publicar en ${canalId} de parte de ${interaction.user.username}: ${e.message}`);
        return interaction.reply(efimero(`❌ No pude publicar en <#${canal.id}>: ${e.message}`));
    }
    adminAudit.logAdminAction({
        guildId: interaction.guildId,
        actorId: interaction.user.id,
        action: "mensaje.canal",
        details: { canal: canalId, caracteres: texto.length },
    });
    log.info(`${interaction.user.username} publicó un mensaje en el canal ${canalId} de ${interaction.guildId}`);
    return interaction.reply(efimero(`✅ Mensaje publicado en <#${canal.id}>.`));
}

/** Deja el DM programado (#424): lo guarda hasta su hora y lo audita sin el texto. */
async function programarDm(client, interaction, destinoId, enviarEn, texto) {
    const destino = await client.users.fetch(destinoId).catch(() => null);
    const r = programados.programar({
        guildId: interaction.guildId,
        autorId: interaction.user.id,
        destinoId,
        destinoNombre: destino?.username,
        texto,
        enviarEn,
    });
    if (!r.ok) return interaction.reply(efimero(`❌ ${r.motivo}`));
    adminAudit.logAdminAction({
        guildId: interaction.guildId,
        actorId: interaction.user.id,
        action: "mensaje.programado",
        details: { id: r.id, destinatario: destinoId, caracteres: texto.length, enviarEn },
    });
    return interaction.reply(
        efimero(
            `✅ Mensaje #${r.id} programado para <@${destinoId}> el <t:${Math.floor(enviarEn / 1000)}:F>. ` +
                "Sale con un margen de 5 minutos; puedes cancelarlo en /paneladmin → 🩺 Sistema → ✉️ Mensajes.",
        ),
    );
}

// `cuando` y a quién: se valida antes de abrir el formulario para no hacer escribir el texto en balde.
async function abrirFormularioProgramado(interaction, destino, cuando) {
    const enviarEn = fechaMadridAMs(cuando);
    if (enviarEn === null)
        return interaction.reply(efimero("❌ La fecha tiene que ser `DD/MM/AAAA HH:MM` (hora de Madrid), por ejemplo `25/12/2026 18:30`."));
    if (enviarEn <= Date.now()) return interaction.reply(efimero("❌ Esa fecha ya ha pasado."));
    if (destino.bot) return interaction.reply(efimero("❌ No tiene sentido mandarle un mensaje a un bot."));
    return interaction.showModal(
        formulario(
            `${PREFIJO_PROGRAMADO}${destino.id}_${enviarEn}`,
            `✉️ Mensaje a ${destino.username} (programado)`,
            "Se le manda tal cual a la hora indicada.",
        ),
    );
}

module.exports = {
    componentHandlers: [{ types: ["modal"], prefixes: ["mensaje_modal_"], method: "handleModal" }],
    data: new SlashCommandBuilder()
        .setName("mensaje")
        .setDescription("✉️ Manda un mensaje de parte del bot: por DM a alguien o publicado en un canal (solo admins)")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption((o) => o.setName("usuario").setDescription("A quién se le manda por DM").setRequired(false))
        .addStringOption((o) =>
            o
                .setName("cuando")
                .setDescription("Para mandar el DM más tarde: DD/MM/AAAA HH:MM (hora de Madrid). Solo con «usuario»")
                .setRequired(false),
        )
        .addChannelOption((o) =>
            o
                .setName("canal")
                .setDescription("Canal donde se publica, en vez de mandar un DM")
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                .setRequired(false),
        ),

    async run(client, interaction) {
        if (!isAdmin(interaction)) return interaction.reply(efimero("⛔ Solo los admins pueden mandar mensajes desde el bot."));
        const destino = interaction.options.getUser("usuario");
        const canal = interaction.options.getChannel("canal");
        if (destino && canal) return interaction.reply(efimero("❌ Elige solo uno: `usuario` (DM) o `canal` (publicarlo)."));
        if (!destino && !canal) return interaction.reply(efimero("❌ Elige a quién mandárselo (`usuario`) o dónde publicarlo (`canal`)."));

        const cuando = interaction.options.getString?.("cuando");
        if (cuando && canal) return interaction.reply(efimero("❌ Programar solo vale para DMs: quita `canal` o quita `cuando`."));
        if (cuando) return abrirFormularioProgramado(interaction, destino, cuando);

        if (canal) {
            const motivo = motivoNoPuedeEscribir(client, canal);
            if (motivo) return interaction.reply(efimero(`❌ No puedo publicar en <#${canal.id}>: ${motivo}.`));
            return interaction.showModal(
                formulario(`${PREFIJO_CANAL}${canal.id}`, `✉️ Mensaje en #${canal.name}`, "Lo que se publica en el canal, tal cual."),
            );
        }
        if (destino.bot) return interaction.reply(efimero("❌ No tiene sentido mandarle un mensaje a un bot."));
        return interaction.showModal(
            formulario(
                `mensaje_modal_${destino.id}`,
                `✉️ Mensaje a ${destino.username}`,
                "Lo que le quieres decir. Le llega tal cual, como DM del bot.",
            ),
        );
    },

    async handleModal(client, interaction) {
        if (!isAdmin(interaction)) return interaction.reply(efimero("⛔ Solo los admins pueden mandar mensajes desde el bot."));
        const texto = interaction.fields.getTextInputValue("texto").trim();
        if (!texto) return interaction.reply(efimero("❌ El mensaje está vacío."));
        if (interaction.customId.startsWith(PREFIJO_PROGRAMADO)) {
            const [destinoId, ms] = interaction.customId.slice(PREFIJO_PROGRAMADO.length).split("_");
            return programarDm(client, interaction, destinoId, Number(ms), texto);
        }
        if (interaction.customId.startsWith(PREFIJO_CANAL)) {
            return publicarEnCanal(client, interaction, interaction.customId.slice(PREFIJO_CANAL.length), texto);
        }
        const destinoId = interaction.customId.slice("mensaje_modal_".length);

        const destino = await client.users.fetch(destinoId).catch(() => null);
        if (!destino) return interaction.reply(efimero("❌ No encuentro a esa persona."));

        try {
            await destino.send({ content: texto });
        } catch (e) {
            // Suele ser que tiene cerrados los mensajes privados de los servidores.
            log.warn(`No pude mandar el DM a ${destinoId} de parte de ${interaction.user.username}: ${e.message}`);
            return interaction.reply(efimero(`❌ No pude mandarle el mensaje a **${destino.username}** (quizá tiene los DM cerrados).`));
        }

        adminAudit.logAdminAction({
            guildId: interaction.guildId,
            actorId: interaction.user.id,
            action: "mensaje.dm",
            details: { destinatario: destinoId, caracteres: texto.length },
        });
        log.info(`${interaction.user.username} mandó un DM a ${destinoId} desde ${interaction.guildId}`);
        return interaction.reply(efimero(`✅ Mensaje enviado a **${destino.username}**.`));
    },
};
