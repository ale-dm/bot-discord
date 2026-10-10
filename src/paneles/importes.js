// Formularios de cantidad de los jugadores (apuestas, retos, economía; #309, grupo G5): un desplegable con los importes
// habituales y, debajo, el campo de texto para cualquier otro. Si se elige un importe, manda él; si se elige «Otra
// cantidad», o no se elige nada, manda el texto.
const { ActionRowBuilder, LabelBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");
const { fmtNumero } = require("../core/formato");

const CAMPO_RAPIDO = "importe";
const OTRA = "otra";
const IMPORTES_RAPIDOS = [100, 500, 1000, 5000];

/**
 * Las dos filas de la cantidad: el desplegable (con «Todo» si `todo` es mayor que cero y no es ya un importe habitual) y
 * el texto. El texto va opcional porque el desplegable puede cubrir la cantidad; `textoEtiqueta` dice el rango.
 */
function filasImporte({ textoId = "cantidad", textoEtiqueta, placeholder = "Escribe una cantidad", maxLength = 7, todo = 0 }) {
    const opciones = IMPORTES_RAPIDOS.map((n) => ({ label: fmtNumero(n), value: String(n) }));
    if (todo > 0 && !IMPORTES_RAPIDOS.includes(todo)) opciones.push({ label: `Todo (${fmtNumero(todo)})`, value: String(todo) });
    opciones.push({ label: "Otra cantidad", value: OTRA, description: "Escríbela en el campo de abajo" });

    const desplegable = new LabelBuilder()
        .setLabel("Importe rápido")
        .setStringSelectMenuComponent(
            new StringSelectMenuBuilder()
                .setCustomId(CAMPO_RAPIDO)
                .setRequired(false)
                .setMinValues(0)
                .setMaxValues(1)
                .setPlaceholder("Elige un importe")
                .addOptions(opciones),
        );
    const texto = new ActionRowBuilder().addComponents(
        new TextInputBuilder()
            .setCustomId(textoId)
            .setLabel(textoEtiqueta.slice(0, 45))
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(placeholder)
            .setMinLength(1)
            .setMaxLength(maxLength)
            .setRequired(false),
    );
    return [desplegable, texto];
}

/**
 * La cantidad que escribió o eligió el jugador. NaN si no puso ninguna: cada manejador ya rechaza los valores que no
 * son un número entero dentro de su rango.
 */
function importeElegido(fields, textoId = "cantidad") {
    const eleccion = fields.getStringSelectValues(CAMPO_RAPIDO, false)?.[0];
    if (eleccion && eleccion !== OTRA) return Number(eleccion);
    const texto = fields.getTextInputValue(textoId) ?? "";
    if (texto.trim() === "") return NaN;
    return Number(texto.replace(/[.\s]/g, ""));
}

module.exports = { IMPORTES_RAPIDOS, filasImporte, importeElegido };
