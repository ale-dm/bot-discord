// Partido en adminPanel/plex/ (DT-20): una parte por sección. Esta fachada exporta lo mismo que antes.

const { buildPlexHome, buildPlexTrofeos, buildRolesGordos, buildDiagnosticoIdiomas } = require("./plex/vistas");
const { handlePlexButton } = require("./plex/botones");
const { handlePlexModal } = require("./plex/modales");
const { handlePlexUserSelect, handlePlexChannelSelect, handlePlexStringSelect, handlePlexRoleSelect } = require("./plex/selects");

module.exports = {
    buildPlexHome,
    buildPlexTrofeos,
    buildRolesGordos,
    buildDiagnosticoIdiomas,
    handlePlexButton,
    handlePlexUserSelect,
    handlePlexModal,
    handlePlexChannelSelect,
    handlePlexStringSelect,
    handlePlexRoleSelect,
};
