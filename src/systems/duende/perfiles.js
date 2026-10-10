// Personalidades del Duende, perfiles de personas (descripción escrita a mano + notas de
// /duende recuerda) y personalidad asignada a cada canal. En la BD (migración 008).
//
// Un perfil se identifica por Discord ID. Los importados del JSON antiguo solo tenían username:
// se vinculan a su ID en cuanto se sabe quién es (al arrancar con vincularPerfiles, o cuando esa
// persona habla con perfilDe), y desde entonces cambiar de username ya no le hace perder nada.
//
// Las piezas están en systems/duende/perfiles/; este fichero reexporta lo que usa el resto.
const personalidades = require("./perfiles/personalidades");
const lectura = require("./perfiles/lectura");
const escritura = require("./perfiles/escritura");
const notas = require("./perfiles/notas");
const importacion = require("./perfiles/importacion");

module.exports = {
    MAX_NOTAS: lectura.MAX_NOTAS,
    MAX_PERFIL_PROMPT: lectura.MAX_PERFIL_PROMPT,
    instruccionDefault: personalidades.instruccionDefault,
    listarPersonalidades: personalidades.listarPersonalidades,
    obtenerPersonalidad: personalidades.obtenerPersonalidad,
    guardarPersonalidad: personalidades.guardarPersonalidad,
    borrarPersonalidad: personalidades.borrarPersonalidad,
    personalidadDeCanal: personalidades.personalidadDeCanal,
    asignarPersonalidadCanal: personalidades.asignarPersonalidadCanal,
    listarPerfiles: lectura.listarPerfiles,
    perfilDe: lectura.perfilDe,
    perfilPorDiscordId: lectura.perfilPorDiscordId,
    perfilPorId: lectura.perfilPorId,
    asegurarPerfil: lectura.asegurarPerfil,
    actualizarPerfil: escritura.actualizarPerfil,
    borrarNotasPorId: escritura.borrarNotasPorId,
    borrarPerfilPorId: escritura.borrarPerfilPorId,
    anotar: escritura.anotar,
    olvidarNotas: escritura.olvidarNotas,
    notasRelevantes: notas.notasRelevantes,
    guardarDescripcion: escritura.guardarDescripcion,

    vincularPerfiles: lectura.vincularPerfiles,
    importarJsonSiExiste: importacion.importarJsonSiExiste,
};
