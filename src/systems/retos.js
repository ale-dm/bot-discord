// ⚔️ Retos entre jugadores, sin nada de Discord. Tres tipos que comparten lo mismo: cobrar del 💵 efectivo al
// entrar, guardar el dinero hasta que se resuelve (retos_participantes) y después pagar o devolver.
// - partido: "te apuesto 500 a que gana el Betis". El rival va con lo contrario; se resuelve con la liquidación
//   de apuestas (systems/apuestas/liquidacion), cuando se conoce el resultado.
// - duelo: piedra-papel-tijera, dados o blackjack entre dos. La partida se guarda en `datos` (no en memoria): un
//   reinicio no la pierde.
// - porra: una pregunta con opciones ("¿llegará Jorge tarde?"); cualquiera entra con la misma cantidad y un admin
//   decide qué opción gana. El bote se reparte entre los que acertaron.
// El bot no se queda nada: el ganador se lleva todo lo apostado. Los botones y mensajes están en
// juegos/retos/retos.js y paneles/retos.js.
// Contra el Duende (F-DU-03, #14): piedra-papel-tijera o un partido, que él propone desde el chat y empiezan cuando la
// persona acepta (crearContraDuende). El Duende es un participante más (DUENDE) pero, como la banca del casino, sin
// dinero: no se le cobra al entrar y no se le paga si gana, así que si pierde su parte del premio se crea.

// La fachada de retos: reexporta lo que usan los paneles, los juegos, las herramientas del Duende y la liquidación.
// Las reglas están en src/systems/retos/ (constantes, comun, persistencia, cobros, partidos, crear, duelos, porras,
// revision).
const constantes = require("./retos/constantes");
const comun = require("./retos/comun");
const persistencia = require("./retos/persistencia");
const partidos = require("./retos/partidos");
const crear = require("./retos/crear");
const duelos = require("./retos/duelos");
const porras = require("./retos/porras");
const revision = require("./retos/revision");

module.exports = {
    MIN: constantes.MIN,
    MAX: constantes.MAX,
    MAX_PENDIENTES: constantes.MAX_PENDIENTES,

    ABANDONO_MS: constantes.ABANDONO_MS,
    PORRA_DIAS: constantes.PORRA_DIAS,
    PORRA_MAX_OPCIONES: constantes.PORRA_MAX_OPCIONES,
    JUEGOS: constantes.JUEGOS,
    PPT: constantes.PPT,

    DUENDE: constantes.DUENDE,

    buscarPartido: partidos.buscarPartido,
    eleccionPara: partidos.eleccionPara,
    motivoNoContraDuende: crear.motivoNoContraDuende,
    crearContraDuende: crear.crearContraDuende,
    obtener: persistencia.obtener,
    partidoDe: persistencia.partidoDe,
    partidosParaRetar: persistencia.partidosParaRetar,
    descripcion: comun.descripcion,
    esParticipante: comun.esParticipante,
    crearPartido: crear.crearPartido,
    crearDuelo: crear.crearDuelo,
    crearPorra: crear.crearPorra,
    leerOpciones: crear.leerOpciones,
    guardarMensaje: persistencia.guardarMensaje,
    aceptar: duelos.aceptar,
    rechazar: duelos.rechazar,
    cancelar: duelos.cancelar,
    jugarPpt: duelos.jugarPpt,
    jugarBlackjack: duelos.jugarBlackjack,
    valorMano: duelos.valorMano,
    entrarPorra: porras.entrarPorra,
    cerrarPorra: porras.cerrarPorra,
    resolverPorra: porras.resolverPorra,
    anularPorra: porras.anularPorra,
    resolverPartido: partidos.resolverPartido,
    devolverPorPartido: partidos.devolverPorPartido,
    revisar: revision.revisar,
    deUsuario: persistencia.deUsuario,
    estadisticas: persistencia.estadisticas,
    // Para tests: dados y cartas predecibles.
    __test: {
        setRng: comun.fijarAzar,
    },
};
