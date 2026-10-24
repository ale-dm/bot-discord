// Panel de /duende (F-DU-06, #113): 💬 Hablar, 🧠 Recuerdos, 🎭 Personalidad y 🛡️ Guardia (#553); los admins gestionan además las
// personalidades. Solo construye embeds y botones: los datos están en systems/duende (perfiles) y la lógica de cada
// botón, en commands/duende/duende.
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    UserSelectMenuBuilder,
} = require("discord.js");
const perfiles = require("../systems/duende/perfiles");
const { paginaDeLista } = require("./menuPaginado");

const MAX_OPCIONES = 25;
const cortar = (texto, max) => (texto.length > max ? `${texto.slice(0, max - 1)}…` : texto);

function opcionesPersonalidades(personalidades, actual) {
    return personalidades.slice(0, MAX_OPCIONES).map((p) => ({
        label: cortar(p.title || p.id, 100),
        description: cortar(p.id, 100),
        value: p.id,
        default: p.id === actual,
    }));
}

// 🛡️ Guardia (#553): sin guardia, cualquiera la pone; con guardia, solo quien la puso o un admin la mueve o la deja
// (el resto ve los botones deshabilitados). Caben en la primera fila: como mucho 5 botones.
function botonesGuardia(guardia) {
    const poner = new ButtonBuilder().setCustomId("duendepanel_guardia").setLabel("🛡️ Guardia").setStyle(ButtonStyle.Secondary);
    if (!guardia) return [poner];
    return [
        poner.setDisabled(!guardia.puedeGestionar),
        new ButtonBuilder()
            .setCustomId("duendepanel_guardia_dejar")
            .setLabel("🚪 Dejar la guardia")
            .setStyle(ButtonStyle.Danger)
            .setDisabled(!guardia.puedeGestionar),
    ];
}

const textoGuardia = (g) =>
    `En **${g.canalNombre}** desde <t:${Math.floor(g.desde / 1000)}:R>, la puso <@${g.porUserId}>. Me quedo hasta que la dejen.`;

/** El inicio del panel. `guardia`: la guardia activa ({ canalNombre, porUserId, desde, puedeGestionar }) o null. */
function buildInicio({ esAdmin, personalidad, guardia = null }) {
    const embed = new EmbedBuilder()
        .setTitle("🤖 El Duende")
        .setDescription(
            "Habla con él, mira lo que recuerda de ti y cambia su personalidad en este canal." +
                "\n🛡️ Con **Guardia** se queda en tu canal de voz hasta que lo saques." +
                (esAdmin ? "\n\n⚙️ Como admin, también puedes añadir o quitar personalidades." : ""),
        )
        .addFields({
            name: "🎭 Personalidad de este canal",
            value: personalidad ? personalidad.title || personalidad.id : "La de por defecto",
        })
        .setColor(0x8e44ad);
    if (guardia) embed.addFields({ name: "🛡️ De guardia", value: textoGuardia(guardia) });

    const filas = [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("duendepanel_hablar").setLabel("💬 Hablar").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId("duendepanel_recuerdos").setLabel("🧠 Recuerdos").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("duendepanel_personalidad").setLabel("🎭 Personalidad").setStyle(ButtonStyle.Secondary),
            ...botonesGuardia(guardia),
        ),
    ];
    if (esAdmin) {
        filas.push(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId("duendepanel_add").setLabel("➕ Añadir personalidad").setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId("duendepanel_quitar").setLabel("🗑️ Quitar personalidad").setStyle(ButtonStyle.Danger),
            ),
        );
    }
    return { content: "", embeds: [embed], components: filas, allowedMentions: { parse: [] } };
}

