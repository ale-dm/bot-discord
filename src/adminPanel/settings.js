// Partido en adminPanel/settings/ (DT-20): una parte por sección. Esta fachada exporta lo mismo que antes.

const { buildConfigHome } = require("./settings/vistas");
const { handleSettingsButton } = require("./settings/botones");
const { handleSettingsModal } = require("./settings/modales");

module.exports = {
    buildConfigHome,
    handleSettingsButton,
    handleSettingsModal,
};
