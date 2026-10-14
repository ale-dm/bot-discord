// 🍿 /plex: un solo comando con botones para todo lo de Plex (como /tienda y /duende). Lo que hay debajo:
//   🎬 Sesión de cine (systems/cine) · 🎯 Para ti (systems/recomendaciones) · 🎞️ Wrapped (systems/plexWrapped) ·
//   🏅 Mi Plex (la pestaña de Plex de /perfil: horas, trofeos y logros).
const {
    SlashCommandBuilder,
    MessageFlags,
    ModalBuilder,
    ActionRowBuilder,
    TextInputBuilder,
    TextInputStyle,
    AttachmentBuilder,
    LabelBuilder,
    StringSelectMenuBuilder,
    RadioGroupBuilder,
    ButtonBuilder,
    ButtonStyle,
} = require("discord.js");
const cine = require("../../systems/cine");
const cineVotos = require("../../systems/cine/votos");
const cineSeries = require("../../systems/cine/series");
const recomendaciones = require("../../systems/recomendaciones");
const plexWrapped = require("../../systems/plexWrapped");
const plexLinks = require("../../systems/plexLinks");
const { pantallaSesion, pantallaSugerencias } = require("../../paneles/cine");
const { pantallaRecomendaciones } = require("../../paneles/recomendar");
const { pantallaPlex } = require("../../paneles/plex");
const { pantallaSeries, pantallaQuieroVer, pantallaResultados } = require("../../paneles/plexAvisos");
const plexAvisos = require("../../systems/plexAvisos");
const seerrClient = require("../../services/seerrClient");
const perfilPaneles = require("../../paneles/perfil");
const { efimero } = require("../../discord/respuestas");
const { tienePermiso } = require("../../core/permisos");

// La hora de la sesión, en dos desplegables (hora, y minuto de 15 en 15): no hay que escribir HH:MM (#310, grupo G6).
const HORAS_CINE = Array.from({ length: 24 }, (_, h) => {
    const texto = String(h).padStart(2, "0");
    return { label: texto, value: texto };
});
const MINUTOS_CINE = ["00", "15", "30", "45"].map((m) => ({ label: m, value: m }));

function selectorCine(id, label, opciones) {
    return new LabelBuilder()
        .setLabel(label)
        .setStringSelectMenuComponent(
            new StringSelectMenuBuilder().setCustomId(id).setRequired(true).setMinValues(1).setMaxValues(1).addOptions(opciones),
        );
}

function formularioCine() {
    return new ModalBuilder()
        .setCustomId("plex_modal_cine")
        .setTitle("🎬 Sesión de cine")
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId("peli")
                    .setLabel("Qué vais a ver (varias, con |, se votan)")
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder("Dune | Alien | Heat")
                    .setMaxLength(300)
                    .setRequired(true),
            ),
            selectorCine("hora", "Hora (Madrid)", HORAS_CINE),
            selectorCine("minuto", "Minuto", MINUTOS_CINE),
            new LabelBuilder().setLabel("¿Repetir cada semana?").setRadioGroupComponent(
                new RadioGroupBuilder()
                    .setCustomId("repetir")
                    .setRequired(true)
                    .addOptions([
                        { label: "No, solo esta vez", value: "no", default: true },
                        { label: "Sí, cada semana a esta hora", value: "si" },
                    ]),
            ),
        );
}

