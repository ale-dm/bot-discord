// 🍿 Reseñas de Plex: el núcleo (guardar, media, rankings y privacidad). Las pantallas y el DM llegan en #566 y #567.
// Partido en systems/plexResenas/; esta fachada reexporta lo que usa el resto.
const { MAX_TEXTO, NOTA_MIN, NOTA_MAX, TIPOS, estrellasTexto, clavePeli, claveSerie, claveDe, notaValida } = require("./plexResenas/base");
const { guardar, borrar, de, haVisto } = require("./plexResenas/guardar");
const {
    resumen,
    titulo,
    deUsuario,
    publicasDe,
    titulosLlamados,
    mejores,
    ultimas,
    rankingValoradores,
    generosidad,
} = require("./plexResenas/consultas");
const { oculto, setOculto } = require("./plexResenas/privacidad");

module.exports = {
    MAX_TEXTO,
    NOTA_MIN,
    NOTA_MAX,
    TIPOS,
    estrellasTexto,
    clavePeli,
    claveSerie,
    claveDe,
    notaValida,
    guardar,
    borrar,
    de,
    haVisto,
    resumen,
    titulo,
    deUsuario,
    publicasDe,
    titulosLlamados,
    mejores,
    ultimas,
    rankingValoradores,
    generosidad,
    oculto,
    setOculto,
};
