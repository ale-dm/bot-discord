// 🔊 Sonidos en /paneladmin: subir un sonido (nombre + archivo mp3/ogg/wav de hasta 1 MB, en un formulario), probarlo en
// tu canal de voz, editarlo (nombre o archivo) y borrarlo. Lo que suena lo mira /sonidos (systems/sonidos.js).
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    LabelBuilder,
    FileUploadBuilder,
    StringSelectMenuBuilder,
    MessageFlags,
} = require("discord.js");
const sonidos = require("../systems/sonidos");
const { createLogger } = require("../core/logger");
const { paginaDeLista, filaPaginas } = require("../paneles/menuPaginado");

const log = createLogger("PanelAdmin").child("Sonidos");

const efimero = (content) => ({ content, flags: MessageFlags.Ephemeral });

function buildSonidosHome(guildId) {
    const lista = sonidos.listar(guildId);
    const lleno = lista.length >= sonidos.MAX_SONIDOS;
    const embed = new EmbedBuilder()
        .setTitle("🔊 Sonidos")
        .setColor(0x3498db)
        .setDescription(
            `Sonidos del servidor: **${lista.length}** de ${sonidos.MAX_SONIDOS}.\n` +
                "Los reproduce **/sonidos** (con el botón de cada uno). Formatos: mp3, ogg o wav, hasta 1 MB.\n\n" +
                (lista.length ? lista.map((s) => `🔊 ${s.nombre}`).join("\n") : "Todavía no hay ninguno."),
        );
    const fila = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("paneladmin_sonidos_subir")
            .setLabel("➕ Subir sonido")
            .setStyle(ButtonStyle.Success)
            .setDisabled(lleno),
        new ButtonBuilder()
            .setCustomId("paneladmin_sonidos_probar")
            .setLabel("▶ Probar")
            .setStyle(ButtonStyle.Primary)
            .setDisabled(!lista.length),
        new ButtonBuilder()
            .setCustomId("paneladmin_sonidos_editar")
            .setLabel("✏️ Editar")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!lista.length),
        new ButtonBuilder()
            .setCustomId("paneladmin_sonidos_borrar")
            .setLabel("🗑️ Borrar sonido")
            .setStyle(ButtonStyle.Danger)
            .setDisabled(!lista.length),
        new ButtonBuilder().setCustomId("paneladmin_home").setLabel("◀ Panel principal").setStyle(ButtonStyle.Secondary),
    );
    return { content: "", embeds: [embed], components: [fila] };
}

const filaVolver = () =>
    new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_sonidos_home").setLabel("◀ Volver a sonidos").setStyle(ButtonStyle.Secondary),
    );

/**
 * Una pantalla con un menú para elegir un sonido, por páginas de 25. `modo` es borrar, probar o editar: da el customId del
 * menú (`paneladmin_sonidos_<modo>_select`) y el de los botones de página (`paneladmin_sonidos_<modo>_p_<n>`).
 */
function buildElegir(guildId, modo, pagina, { titulo, descripcion, placeholder, color }) {
    const pag = paginaDeLista(sonidos.listar(guildId), pagina);
    const embed = new EmbedBuilder().setTitle(titulo).setColor(color).setDescription(descripcion);
    const menu = new StringSelectMenuBuilder()
        .setCustomId(`paneladmin_sonidos_${modo}_select`)
        .setPlaceholder(placeholder)
        .addOptions(pag.items.map((s) => ({ label: s.nombre.slice(0, 100), value: String(s.id) })));
    const paginas = filaPaginas(`paneladmin_sonidos_${modo}_p_`, pag);
    return {
        content: "",
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(menu), ...(paginas ? [paginas] : []), filaVolver()],
    };
}

const PANTALLAS_ELEGIR = {
    borrar: {
        titulo: "🗑️ Borrar un sonido",
        descripcion: "Elige cuál borrar. Se quita del panel y del disco.",
        placeholder: "Qué sonido borrar",
        color: 0xe74c3c,
    },
    probar: {
        titulo: "▶ Probar un sonido",
        descripcion: "Elige uno y suena en tu canal de voz, sin salir de aquí. Si no estás en un canal, te lo digo.",
        placeholder: "Qué sonido probar",
        color: 0x3498db,
    },
    editar: {
        titulo: "✏️ Editar un sonido",
        descripcion: "Elige cuál editar: puedes cambiarle el nombre o el archivo.",
        placeholder: "Qué sonido editar",
        color: 0xf1c40f,
    },
};

const buildPantallaElegir = (guildId, modo, pagina = 0) => buildElegir(guildId, modo, pagina, PANTALLAS_ELEGIR[modo]);