module.exports = {
    componentHandlers: [
        { types: ["button"], prefixes: ["plex_", "cine_", "recomendar_pedir_", "recomendar_quiero_"], method: "handleButton", acl: "plex" },
        { types: ["stringSelect"], prefixes: ["plex_sel_"], method: "handleSelect", acl: "plex" },
        { types: ["modal"], prefixes: ["plex_modal_"], method: "handleModal", acl: "plex" },
    ],
    data: new SlashCommandBuilder()
        .setName("plex")
        .setDescription("🍿 Plex: sesiones de cine, recomendaciones, tu Wrapped y tu perfil de Plex"),

    async run(client, interaction) {
        return interaction.reply(efimero(pantallaPlex(interaction.guildId, interaction.user.id)));
    },

    async handleButton(client, interaction) {
        const id = interaction.customId;
        const userId = interaction.user.id;
        const guildId = interaction.guildId;

        // 🎬 Sesión de cine: el mensaje de la sesión (público) con sus botones.
        if (id.startsWith("cine_")) return handleCineBoton(interaction, id);

        if (id === "plex_cine") return interaction.showModal(formularioCine());

        if (id === "plex_para_ti") {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            return interaction.editReply(pantallaRecomendaciones(await recomendaciones.generar(guildId, userId)));
        }

        const pedir = /^recomendar_pedir_(movie|tv)_(\d+)$/.exec(id);
        if (pedir) {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const r = await recomendaciones.pedir(guildId, userId, pedir[1], pedir[2]);
            return interaction.editReply({ content: r.ok ? "✅ Pedido en Seerr. Te avisaremos cuando esté en Plex." : `❌ ${r.mensaje}` });
        }

        // ➕ en 🎯 Para ti: apunta la sugerencia en «quiero ver» (#466).
        const quiero = /^recomendar_quiero_(movie|tv)_(\d+)$/.exec(id);
        if (quiero) {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const r = await plexAvisos.anadirQuieroVer(guildId, userId, quiero[1], quiero[2]);
            return interaction.editReply({
                content: r.ok
                    ? `📝 **${r.titulo}** apuntada en tu lista de «quiero ver». Te aviso cuando llegue a Plex.`
                    : `❌ ${r.motivo}`,
            });
        }

        if (id === "plex_inicio") return interaction.update(pantallaPlex(guildId, userId));
        if (id === "plex_series") return interaction.update(pantallaSeries(guildId, userId));
        if (id === "plex_quiero") return interaction.update(pantallaQuieroVer(guildId, userId));
        if (id === "plex_quiero_anadir") return interaction.showModal(formularioQuieroVer());

        if (id === "plex_wrapped") return wrappedMensual(interaction);

        if (id === "plex_perfil") {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            return interaction.editReply(perfilPaneles.buildPlex(interaction.guild, userId, userId));
        }
    },

    // Los menús de 📺 Series y 📝 Quiero ver.
    async handleSelect(client, interaction) {
        const id = interaction.customId;
        const userId = interaction.user.id;
        const guildId = interaction.guildId;
        const valor = interaction.values[0];

        if (id === "plex_sel_seguir") {
            const serie = plexAvisos.seriesParaSeguir(guildId, userId).find((s) => String(s.serie_key) === valor);
            if (!serie) return interaction.update(pantallaSeries(guildId, userId, "❌ Esa serie ya no está en la lista."));
            const r = plexAvisos.seguir(guildId, userId, serie.serie_key, serie.titulo);
            const aviso = r.ok ? `✅ Sigues **${serie.titulo}**: te aviso por DM de los episodios nuevos.` : `❌ ${r.motivo}`;
            return interaction.update(pantallaSeries(guildId, userId, aviso));
        }
        if (id === "plex_sel_dejar") {
            const serie = plexAvisos.seguidas(guildId, userId).find((s) => String(s.serie_key) === valor);
            plexAvisos.dejarDeSeguir(guildId, userId, valor);
            return interaction.update(pantallaSeries(guildId, userId, serie ? `➖ Ya no sigues **${serie.titulo}**.` : ""));
        }

        const tmdb = /^(movie|tv)_(\d+)$/.exec(valor || "");
        if (!tmdb) return;
        if (id === "plex_sel_quitar") {
            const t = plexAvisos.quieroVer(guildId, userId).find((x) => x.media_type === tmdb[1] && String(x.tmdb_id) === tmdb[2]);
            plexAvisos.quitarQuieroVer(guildId, userId, tmdb[1], tmdb[2]);
            return interaction.update(pantallaQuieroVer(guildId, userId, t ? `➖ Quitada **${t.titulo}** de tu lista.` : ""));
        }
        if (id === "plex_sel_anadir") {
            await interaction.deferUpdate();
            const r = await plexAvisos.anadirQuieroVer(guildId, userId, tmdb[1], tmdb[2]);
            return interaction.editReply(pantallaQuieroVer(guildId, userId, r.ok ? `📝 Apuntada **${r.titulo}**.` : `❌ ${r.motivo}`));
        }
    },

    async handleModal(client, interaction) {
        if (interaction.customId === "plex_modal_quiero") return buscarParaQuieroVer(interaction);
        if (interaction.customId !== "plex_modal_cine") return;
        const peli = interaction.fields.getTextInputValue("peli").trim();
        const hora = interaction.fields.getStringSelectValues("hora", true)[0];
        const minuto = interaction.fields.getStringSelectValues("minuto", true)[0];
        const inicio = cine.proximaHora(`${hora}:${minuto}`);
        if (!inicio) return interaction.reply(efimero({ content: "❌ No se pudo fijar esa hora. Prueba otra." }));
        // 🔁 Cada semana (#403): se crea la serie y esta es su primera sesión; el cron crea las siguientes.
        const repetir = interaction.fields.getRadioGroup("repetir") === "si";
        const serieId = repetir
            ? cineSeries.crear({
                  guildId: interaction.guildId,
                  canalId: interaction.channelId,
                  organizador: interaction.user.id,
                  peli,
                  hora: `${hora}:${minuto}`,
                  primera: inicio,
              })
            : null;
        const id = cine.crear({
            guildId: interaction.guildId,
            canalId: interaction.channelId,
            organizador: interaction.user.id,
            peli,
            inicio,
            serieId,
        });
        await interaction.reply(pantallaSesion(id));
        const mensaje = await interaction.fetchReply();
        cine.guardarMensaje(id, mensaje.id);
    },
};