/** Lo que el Duende recuerda de `objetivo` (un usuario de Discord). Los admins pueden elegir a otra persona. */
function buildRecuerdos({ esAdmin, objetivo, aviso = null, puedeBorrar = false }) {
    const perfil = perfiles.perfilDe(objetivo);
    const notas = perfil ? (perfil.notas.length ? perfil.notas : perfil.description ? [perfil.description] : []) : [];
    const lista = notas.length ? notas.map((n, i) => `${i + 1}. ${n}`).join("\n") : "*(todavía no recuerdo nada de esta persona)*";

    const embed = new EmbedBuilder()
        .setTitle(`🧠 Lo que recuerdo de ${objetivo.username}`)
        .setDescription((aviso ? `${aviso}\n\n` : "") + cortar(lista, 3900))
        .setColor(0x3498db);

    const filas = [];
    if (esAdmin) {
        filas.push(
            new ActionRowBuilder().addComponents(
                new UserSelectMenuBuilder()
                    .setCustomId("duendepanel_persona")
                    .setPlaceholder("Elegir a otra persona")
                    .setMinValues(1)
                    .setMaxValues(1),
            ),
        );
    }
    // 🗑️ Olvidar una sola nota (#405): solo la propia persona o un admin ven el menú.
    if (puedeBorrar && perfil?.notas.length) {
        filas.push(
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`duendepanel_nota_borrar_${objetivo.id}`)
                    .setPlaceholder("Olvidar solo una nota")
                    .addOptions(
                        paginaDeLista(perfil.notas).items.map((n, i) => ({ label: cortar(`${i + 1}. ${n}`, 100), value: String(i) })),
                    ),
            ),
        );
    }
    filas.push(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`duendepanel_anotar_${objetivo.id}`).setLabel("✏️ Anotar algo").setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(`duendepanel_olvidar_${objetivo.id}`)
                .setLabel("🧹 Olvidar notas")
                .setStyle(ButtonStyle.Danger)
                .setDisabled(!perfil?.notas.length),
            new ButtonBuilder().setCustomId("duendepanel_inicio").setLabel("◀ Duende").setStyle(ButtonStyle.Secondary),
        ),
    );
    return { content: "", embeds: [embed], components: filas };
}

/** La personalidad del canal y, para admins, el menú para elegirla. */
function buildPersonalidad({ esAdmin, canal, personalidades, actual, aviso = null }) {
    const lista = personalidades.length
        ? personalidades.map((p) => `• **${p.title || p.id}** (\`${p.id}\`)`).join("\n")
        : "No hay personalidades todavía.";
    const embed = new EmbedBuilder()
        .setTitle("🎭 Personalidad del Duende")
        .setDescription(
            (aviso ? `${aviso}\n\n` : "") +
                `En este canal: **${actual ? actual.title || actual.id : "la de por defecto"}**${actual ? ` · voz: ${actual.voz || "la global"}` : ""}\n\n${lista}`,
        )
        .setColor(0x8e44ad);

    const filas = [];
    if (esAdmin && personalidades.length) {
        filas.push(
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId("duendepanel_canal")
                    .setPlaceholder("Elegir la personalidad de este canal")
                    .addOptions(opcionesPersonalidades(personalidades, actual?.id)),
            ),
        );
    }
    // 🗣️ La voz de la personalidad de este canal (#396): una de las siete, o la global.
    if (esAdmin && actual) {
        filas.push(
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId("duendepanel_voz")
                    .setPlaceholder(`Voz de ${actual.title || actual.id}`)
                    .addOptions([
                        { label: "Voz global (por defecto)", value: "global", default: !actual.voz },
                        ...perfiles.VOCES.map((v) => ({ label: v, value: v, default: v === actual.voz })),
                    ]),
            ),
        );
    }
    filas.push(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("duendepanel_inicio").setLabel("◀ Duende").setStyle(ButtonStyle.Secondary),
        ),
    );
    return { content: "", embeds: [embed], components: filas };
}

function buildQuitar({ personalidades }) {
    const embed = new EmbedBuilder()
        .setTitle("🗑️ Quitar una personalidad")
        .setDescription(personalidades.length ? "Elige cuál quitar. No se puede deshacer." : "No hay personalidades que quitar.")
        .setColor(0xe74c3c);
    const filas = [];
    if (personalidades.length) {
        filas.push(
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId("duendepanel_quitar_select")
                    .setPlaceholder("Elegir la personalidad a quitar")
                    .addOptions(opcionesPersonalidades(personalidades)),
            ),
        );
    }
    filas.push(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("duendepanel_inicio").setLabel("◀ Duende").setStyle(ButtonStyle.Secondary),
        ),
    );
    return { content: "", embeds: [embed], components: filas };
}

module.exports = { buildInicio, buildRecuerdos, buildPersonalidad, buildQuitar };