/** Lo que se puede cambiar de un sonido: el nombre o el archivo. */
function buildOpcionesEditar(sonido) {
    const embed = new EmbedBuilder()
        .setTitle(`✏️ ${sonido.nombre}`)
        .setColor(0xf1c40f)
        .setDescription("Qué quieres cambiar. El archivo nuevo sustituye al anterior, y el sonido conserva su sitio en la lista.");
    const fila = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`paneladmin_sonidos_renombrar_${sonido.id}`).setLabel("✏️ Renombrar").setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`paneladmin_sonidos_archivo_${sonido.id}`)
            .setLabel("🔁 Cambiar archivo")
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("paneladmin_sonidos_editar").setLabel("◀ Otro sonido").setStyle(ButtonStyle.Secondary),
    );
    return { content: "", embeds: [embed], components: [fila, filaVolver()] };
}

function modalSubir() {
    return new ModalBuilder()
        .setCustomId("paneladmin_sonidos_modal_subir")
        .setTitle("➕ Subir sonido")
        .addLabelComponents(
            new LabelBuilder()
                .setLabel("Cómo se llama")
                .setTextInputComponent(
                    new TextInputBuilder()
                        .setCustomId("nombre")
                        .setStyle(TextInputStyle.Short)
                        .setMaxLength(32)
                        .setPlaceholder("Risa de Ana")
                        .setRequired(true),
                ),
            new LabelBuilder()
                .setLabel("Archivo (mp3, ogg o wav, 1 MB)")
                .setFileUploadComponent(new FileUploadBuilder().setCustomId("archivo").setMinValues(1).setMaxValues(1).setRequired(true)),
        );
}

function modalRenombrar(sonido) {
    return new ModalBuilder()
        .setCustomId(`paneladmin_sonidos_modal_renombrar_${sonido.id}`)
        .setTitle("✏️ Renombrar sonido")
        .addLabelComponents(
            new LabelBuilder()
                .setLabel("Nombre nuevo")
                .setTextInputComponent(
                    new TextInputBuilder()
                        .setCustomId("nombre")
                        .setStyle(TextInputStyle.Short)
                        .setMaxLength(32)
                        .setValue(sonido.nombre)
                        .setRequired(true),
                ),
        );
}

function modalArchivo(sonido) {
    return new ModalBuilder()
        .setCustomId(`paneladmin_sonidos_modal_archivo_${sonido.id}`)
        .setTitle("🔁 Cambiar archivo")
        .addLabelComponents(
            new LabelBuilder()
                .setLabel("Archivo nuevo (mp3, ogg o wav, 1 MB)")
                .setFileUploadComponent(new FileUploadBuilder().setCustomId("archivo").setMinValues(1).setMaxValues(1).setRequired(true)),
        );
}

/** Los botones del panel de sonidos. Devuelve true si era de este panel. */
async function handleSonidosButton(interaction) {
    const id = interaction.customId;
    if (!id.startsWith("paneladmin_sonidos_")) return false;
    const guildId = interaction.guildId;
    const cambio = /^paneladmin_sonidos_(renombrar|archivo)_(\d+)$/.exec(id);
    const elegir = /^paneladmin_sonidos_(borrar|probar|editar)(?:_p_(\d+))?$/.exec(id);
    if (id === "paneladmin_sonidos_home") await interaction.update(buildSonidosHome(guildId));
    else if (id === "paneladmin_sonidos_subir") await interaction.showModal(modalSubir());
    else if (elegir) await interaction.update(buildPantallaElegir(guildId, elegir[1], Number(elegir[2] || 0)));
    else if (cambio) {
        const sonido = sonidos.obtener(guildId, cambio[2]);
        if (!sonido) await interaction.update({ ...buildSonidosHome(guildId), content: "Ese sonido ya no existe." });
        else if (cambio[1] === "renombrar") await interaction.showModal(modalRenombrar(sonido));
        else await interaction.showModal(modalArchivo(sonido));
    } else return false;
    return true;
}