/** 🎞️ Privado: solo tu resumen del mes pasado, y solo a ti (el Wrapped no se publica en ningún canal). */
async function wrappedMensual(interaction) {
    const { guildId } = interaction;
    const userId = interaction.user.id;
    // Privado: solo tu resumen, y solo a ti (el Wrapped no se publica en ningún canal).
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const link = plexLinks.getLinkByDiscordId(guildId, userId);
    if (!link) return interaction.editReply("Tu cuenta de Plex no está vinculada: el Wrapped es para quien la tiene vinculada.");
    const r = plexWrapped.resumenPersonal(guildId, link.tautulliUserId, plexWrapped.mesAnterior());
    const buf = plexWrapped.graficoPersonal(r);
    const files = buf ? [new AttachmentBuilder(buf, { name: "wrapped.png" })] : [];
    const anual = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("plexx_wrapped_anio").setLabel("📅 Ver el del año pasado").setStyle(ButtonStyle.Secondary),
    );
    return interaction.editReply({ content: plexWrapped.mensajePersonal(r), files, components: [anual] });
}

function formularioQuieroVer() {
    return new ModalBuilder()
        .setCustomId("plex_modal_quiero")
        .setTitle("📝 Añadir a «quiero ver»")
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId("titulo")
                    .setLabel("Película o serie")
                    .setStyle(TextInputStyle.Short)
                    .setMaxLength(100)
                    .setRequired(true),
            ),
        );
}

/** Busca en Seerr el título del formulario y enseña los resultados para elegir cuál añadir. */
async function buscarParaQuieroVer(interaction) {
    const titulo = interaction.fields.getTextInputValue("titulo").trim();
    // Viene del botón de la pantalla de la lista (un mensaje privado): se actualiza ese mensaje.
    await interaction.deferUpdate();
    let resultados;
    try {
        resultados = (await seerrClient.searchMulti(interaction.guildId, titulo)).slice(0, 5);
    } catch (e) {
        return interaction.editReply(
            pantallaQuieroVer(interaction.guildId, interaction.user.id, `❌ No se pudo buscar en Seerr: ${e.message}`),
        );
    }
    return interaction.editReply(pantallaResultados(resultados, titulo));
}

/** Los botones de una sesión de cine (apuntarse, salirse, votar, sugerir, cancelar). */
async function handleCineBoton(interaction, customId) {
    // 🗳️ cine_votar_{sesión}_{opción}: votar o quitar el voto a una película de la sesión (#393).
    const voto = /^cine_votar_(\d+)_(\d+)$/.exec(customId);
    if (voto) {
        const r = cineVotos.votar(voto[1], voto[2], interaction.user.id);
        if (!r.ok) return interaction.reply(efimero({ content: r.mensaje }));
        return interaction.update(pantallaSesion(voto[1]));
    }
    const partes = /^cine_(\w+?)_(\d+)$/.exec(customId);
    if (!partes) return;
    const [, accion, id] = partes;
    const s = cine.sesion(id);
    if (!s) return interaction.reply(efimero({ content: "Esa sesión ya no existe." }));
    const userId = interaction.user.id;
    if (accion === "apuntarse") {
        if (s.cancelada) return interaction.reply(efimero({ content: "Esa sesión está cancelada." }));
        cine.apuntar(id, userId);
        return interaction.update(pantallaSesion(id));
    }
    if (accion === "salirse") {
        cine.salir(id, userId);
        return interaction.update(pantallaSesion(id));
    }
    // 🎯 Sugerencias para el grupo (#399): lo que ninguno de los apuntados con Plex vinculado ha visto, con 📥. Privado.
    if (accion === "sugerir") {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const r = await recomendaciones.generarGrupo(interaction.guildId, cine.asistentes(id));
        return interaction.editReply(pantallaSugerencias(r));
    }
    if (accion === "cancelar") {
        // ManageGuild y no Administrator: quien gestiona el servidor también puede cancelar sesiones de otros.
        const esAdmin = tienePermiso(interaction, "ManageGuild");
        const r = cine.cancelar(id, userId, esAdmin);
        if (!r.ok) return interaction.reply(efimero({ content: r.mensaje }));
        await interaction.update(pantallaSesion(id));
        if (r.serieParada) await interaction.followUp(efimero({ content: "🛑 La serie semanal se ha parado: no habrá más sesiones." }));
        return;
    }
}
