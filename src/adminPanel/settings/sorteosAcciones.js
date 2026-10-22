// Acciones de los botones de 🎁 Sorteos (#541), en su propio módulo para que botones.js no pase del límite.
const {
    buildSorteosPanel,
    abrirModalNuevo,
    abrirModalRequisitos,
    publicarSinRequisitos,
    cancelarBorrador,
    cancelarSorteo,
} = require("./sorteos");

async function accionSorteos(interaction, id, guildId) {
    await interaction.update(buildSorteosPanel(guildId));
    return true;
}

async function accionSorteosNew(interaction) {
    return abrirModalNuevo(interaction);
}

async function accionSorteosReq(interaction, id, guildId) {
    return abrirModalRequisitos(interaction, guildId);
}

async function accionSorteosOk(interaction, id, guildId) {
    return publicarSinRequisitos(interaction, guildId);
}

async function accionSorteosCancel(interaction, id, guildId) {
    return cancelarBorrador(interaction, guildId);
}

async function accionSorteosCancelarUno(interaction, id, guildId, sorteoId) {
    return cancelarSorteo(interaction, guildId, sorteoId);
}

module.exports = {
    accionSorteos,
    accionSorteosNew,
    accionSorteosReq,
    accionSorteosOk,
    accionSorteosCancel,
    accionSorteosCancelarUno,
};