/** Los formularios de subir, renombrar y cambiar el archivo. Devuelve true si era de este panel. */
async function handleSonidosModal(interaction) {
    const id = interaction.customId;
    const renombrar = /^paneladmin_sonidos_modal_renombrar_(\d+)$/.exec(id);
    const archivo = /^paneladmin_sonidos_modal_archivo_(\d+)$/.exec(id);
    if (id !== "paneladmin_sonidos_modal_subir" && !renombrar && !archivo) return false;

    const guildId = interaction.guildId;
    if (id === "paneladmin_sonidos_modal_subir") {
        const nombre = interaction.fields.getTextInputValue("nombre");
        const subido = interaction.fields.getUploadedFiles("archivo")?.first?.() || null;
        if (!subido) {
            await responder(interaction, "❌ No llegó ningún archivo.");
            return true;
        }
        const r = await sonidos.guardar(guildId, {
            nombre,
            archivo: { nombreArchivo: subido.name, url: subido.url, tamano: subido.size },
            userId: interaction.user.id,
        });
        if (!r.ok) {
            await responder(interaction, `❌ ${r.motivo}`);
            return true;
        }
        log.info(`${interaction.user.tag} añadió el sonido «${r.sonido.nombre}» en ${guildId}`);
        await responder(interaction, `✅ Sonido **${r.sonido.nombre}** añadido. Ya sale en /sonidos.`);
        return true;
    }

    if (renombrar) {
        const r = sonidos.renombrar(guildId, renombrar[1], interaction.fields.getTextInputValue("nombre"));
        if (!r.ok) await responder(interaction, `❌ ${r.motivo}`);
        else {
            log.info(`${interaction.user.tag} renombró un sonido a «${r.sonido.nombre}» en ${guildId}`);
            await responder(interaction, `✅ Ahora se llama **${r.sonido.nombre}**.`);
        }
        return true;
    }

    const subido = interaction.fields.getUploadedFiles("archivo")?.first?.() || null;
    if (!subido) {
        await responder(interaction, "❌ No llegó ningún archivo.");
        return true;
    }
    const r = await sonidos.reemplazarArchivo(guildId, archivo[1], { nombreArchivo: subido.name, url: subido.url, tamano: subido.size });
    if (!r.ok) await responder(interaction, `❌ ${r.motivo}`);
    else {
        log.info(`${interaction.user.tag} cambió el archivo de «${r.sonido.nombre}» en ${guildId}`);
        await responder(interaction, `✅ Archivo de **${r.sonido.nombre}** cambiado.`);
    }
    return true;
}

/** Una respuesta privada que no tumba el manejador si el token ya caducó. */
function responder(interaction, texto) {
    return interaction.reply(efimero(texto)).catch((e) => log.warn(`No pude responder en el panel de sonidos: ${e.message}`));
}

/**
 * Toca el sonido en el canal de voz del admin, sin salir del panel. No se espera a que acabe (puede durar minutos): el
 * aviso sale cuando empieza, o cuando no se puede tocar (sin canal, sin permisos, otro sonido sonando...).
 */
async function probar(interaction, sonido) {
    await interaction.deferUpdate();
    const canal = interaction.member?.voice?.channel ?? null;
    const donde = canal ? canal.name : "el canal donde estoy";
    const avisar = (content) => interaction.followUp(efimero(content)).catch((e) => log.warn(`No pude avisar del sonido: ${e.message}`));
    sonidos
        .reproducir(interaction.guildId, canal, sonido, {
            alEmpezar: () => avisar(`🔊 Sonando **${sonido.nombre}** en ${donde}.`),
        })
        .then((r) => {
            if (!r.ok) return avisar(`❌ ${r.motivo}`);
        })
        .catch((e) => log.warn(`No se pudo probar «${sonido.nombre}»: ${e.message}`));
}

/** Los menús de borrar, probar y editar. Devuelve true si era de este panel. */
async function handleSonidosStringSelect(interaction) {
    const id = interaction.customId;
    const guildId = interaction.guildId;
    if (id === "paneladmin_sonidos_probar_select") {
        const sonido = sonidos.obtener(guildId, interaction.values[0]);
        if (!sonido) await interaction.update({ ...buildSonidosHome(guildId), content: "Ese sonido ya no existe." });
        else await probar(interaction, sonido);
        return true;
    }
    if (id === "paneladmin_sonidos_editar_select") {
        const sonido = sonidos.obtener(guildId, interaction.values[0]);
        if (!sonido) await interaction.update({ ...buildSonidosHome(guildId), content: "Ese sonido ya no existe." });
        else await interaction.update(buildOpcionesEditar(sonido));
        return true;
    }
    if (id !== "paneladmin_sonidos_borrar_select") return false;
    const sonido = sonidos.obtener(guildId, interaction.values[0]);
    if (sonido) {
        sonidos.borrar(guildId, sonido.id);
        log.info(`${interaction.user.tag} borró el sonido «${sonido.nombre}» en ${guildId}`);
    }
    await interaction.update({
        ...buildSonidosHome(guildId),
        content: sonido ? `🗑️ Borrado **${sonido.nombre}**.` : "Ese sonido ya no existe.",
    });
    return true;
}

module.exports = { buildSonidosHome, modalSubir, handleSonidosButton, handleSonidosModal, handleSonidosStringSelect };
