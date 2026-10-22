// Comprobaciones de un rol para el menú de autoroles (#539): que exista, que no lo gestione una integración,
// que no sea @everyone, que esté por debajo del bot y que el bot pueda gestionar roles. Se usa al configurar
// el menú y al pulsar un autorol, porque entre una cosa y otra el rol pudo cambiar.
function rolAsignable(guild, roleId) {
    const role = guild?.roles?.cache?.get(roleId);
    if (!role) return { ok: false, motivo: "Ese rol ya no existe en el servidor." };
    if (role.managed) return { ok: false, motivo: "Ese rol lo gestiona una integración y no se puede asignar a mano." };
    if (role.id === guild.id) return { ok: false, motivo: "Ese rol no se puede asignar." };
    const me = guild.members?.me;
    if (!me) return { ok: false, motivo: "No encuentro al bot en el servidor." };
    if (role.position >= me.roles.highest.position) return { ok: false, motivo: "Ese rol está por encima del bot." };
    if (me.permissions && !me.permissions.has("ManageRoles")) return { ok: false, motivo: "Me falta el permiso Gestionar roles." };
    return { ok: true, role };
}

module.exports = { rolAsignable };
