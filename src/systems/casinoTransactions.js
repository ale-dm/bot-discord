// Utilidades para transacciones seguras del casino. Se juega con el 💵 efectivo (systems/dinero): la
// columna `enMano` de la tabla banco. Antes se jugaba con el saldo del banco.
const db = require("../core/db");
const dinero = require("./dinero");
const pase = require("./pase/pase");
const { createLogger } = require("../core/logger");

const log = createLogger("Casino");
const guildSettings = require("./guildSettings");
const { validarApuesta, consumirLimites } = require("./casinoLimites");
const { mensajeBloqueo } = require("./casinoAutoexclusion");
const limitePerdidas = require("./limitePerdidas");
const dobleONada = require("./casino/dobleONada");
const eventos = require("./eventos");
const achievements = require("./achievementsSystem");
const { CacheLimitada } = require("../core/cacheLimitada");
const userGuildContext = new CacheLimitada({ max: 5000 });

/**
 * Función para realizar transacciones seguras con rollback automático
 * @param {string} userId - ID del usuario
 * @param {function} operacion - Función que contiene las operaciones de BD
 * @returns {boolean} - true si la transacción fue exitosa
 */
function transaccionSegura(userId, operacion) {
    // Si la operación lanza, db.transaction hace rollback; el error se registra una sola vez, abajo.
    const transaction = db.transaction(() => {
        // `saldo` es el efectivo (con lo que se juega); si no tenía cuenta, se le crea.
        dinero.asegurarCuenta(userId);
        const userBanco = db.prepare("SELECT enMano AS saldo FROM banco WHERE userId = ?").get(userId);

        // Ejecutar la operación
        return operacion(userBanco);
    });

    try {
        return transaction();
    } catch (error) {
        log.error(`Transacción revertida para ${userId}:`, error);
        return false;
    }
}

/**
 * Registrar usuario automáticamente si no existe
 * @param {string} userId - ID del usuario
 * @param {string} nombre - Nombre del usuario
 * @param {string} tag - Tag del usuario
 */
function registrarUsuario(userId, nombre, tag) {
    try {
        // Si ya existía (p. ej. dado de alta automáticamente sin nombre), se completan nombre y tag.
        db.prepare(
            `
            INSERT INTO usuarios (id, nombre, tag, fechaRegistro)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                nombre = COALESCE(usuarios.nombre, excluded.nombre),
                tag = COALESCE(usuarios.tag, excluded.tag)
        `,
        ).run(userId, nombre, tag, new Date().toISOString());
    } catch (error) {
        log.error(`Error registrando usuario ${userId}:`, error);
    }
}

/**
 * Insertar en tabla casino con validación
 * @param {string} userId - ID del usuario
 * @param {string} juego - Nombre del juego
 * @param {number} apuesta - Cantidad apostada
 * @param {number} resultado - Resultado (ganancia/pérdida)
 * @param {object} detalleObj - Detalles del juego
 */
function insertarCasino(userId, juego, apuesta, resultado, detalleObj) {
    try {
        db.prepare(
            `
            INSERT INTO casino (userId, juego, fecha, apuesta, resultado, detalle) 
            VALUES (?, ?, ?, ?, ?, ?)
        `,
        ).run(userId, juego, new Date().toISOString(), apuesta, resultado, JSON.stringify(detalleObj));
        log.info(`Partida registrada: ${userId} - ${juego} - Apuesta: ${apuesta} - Resultado: ${resultado}`);
        pase.registrarEnTodos(userId, "casino");
        // 📋 Encargos (#523): solo cuenta lo ganado, nunca lo apostado.
        if (resultado > 0) require("./encargos").registrarEnTodos(userId, "casino_gana", resultado);
    } catch (error) {
        log.error(`Error insertando en casino:`, error);
        throw error;
    }
}

/**
 * Insertar en historial con validación
 * @param {string} userId - ID del usuario
 * @param {string} descripcion - Descripción de la transacción
 * @param {number} cantidad - Cantidad del movimiento
 */
function insertarHistorial(userId, descripcion, cantidad) {
    try {
        dinero.apuntar(userId, "casino", descripcion, cantidad);
    } catch (error) {
        log.error(`Error insertando en historial:`, error);
        // No lanzar error aquí ya que el historial es secundario
    }
}

