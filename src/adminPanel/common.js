const {
    ModalBuilder,
    ActionRowBuilder,
    TextInputBuilder,
    TextInputStyle,
    LabelBuilder,
    RadioGroupBuilder,
    StringSelectMenuBuilder,
    ChannelSelectMenuBuilder,
    RoleSelectMenuBuilder,
    UserSelectMenuBuilder,
    ChannelType,
} = require("discord.js");

const { createLogger } = require("../core/logger");
const { esAdmin } = require("../core/permisos");

const log = createLogger("PanelAdmin");

function isAdmin(interaction) {
    const ok = esAdmin(interaction);
    if (!ok)
        log.warn(
            `Intento de usar el panel de admin sin permisos: ${interaction.user?.tag} (${interaction.user?.id}) · ${interaction.customId || interaction.commandName || "?"}`,
        );
    return ok;
}

function simpleModal(customId, title, inputs) {
    const modal = new ModalBuilder().setCustomId(customId).setTitle(title);
    const rows = inputs.map((i) =>
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId(i.id)
                .setLabel(i.label)
                .setStyle(i.paragraph ? TextInputStyle.Paragraph : TextInputStyle.Short)
                .setRequired(i.required ?? true)
                .setPlaceholder(i.placeholder || "")
                .setMaxLength(i.maxLength || 4000)
                .setValue(i.value || ""),
        ),
    );
    modal.addComponents(...rows);
    return modal;
}

// Opciones de los campos de sí/no: el valor es el mismo que ya leen los manejadores (sí/no o 1/0).
const SI_NO = [
    { label: "Sí", value: "si" },
    { label: "No", value: "no" },
];
const SI_NO_NUMERICO = [
    { label: "Sí", value: "1" },
    { label: "No", value: "0" },
];

/**
 * Un campo de modal que no es texto libre. `tipo`: "radio" (Sí/No u opciones cerradas), "opciones" (desplegable),
 * "canal", "rol" o "usuario" (selectores de Discord, sin escribir IDs). Las opciones van en `opciones: [{ label, value }]`.
 * Discord admite etiquetas de hasta 45 caracteres.
 */
function campoSelector(campo) {
    const etiqueta = new LabelBuilder().setLabel(String(campo.label).slice(0, 45));
    const requerido = campo.required ?? true;
    switch (campo.tipo) {
        case "radio":
            return etiqueta.setRadioGroupComponent(
                new RadioGroupBuilder()
                    .setCustomId(campo.id)
                    .setRequired(requerido)
                    .addOptions(campo.opciones.map((o) => ({ label: o.label, value: o.value, default: o.value === campo.valor }))),
            );
        case "opciones":
            return etiqueta.setStringSelectMenuComponent(
                new StringSelectMenuBuilder()
                    .setCustomId(campo.id)
                    .setRequired(requerido)
                    .setPlaceholder(campo.placeholder || "Elige una")
                    .addOptions(campo.opciones.map((o) => ({ label: o.label, value: o.value, default: o.value === campo.valor }))),
            );
        case "canal": {
            // Un canal, o varios si `multiple`. `valor` (uno) o `valores` (varios) dejan marcado lo que ya hay guardado.
            const selector = new ChannelSelectMenuBuilder()
                .setCustomId(campo.id)
                .setRequired(requerido)
                .setMinValues(0)
                .setMaxValues(campo.multiple ? 25 : 1)
                .setChannelTypes(ChannelType.GuildText)
                .setPlaceholder(campo.placeholder || (campo.multiple ? "Elige canales" : "Elige un canal"));
            const marcados = campo.valores ?? (campo.valor ? [campo.valor] : []);
            if (marcados.length) selector.setDefaultChannels(marcados);
            return etiqueta.setChannelSelectMenuComponent(selector);
        }
        case "rol": {
            const selector = new RoleSelectMenuBuilder()
                .setCustomId(campo.id)
                .setRequired(requerido)
                .setMinValues(0)
                .setMaxValues(campo.multiple ? 25 : 1)
                .setPlaceholder(campo.placeholder || (campo.multiple ? "Elige roles" : "Elige un rol"));
            const marcados = campo.valores ?? (campo.valor ? [campo.valor] : []);
            if (marcados.length) selector.setDefaultRoles(marcados);
            return etiqueta.setRoleSelectMenuComponent(selector);
        }
        case "usuario": {
            const selector = new UserSelectMenuBuilder()
                .setCustomId(campo.id)
                .setRequired(requerido)
                .setMinValues(0)
                .setMaxValues(campo.multiple ? 25 : 1)
                .setPlaceholder(campo.placeholder || (campo.multiple ? "Elige personas" : "Elige a una persona"));
            const marcados = campo.valores ?? (campo.valor ? [campo.valor] : []);
            if (marcados.length) selector.setDefaultUsers(marcados);
            return etiqueta.setUserSelectMenuComponent(selector);
        }
        default:
            throw new Error(`Tipo de campo sin selector: ${campo.tipo}`);
    }
}

/**
 * Como simpleModal, pero admite campos de texto (`tipo` ausente) y campos de selector (ver campoSelector). Los de texto
 * van en su fila de siempre; los selectores, en su etiqueta.
 */
function modalConCampos(customId, title, campos) {
    const modal = new ModalBuilder().setCustomId(customId).setTitle(title);
    for (const campo of campos) {
        if (campo.tipo) modal.addLabelComponents(campoSelector(campo));
        else modal.addComponents(simpleModal(customId, title, [campo]).components[0]);
    }
    return modal;
}

/** Los canales elegidos en un selector de canales (lista de IDs; vacía si no se eligió ninguno). */
function canalesElegidos(fields, id) {
    const elegidos = fields.getSelectedChannels(id);
    return elegidos ? [...elegidos.keys()] : [];
}

/** El canal elegido en un selector de uno ("" si no se eligió ninguno). */
function canalElegido(fields, id) {
    return canalesElegidos(fields, id)[0] ?? "";
}

/** Los roles elegidos en un selector de roles (lista de IDs). */
function rolesElegidos(fields, id) {
    const elegidos = fields.getSelectedRoles(id);
    return elegidos ? [...elegidos.keys()] : [];
}

/** Las personas elegidas en un selector de usuarios (lista de IDs). */
function usuariosElegidos(fields, id) {
    const elegidos = fields.getSelectedUsers(id);
    return elegidos ? [...elegidos.keys()] : [];
}

/** La persona elegida en un selector de una ("" si no se eligió ninguna). */
function usuarioElegido(fields, id) {
    return usuariosElegidos(fields, id)[0] ?? "";
}

/** La opción elegida en un desplegable ("" si no se eligió ninguna). */
function opcionElegida(fields, id) {
    return fields.getStringSelectValues(id, false)?.[0] ?? "";
}

/** El rol elegido en un selector de uno ("" si no se eligió ninguno). */
function rolElegido(fields, id) {
    return rolesElegidos(fields, id)[0] ?? "";
}

module.exports = {
    isAdmin,
    simpleModal,
    modalConCampos,
    campoSelector,
    SI_NO,
    SI_NO_NUMERICO,
    canalesElegidos,
    canalElegido,
    rolesElegidos,
    rolElegido,
    usuariosElegidos,
    usuarioElegido,
    opcionElegida,
};
