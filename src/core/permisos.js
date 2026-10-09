// Permisos de quien usa un comando o pulsa un componente. Un solo criterio para todo el bot: se mira el permiso del
// miembro en la propia interacción (o en el miembro, si la interacción no lo trae).
function tienePermiso(interaction, permiso = "Administrator") {
    const permisos = interaction.memberPermissions ?? interaction.member?.permissions;
    return !!permisos?.has?.(permiso);
}

const esAdmin = (interaction) => tienePermiso(interaction, "Administrator");

module.exports = { tienePermiso, esAdmin };