const RTP_SETTING_BY_GAME = {
    blackjack: "rtp_blackjack",
    tragaperras: "rtp_tragaperras",
    ruleta: "rtp_ruleta",
    adivinar: "rtp_adivinar",
    rasca: "rtp_rasca",
};

/**
 * Obtiene el RTP configurado (%) para un juego concreto. 100 = sin ajuste.
 * @param {string|null} guildId
 * @param {string} juego
 * @returns {number}
 */
function getRtpForGame(guildId, juego) {
    const settingKey = RTP_SETTING_BY_GAME[juego];
    if (!settingKey) return 100;
    const cfg = guildSettings.getSettings(guildId).casino;
    const rtp = Number(cfg[settingKey]);
    return Number.isFinite(rtp) && rtp >= 0 ? rtp : 100;
}

/**
 * Ajusta una ganancia bruta según el RTP configurado para ese juego y, si está en marcha, el 🎉 fin de semana del
 * casino. Escala solo el premio neto (nunca la apuesta que se devuelve en un empate/push). Llamar ANTES de mostrar el resultado al
 * usuario y antes de procesarGanancia, para que el mensaje mostrado y lo acreditado coincidan siempre.
 * @param {string|null} guildId
 * @param {string} juego
 * @param {number} apuesta
 * @param {number} gananciaTotal - Ganancia bruta (incluye devolución de apuesta)
 * @returns {number} - Ganancia total ya ajustada por RTP
 */
function applyRtp(guildId, juego, apuesta, gananciaTotal) {
    if (!RTP_SETTING_BY_GAME[juego]) return gananciaTotal;
    // El RTP del juego y, en el 🎉 fin de semana del casino (F-EC-02), el % del evento encima.
    const rtpPct = (getRtpForGame(guildId, juego) * eventos.porcentajeCasino(guildId)) / 100;
    if (rtpPct === 100) return gananciaTotal;
    const netWin = Math.max(0, Number(gananciaTotal || 0) - Number(apuesta || 0));
    const netWinAjustado = Math.max(0, Math.floor(netWin * (rtpPct / 100)));
    return Number(apuesta || 0) + netWinAjustado;
}

/** Cobra el impuesto del casino sobre una ganancia neta (si es mayor que cero y el servidor lo tiene activo). Dentro de una transacción. */
function cobrarImpuestoCasino(userId, guildId, gananciaNeta) {
    if (!(gananciaNeta > 0)) return;
    const impuestos = require("./impuestos");
    const impuestoCalc = impuestos.calcularImpuesto(guildId, "casino", gananciaNeta);
    if (!impuestoCalc) return;
    dinero.cobrar(userId, impuestoCalc.impuesto);
    dinero.apuntar(userId, "impuesto", `Impuesto sobre ${dinero.TIPOS.casino}`, -impuestoCalc.impuesto);
    if (impuestoCalc.destino === "bote") impuestos.sumarBote(guildId, impuestoCalc.impuesto);
}

/**
 * Procesar ganancia de forma segura
 * @param {string} userId - ID del usuario
 * @param {string} juego - Nombre del juego
 * @param {number} apuesta - Cantidad apostada
 * @param {number} gananciaTotal - Ganancia total a recibir (incluye devolución de apuesta). Si el juego debe respetar el RTP configurado, pásala ya ajustada con applyRtp().
 * @param {string} descripcion - Descripción para historial
 * @param {object} detalle - Detalles para tabla casino
 * @returns {boolean} - true si fue exitoso
 */
