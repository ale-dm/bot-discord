// Guardar ajustes desde un formulario de Config Global dejando en la auditoría qué cambió (#407): `{ campo: { antes, despues } }`
// solo con lo que cambió de verdad (los campos con nombre de secreto los enmascara adminAudit). Sin cambios, la fila lo indica.
const guildSettings = require("../../systems/guildSettings");
const adminAudit = require("../../systems/adminAudit");

/** Guarda `valores` y audita la acción con el diff. `extra` son detalles propios de la acción (el comando, el canal...). */
function guardarAuditado(guildId, actorId, action, valores, extra = {}) {
    const cambios = guildSettings.cambiosDeAjustes(guildId, valores);
    guildSettings.setManySettings(guildId, valores);
    const hayCambios = Object.keys(cambios).length > 0;
    adminAudit.logAdminAction({
        guildId,
        actorId,
        action,
        details: hayCambios ? { ...extra, cambios } : { ...extra, sinCambios: true },
    });
    return cambios;
}

module.exports = { guardarAuditado };
