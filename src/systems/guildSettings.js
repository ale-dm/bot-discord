// Ajustes de cada servidor: la definición de cada ajuste, cómo se leen y escriben (con caché), los permisos de
// comandos y los límites de uso. Las piezas están en systems/guildSettings/; este fichero reexporta lo que usa el resto.

const { invalidarAjustes, getSettings, setSetting, setManySettings } = require("./guildSettings/acceso");
const { parseCsvIds, setCommandAcl, listCommandAcl, isCommandAllowed } = require("./guildSettings/acl");
const { checkAndConsumeLimit } = require("./guildSettings/limites");

module.exports = {
    parseCsvIds,
    getSettings,

    invalidarAjustes,
    setSetting,
    setManySettings,

    setCommandAcl,
    listCommandAcl,
    isCommandAllowed,
    checkAndConsumeLimit,
};
