// Herramientas (function calling) que el Duende puede usar al responder: datos del bot, Plex y Seerr.

// Partido en services/duende/herramientas/ (DT-18): una parte por dominio. Esta fachada exporta lo mismo que antes.

const { DUENDE_PLEX_TOOL_DECLARATIONS } = require("./herramientas/plex");
const { DUENDE_SEERR_TOOL_DECLARATIONS } = require("./herramientas/seerr");
const { DUENDE_CORE_TOOL_DECLARATIONS } = require("./herramientas/core");
const { DUENDE_ECONOMIA_TOOL_DECLARATIONS } = require("./herramientas/economia");

const DUENDE_TOOL_EXECUTORS = {
    ...require("./herramientas/plex").DUENDE_PLEX_EXECUTORS,
    ...require("./herramientas/seerr").DUENDE_SEERR_EXECUTORS,
    ...require("./herramientas/core").DUENDE_CORE_EXECUTORS,
    ...require("./herramientas/economia").DUENDE_ECONOMIA_EXECUTORS,
};

module.exports = {
    DUENDE_CORE_TOOL_DECLARATIONS,
    DUENDE_PLEX_TOOL_DECLARATIONS,
    DUENDE_SEERR_TOOL_DECLARATIONS,
    DUENDE_ECONOMIA_TOOL_DECLARATIONS,
    DUENDE_TOOL_EXECUTORS,
};
