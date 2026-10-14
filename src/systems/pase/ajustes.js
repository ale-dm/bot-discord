// Los ajustes del pase de cada servidor (#353): si está activo, el tope diario de cada categoría, lo que cuesta cada nivel, el canal donde
// se anuncian las subidas de nivel (#344) y los objetos que dan algunos niveles (#364). Salen de systems/guildSettings (`pase.*`) y, sin
// ajustes guardados, valen exactamente lo de systems/pase/constantes.
const guildSettings = require("../guildSettings");
const { CATEGORIAS } = require("./constantes");

/** Los objetos por nivel (`pase.objetos`: JSON {"10": 3}) como { nivel: itemId }, sin lo que no sea un nivel y un id. */
function leerObjetos(texto) {
    try {
        const crudo = JSON.parse(texto || "{}");
        return Object.fromEntries(
            Object.entries(crudo).filter(([nivel, id]) => Number.isInteger(Number(nivel)) && Number.isInteger(Number(id))),
        );
    } catch {
        return {};
    }
}

/**
 * Los ajustes del pase de un servidor: { activo, topes: { categoria: n }, xpBase, xpPaso, canalNivel, objetos: { nivel: itemId } }.
 * Sin servidor (o sin ajustes) vale lo de siempre.
 */
function ajustes(guildId) {
    const cfg = guildSettings.getSettings(guildId).pase;
    return {
        activo: cfg.activo !== false,
        topes: Object.fromEntries(Object.keys(CATEGORIAS).map((c) => [c, Math.max(0, Number(cfg.topes[c]) || 0)])),
        xpBase: Math.max(1, Number(cfg.xp_nivel_base) || 1),
        xpPaso: Math.max(0, Number(cfg.xp_nivel_paso) || 0),
        canalNivel: cfg.canal_nivel || "",
        objetos: leerObjetos(cfg.objetos),
    };
}

/** La curva de niveles de un servidor, para niveles.js: { xpBase, xpPaso }. */
const curvaDe = (guildId) => {
    const { xpBase, xpPaso } = ajustes(guildId);
    return { xpBase, xpPaso };
};

module.exports = { ajustes, curvaDe, leerObjetos };
