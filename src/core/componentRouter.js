// Enrutado de componentes (botones, selects, modales) a su módulo.
// Cada módulo declara lo que atiende en `componentHandlers`:
//
//   componentHandlers: [
//       { types: ["button"], prefixes: ["tienda_"], method: "handleButton", acl: "tienda" },
//       { types: ["stringSelect"], ids: ["casino_ruleta_numero_sel"], method: "handleSelect", acl: "juegos" },
//   ]
//
// types:    button | stringSelect | userSelect | roleSelect | channelSelect | modal
// prefixes: customIds que empiezan por…   ids: customIds exactos
// method:   nombre del método del módulo a llamar con (client, interaction)
// acl:      opcional, nombre de comando cuyo ACL (canales/roles) se aplica también al componente
//
// Si varias rutas encajan, gana la más específica: un id exacto antes que cualquier
// prefijo, y el prefijo más largo antes que uno más corto (así "apuestas_quiniela_"
// va a la quiniela aunque "apuestas_" sea de apuestas).

const TYPE_CHECKS = {
    button: (i) => i.isButton(),
    stringSelect: (i) => i.isStringSelectMenu(),
    userSelect: (i) => i.isUserSelectMenu(),
    roleSelect: (i) => i.isRoleSelectMenu(),
    channelSelect: (i) => i.isChannelSelectMenu(),
    modal: (i) => i.isModalSubmit(),
};

function createComponentRouter() {
    const routes = [];

    function register(mod, source = "?") {
        const handlers = mod && mod.componentHandlers;
        if (!Array.isArray(handlers)) return 0;
        for (const h of handlers) {
            const unknownType = (h.types || []).find((t) => !TYPE_CHECKS[t]);
            if (unknownType) throw new Error(`Tipo de componente desconocido "${unknownType}" en ${source}`);
            if (typeof mod[h.method] !== "function") throw new Error(`Método "${h.method}" no existe en ${source}`);
            routes.push({
                mod,
                source,
                method: h.method,
                acl: h.acl || null,
                types: h.types || [],
                prefixes: h.prefixes || [],
                ids: h.ids || [],
            });
        }
        return handlers.length;
    }

    function match(interaction) {
        const customId = interaction.customId;
        if (typeof customId !== "string") return null;
        let best = null;
        let bestScore = -1;
        for (const r of routes) {
            if (!r.types.some((t) => TYPE_CHECKS[t](interaction))) continue;
            let score = -1;
            if (r.ids.includes(customId)) score = Infinity;
            else {
                for (const p of r.prefixes) {
                    if (customId.startsWith(p) && p.length > score) score = p.length;
                }
            }
            if (score > bestScore) {
                best = r;
                bestScore = score;
            }
        }
        return best;
    }

    return {
        register,
        match,
        get size() {
            return routes.length;
        },
    };
}

module.exports = { createComponentRouter };
