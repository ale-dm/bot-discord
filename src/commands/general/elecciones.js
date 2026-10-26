// 🗳️ /elecciones: presentarse, retirarse, escribir el programa y ver en qué punto están las elecciones a la presidencia. El
// panel público (lo abre un admin en /paneladmin → Config Global → 🗳️ Elecciones) tiene los mismos botones y el de votar,
// que pregunta a quién y si el voto es 🔒 secreto o 📢 público. Reglas en systems/elecciones, mensajes en paneles/elecciones.
const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { repo, candidatos, votos } = require("../../systems/elecciones");
const { mensajeEleccion } = require("../../paneles/elecciones/panel");
const { embedsProgramas } = require("../../paneles/elecciones/anuncios");
const { pasoElegir, pasoModo, votoHecho, modalPrograma } = require("../../paneles/elecciones/votacion");
const envios = require("../../discord/envios/elecciones");
const { efimero } = require("../../discord/respuestas");

const persona = (interaction) => ({ esBot: Boolean(interaction.user.bot), unidoEn: interaction.member?.joinedTimestamp ?? null });

/** Los nombres visibles de esas personas en el servidor (si no se pueden pedir, se usa el id). */
async function nombres(guild, userIds) {
    if (!guild || !userIds.length) return new Map();
    const miembros = await guild.members.fetch({ user: userIds }).catch(() => null);
    return new Map(miembros ? [...miembros.values()].map((m) => [m.id, m.displayName]) : []);
}

/** La elección activa si es la del botón; si no, null (el botón es de unas elecciones que ya acabaron). */
function eleccionDelBoton(guildId, id) {
    const eleccion = repo.activa(guildId);
    return eleccion && eleccion.id === Number(id) ? eleccion : null;
}

async function inscribirse(client, interaction) {
    const r = candidatos.inscribir({ guildId: interaction.guildId, userId: interaction.user.id, ...persona(interaction) });
    if (!r.ok) return interaction.reply(efimero(r.mensaje));
    await interaction.reply(efimero(r.vuelve ? "🙋 Vuelves a ser candidato. ¡Suerte!" : "🙋 ¡Ya eres candidato a la presidencia! Suerte."));
    await envios.repintar(client, repo.obtener(r.eleccion.id));
}

async function retirarse(client, interaction) {
    const r = candidatos.retirarse(interaction.guildId, interaction.user.id);
    if (!r.ok) return interaction.reply(efimero(r.mensaje));
    await interaction.reply(efimero("🚪 Te has retirado de las elecciones. Los votos que tenías dejan de contar."));
    await envios.repintar(client, repo.obtener(r.eleccion.id));
}

async function abrirPrograma(interaction, eleccion) {
    const c = eleccion ? repo.candidato(eleccion.id, interaction.user.id) : null;
    if (!eleccion || eleccion.estado !== "programas") return interaction.reply(efimero("📜 Ahora no es la fase de programas."));
    if (!c || c.retirado || !c.finalista) return interaction.reply(efimero("❌ Solo los finalistas escriben programa."));
    return interaction.showModal(modalPrograma(eleccion.id, c));
}

async function verProgramas(interaction, eleccion) {
    const lista = repo
        .candidatos(eleccion.id, { finalistas: true })
        .filter((c) => eleccion.estado !== "mandato" || c.userId === eleccion.presidenteId);
    if (!lista.length) return interaction.reply(efimero("📜 Todavía no hay finalistas."));
    const n = await nombres(
        interaction.guild,
        lista.map((c) => c.userId),
    );
    return interaction.reply(efimero({ embeds: embedsProgramas(lista, n), allowedMentions: { parse: [] } }));
}

/** 🗳️ Votar: el paso de elegir candidato (en privado; desde ↩️ Elegir otro, en el mismo mensaje). */
async function empezarVoto(interaction, eleccion) {
    if (!votos.FASES_VOTO.has(eleccion.estado)) return interaction.reply(efimero("🔒 Ahora mismo no se vota."));
    const papeleta = repo.candidatos(eleccion.id, { finalistas: eleccion.estado === "generales" });
    if (!papeleta.length) return interaction.reply(efimero("📋 No hay nadie en la papeleta."));
    const payload = pasoElegir(
        eleccion,
        papeleta,
        await nombres(
            interaction.guild,
            papeleta.map((c) => c.userId),
        ),
        votos.miVoto(eleccion, interaction.user.id),
    );
    if (interaction.message?.flags?.has?.(MessageFlags.Ephemeral)) return interaction.update(payload);
    return interaction.reply(efimero(payload));
}