function procesarGanancia(userId, juego, apuesta, gananciaTotal, descripcion, detalle) {
    const guildId = detalle?.guildId || userGuildContext.get(userId) || null;
    const ok = transaccionSegura(userId, (userBanco) => {
        // Actualizar saldo con la ganancia total
        const nuevoSaldo = userBanco.saldo + gananciaTotal;
        db.prepare("UPDATE banco SET enMano = ? WHERE userId = ?").run(nuevoSaldo, userId);

        // Registrar en casino (resultado neto = ganancia total - apuesta)
        const resultadoNeto = gananciaTotal - apuesta;
        insertarCasino(userId, juego, apuesta, resultadoNeto, detalle);

        // Registrar en historial (ganancia neta)
        insertarHistorial(userId, descripcion, resultadoNeto);

        // Impuesto (F-EC-06a): solo sobre la ganancia neta de verdad, nunca sobre la apuesta
        // devuelta (eso ya era suyo, no es un ingreso).
        cobrarImpuestoCasino(userId, guildId, resultadoNeto);

        log.info(
            `Ganancia procesada: ${userId} - ${juego} - Total recibido: ${gananciaTotal} - Ganancia neta: ${resultadoNeto} - Nuevo saldo: ${nuevoSaldo}`,
        );
        return true;
    });
    if (ok) {
        const neto = Math.max(0, Number(gananciaTotal || 0) - Number(apuesta || 0));
        if (neto > 0) {
            dobleONada.ofrecer(userId, juego, neto, { apuesta, guildId });
            void achievements.applyEvent(guildId, userId, "casino_win_count", 1);
            void achievements.applyEvent(guildId, userId, "casino_net_profit", neto);
        }
    }
    return ok;
}

/**
 * Procesar pérdida de forma segura
 * @param {string} userId - ID del usuario
 * @param {string} juego - Nombre del juego
 * @param {number} apuesta - Cantidad apostada
 * @param {string} descripcion - Descripción para historial
 * @param {object} detalle - Detalles para tabla casino
 * @returns {boolean} - true si fue exitoso
 */
function procesarPerdida(userId, juego, apuesta, descripcion, detalle) {
    const guildId = detalle?.guildId || userGuildContext.get(userId) || null;
    const ok = transaccionSegura(userId, (userBanco) => {
        // La apuesta ya fue descontada, solo registrar
        insertarCasino(userId, juego, apuesta, -apuesta, detalle);

        // Registrar en historial
        insertarHistorial(userId, descripcion, -apuesta);

        log.info(`Pérdida procesada: ${userId} - ${juego} - Pérdida: ${apuesta}`);
        return true;
    });
    if (ok) {
        void achievements.applyEvent(guildId, userId, "casino_loss_count", 1);
    }
    return ok;
}

/**
 * Liquida el seguro del blackjack (#333): la apuesta ya está cobrada. Si el crupier tiene blackjack paga 2 a 1 (se devuelve el seguro
 * y dos veces más, con el impuesto del casino sobre lo ganado); si no, se pierde. Va al historial de movimientos, no a las partidas
 * del casino: es parte de la misma mano y no cuenta como una partida más ni para los logros.
 * @returns {{ exito: boolean, neto: number }} el neto del seguro (+2 veces o -1 vez lo apostado)
 */
function procesarSeguro(userId, guildId, seguro, crupierTieneBlackjack) {
    const neto = crupierTieneBlackjack ? seguro * 2 : -seguro;
    const exito = transaccionSegura(userId, () => {
        if (crupierTieneBlackjack) dinero.pagar(userId, seguro * 3);
        insertarHistorial(userId, crupierTieneBlackjack ? "Blackjack: seguro cobrado (2 a 1)" : "Blackjack: seguro perdido", neto);
        cobrarImpuestoCasino(userId, guildId, neto);
        return true;
    });
    return { exito, neto };
}

/**
 * Descontar apuesta de forma segura
 * @param {string} userId - ID del usuario
 * @param {number} cantidad - Cantidad a descontar
 * @param {string|null} guildId
 * @param {string|null} juego - Juego del casino: con tope de apuesta o cooldown propios (#460, #461) se usan esos
 * @returns {object} - {exito: boolean, saldoRestante: number, mensaje: string}
 */