async function votar(client, interaction, candidatoId, publico) {
    const r = votos.votar({ guildId: interaction.guildId, votanteId: interaction.user.id, candidatoId, publico, ...persona(interaction) });
    if (!r.ok) return interaction.update({ content: r.mensaje, embeds: [], components: [] });
    await interaction.update(votoHecho(r, candidatoId));
    await envios.repintar(client, r.eleccion);
}

module.exports = {
    componentHandlers: [
        { types: ["button"], prefixes: ["elec_"], method: "handleButton", acl: "elecciones" },
        { types: ["stringSelect"], prefixes: ["elec_elegir_"], method: "handleSelect", acl: "elecciones" },
        { types: ["modal"], prefixes: ["elec_programamodal_"], method: "handleModal", acl: "elecciones" },
    ],
    data: new SlashCommandBuilder()
        .setName("elecciones")
        .setDescription("🗳️ Elecciones a la presidencia del servidor")
        .addSubcommand((s) => s.setName("estado").setDescription("En qué fase están las elecciones y quién se presenta"))
        .addSubcommand((s) => s.setName("inscribirse").setDescription("Preséntate como candidato a presidente"))
        .addSubcommand((s) => s.setName("retirarse").setDescription("Retira tu candidatura"))
        .addSubcommand((s) => s.setName("programa").setDescription("Escribe tu programa electoral (solo finalistas)")),

    async run(client, interaction) {
        if (!interaction.guildId) return interaction.reply(efimero("Esto solo funciona en un servidor."));
        const sub = interaction.options.getSubcommand();
        if (sub === "inscribirse") return inscribirse(client, interaction);
        if (sub === "retirarse") return retirarse(client, interaction);
        const eleccion = repo.activa(interaction.guildId);
        if (sub === "programa") return abrirPrograma(interaction, eleccion);
        if (!eleccion) return interaction.reply(efimero("🗳️ Ahora mismo no hay elecciones en marcha."));
        const payload = mensajeEleccion(eleccion);
        const enlace =
            eleccion.channelId && eleccion.messageId
                ? `🔗 Panel: https://discord.com/channels/${interaction.guildId}/${eleccion.channelId}/${eleccion.messageId}`
                : "";
        return interaction.reply(efimero({ ...payload, content: enlace, components: [] }));
    },

    // elec_{acción}_{id}[_{candidato}_{s|p}]
    async handleButton(client, interaction) {
        const [accion, id, candidatoId, modo] = interaction.customId.slice("elec_".length).split("_");
        const eleccion = eleccionDelBoton(interaction.guildId, id);
        if (!eleccion) return interaction.reply(efimero("🔒 Estas elecciones ya han terminado."));
        if (accion === "inscribir") return inscribirse(client, interaction);
        if (accion === "retirar") return retirarse(client, interaction);
        if (accion === "programa") return abrirPrograma(interaction, eleccion);
        if (accion === "programas") return verProgramas(interaction, eleccion);
        if (accion === "votar") return empezarVoto(interaction, eleccion);
        if (accion === "modo") return votar(client, interaction, candidatoId, modo === "p");
        return interaction.reply(efimero("❓ Botón desconocido."));
    },

    // elec_elegir_{id}: ya ha elegido candidato; falta secreto o público.
    async handleSelect(client, interaction) {
        const eleccion = eleccionDelBoton(interaction.guildId, interaction.customId.slice("elec_elegir_".length));
        if (!eleccion) return interaction.update({ content: "🔒 Estas elecciones ya han terminado.", embeds: [], components: [] });
        return interaction.update(pasoModo(eleccion, interaction.values[0]));
    },

    // elec_programamodal_{id}
    async handleModal(client, interaction) {
        const r = candidatos.guardarPrograma({
            guildId: interaction.guildId,
            userId: interaction.user.id,
            partido: interaction.fields.getTextInputValue("partido"),
            eslogan: interaction.fields.getTextInputValue("eslogan"),
            titulo: interaction.fields.getTextInputValue("titulo"),
            texto: interaction.fields.getTextInputValue("texto"),
        });
        if (!r.ok) return interaction.reply(efimero(r.mensaje));
        await interaction.reply(
            efimero(r.corregido ? "✏️ Programa corregido." : "📜 ¡Programa entregado! Se enviará a los votantes al empezar las generales."),
        );
        await envios.repintar(client, repo.obtener(r.eleccion.id));
    },
};