function descontarApuesta(userId, cantidad, guildId = null, juego = null) {
    const resultado = { exito: false, saldoRestante: 0, mensaje: "" };

    // Autoexclusión (#463): no se cobra nada ni se gasta cooldown ni cupo.
    const bloqueo = mensajeBloqueo(userId);
    if (bloqueo) {
        resultado.mensaje = bloqueo;
        return resultado;
    }

    // Límite de pérdidas que se puso la propia persona (#319): tampoco se cobra ni se gasta cooldown ni cupo.
    const tope = limitePerdidas.motivoDeBloqueo(userId, Number(cantidad) || 0);
    if (tope) {
        resultado.mensaje = `🛑 ${tope}`;
        return resultado;
    }

    // Validar ANTES de consumir cooldown/cupo diario: una apuesta rechazada (saldo
    // insuficiente, fuera de mínimo/máximo) no debe contar como jugada.
    const saldoActual = obtenerSaldo(userId);
    const validacionPrevia = validarApuesta(cantidad, saldoActual, guildId, juego);
    if (!validacionPrevia.valida) {
        resultado.mensaje = validacionPrevia.mensaje;
        return resultado;
    }

    const limit = consumirLimites(userId, guildId, juego);
    if (!limit.ok) {
        resultado.mensaje = limit.mensaje;
        return resultado;
    }

    transaccionSegura(userId, () => {
        // Se cobra con saldoGastable (efectivo + dinero negro, F-EC-06b): la validación de
        // arriba ya lo comprobó, pero puede haber cambiado entre medias (otra apuesta a la vez).
        if (!dinero.cobrarCombinado(userId, cantidad)) {
            resultado.mensaje = "❌ No te llega el efectivo para esa apuesta. Saca dinero del banco (💵 Sacar).";
            return false;
        }

        resultado.saldoRestante = dinero.saldoGastable(userId);
        resultado.exito = true;
        log.info(`Apuesta descontada: ${userId} - Cantidad: ${cantidad} - Saldo restante: ${resultado.saldoRestante}`);
        return true;
    });

    if (resultado.exito) {
        if (guildId) userGuildContext.set(userId, guildId);
        dobleONada.cancelar(userId); // una partida nueva retira la oferta de doble o nada de la anterior
        void achievements.applyEvent(guildId, userId, "casino_bet", Number(cantidad || 0));
    }

    return resultado;
}

/**
 * Cobra una apuesta adicional dentro de una partida ya empezada (doblar, separar...).
 * A diferencia de descontarApuesta, no aplica mínimo/máximo ni cooldown/cupo diario:
 * es parte de la misma jugada, no una jugada nueva. Solo exige saldo suficiente.
 * @param {string} userId
 * @param {number} cantidad
 * @param {string|null} guildId
 * @returns {object} - {exito: boolean, saldoRestante: number, mensaje: string}
 */
function descontarExtra(userId, cantidad, guildId = null) {
    const resultado = { exito: false, saldoRestante: 0, mensaje: "" };
    const bloqueo = mensajeBloqueo(userId);
    if (bloqueo) {
        resultado.mensaje = bloqueo;
        return resultado;
    }
    if (!Number.isFinite(cantidad) || cantidad <= 0) {
        resultado.mensaje = "❌ La cantidad debe ser mayor que cero.";
        return resultado;
    }
    transaccionSegura(userId, () => {
        if (!dinero.cobrarCombinado(userId, cantidad)) {
            resultado.mensaje = "❌ No te llega el efectivo para eso. Saca dinero del banco (💵 Sacar).";
            return false;
        }
        resultado.saldoRestante = dinero.saldoGastable(userId);
        resultado.exito = true;
        log.info(`Apuesta extra descontada: ${userId} - Cantidad: ${cantidad} - Saldo restante: ${resultado.saldoRestante}`);
        return true;
    });
    if (resultado.exito) {
        if (guildId) userGuildContext.set(userId, guildId);
        void achievements.applyEvent(guildId, userId, "casino_bet", Number(cantidad || 0));
    }
    return resultado;
}

/**
 * Con lo que alguien puede jugar: efectivo + dinero negro (F-EC-06b, se gasta igual). Si no tenía
 * cuenta, se le crea.
 * @param {string} userId - ID del usuario
 * @returns {number}
 */
function obtenerSaldo(userId) {
    try {
        return dinero.saldoGastable(userId);
    } catch (error) {
        log.error(`Error obteniendo saldo para ${userId}:`, error);
        return 0;
    }
}

module.exports = {
    registrarUsuario,

    validarApuesta,
    procesarGanancia,
    procesarPerdida,
    procesarSeguro,
    descontarApuesta,
    descontarExtra,
    obtenerSaldo,
    applyRtp,
};
