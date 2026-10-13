// Retos a duelo y contra el Duende: aceptar, rechazar o cancelar, rendirse, y jugar cada juego (dados, piedra-papel-tijera y
// blackjack) hasta que se resuelve. Un duelo puede ser a una partida o al mejor de tres (#436).
const db = require("../../core/db");
const bj = require("../blackjack");
const { createLogger } = require("../../core/logger");
const { MAX_RONDAS_PPT, MAX_EMPATES_SERIE, VICTORIAS_SERIE, PPT, DUENDE, SIN_EFECTIVO } = require("./constantes");
const { error, SinEfectivo, esParticipante, jugadaAlAzar, azar } = require("./comun");
const { obtener, guardarDatos, partidoDe } = require("./persistencia");
const { unir, devolver, ganar, cobrarExtra } = require("./cobros");
const { bloqueado } = require("./bloqueos");

const log = createLogger("Retos");

const serieDe = (reto) => (reto.serie === 3 ? 3 : 1);

/** Los datos con los que empieza una partida: lo propio del juego y, si hay serie, lo que se arrastra (marcador, partida, empates). */
function datosDePartida(reto, serie = {}) {
    const base = {
        partida: serie.partida || 1,
        marcador: serie.marcador || { [reto.creador]: 0, [reto.rival]: 0 },
        empatadas: serie.empatadas || 0,
        historial: serie.historial || [],
    };
    if (reto.juego === "ppt") {
        // El Duende (si juega) elige en cuanto empieza la partida.
        const jugadas = esParticipante(reto, DUENDE) ? { [DUENDE]: jugadaAlAzar() } : {};
        return { ...base, ronda: 1, jugadas, empates: [] };
    }
    if (reto.juego === "blackjack") return { ...base, ...repartirBlackjack(reto) };
    return base;
}

/** Empieza el duelo (cuando el rival acepta): los dados se tiran ya; en los demás juegos se prepara la primera partida. */
function empezar(reto) {
    if (reto.juego === "dados") return jugarDados(reto);
    guardarDatos(reto.id, datosDePartida(reto));
    return null;
}

/**
 * Cierra una partida con su resultado (`ganador` y `texto`, o sin ganador: un empate con su `motivo`). En un duelo a una
 * partida cierra el reto: paga al ganador o devuelve. En una serie (#436) suma la victoria y paga el bote de toda la serie
 * al llegar a dos; si no, prepara la siguiente partida. Un empate no suma: la partida se repite, y tres empates seguidos
 * devuelven el reto.
 * @returns {{ sigue: boolean, hecho: object | null }} `sigue`: la serie continúa; `hecho`: lo que devuelve ganar o devolver
 */
function terminarPartida(reto, datos, resultado) {
    if (serieDe(reto) === 1) {
        return {
            sigue: false,
            hecho: resultado.ganador ? ganar(reto.id, [resultado.ganador], resultado.texto) : devolver(reto.id, resultado.motivo),
        };
    }
    const marcador = { ...(datos.marcador || { [reto.creador]: 0, [reto.rival]: 0 }) };
    const historial = [
        ...(datos.historial || []),
        { partida: datos.partida || 1, ganador: resultado.ganador || null, texto: resultado.texto || resultado.motivo },
    ];
    if (!resultado.ganador) {
        const empatadas = (datos.empatadas || 0) + 1;
        if (empatadas >= MAX_EMPATES_SERIE) {
            guardarDatos(reto.id, { ...datos, marcador, historial });
            return { sigue: false, hecho: devolver(reto.id, `${resultado.motivo} (${empatadas} empates seguidos en la serie)`) };
        }
        guardarDatos(reto.id, datosDePartida(reto, { partida: datos.partida, marcador, empatadas, historial }));
        return { sigue: true, hecho: null };
    }
    marcador[resultado.ganador] = (marcador[resultado.ganador] || 0) + 1;
    if (marcador[resultado.ganador] >= VICTORIAS_SERIE) {
        guardarDatos(reto.id, { ...datos, marcador, historial });
        const final = `${resultado.texto} · serie ${marcador[reto.creador]}–${marcador[reto.rival]}`;
        return { sigue: false, hecho: ganar(reto.id, [resultado.ganador], final) };
    }
    guardarDatos(reto.id, datosDePartida(reto, { partida: (datos.partida || 1) + 1, marcador, empatadas: 0, historial }));
    return { sigue: true, hecho: null };
}

/** Lo que pasó en la última partida de una serie que sigue en juego (para decírselo a quien juega), o null. */
function textoUltimaPartida(reto) {
    if (serieDe(reto) !== 3 || reto.estado !== "en_juego") return null;
    const ultima = reto.datos?.historial?.at(-1);
    if (!ultima) return null;
    const m = reto.datos.marcador;
    return `🏁 Partida ${ultima.partida}: ${ultima.ganador ? `gana <@${ultima.ganador}>` : "empate, se repite"} (${ultima.texto}). Marcador ${m[reto.creador]}–${m[reto.rival]}.`;
}

/** El rival acepta: se le cobra y empieza (los dados se tiran en el momento). Si el reto es abierto, quien lo acepta pasa a ser el rival. */
function aceptar(retoId, userId) {
    const reto = obtener(retoId);
    if (!reto || !["partido", "duelo"].includes(reto.tipo)) return error("❌ Ese reto ya no existe.");
    if (reto.estado !== "pendiente") return error("Este reto ya no está pendiente.");
    const abierto = !reto.rival;
    if (abierto && reto.creador === String(userId)) return error("⛔ No puedes aceptar tu propio reto.");
    if (!abierto && reto.rival !== String(userId)) return error("⛔ Este reto no es para ti.");
    if (abierto && bloqueado(reto.creador, userId)) return error("⛔ No puedes aceptar este reto.");
    if (reto.contraoferta) return error("💬 Has propuesto otra cantidad: espera a que quien retó la acepte.");
    if (reto.expira_en && reto.expira_en <= Date.now()) return error("⌛ Este reto ha caducado.");
    const parado = comprobarPartido(reto);
    if (parado) return error(parado);
    try {
        db.transaction(() => {
            // `COALESCE`: en un reto abierto (#438) el rival se fija ahora, con quien lo acepta primero.
            const r = db
                .prepare(
                    "UPDATE retos SET estado = 'en_juego', rival = COALESCE(rival, ?), actualizado_en = ? WHERE id = ? AND estado = 'pendiente'",
                )
                .run(String(userId), Date.now(), reto.id);
            if (r.changes !== 1) throw new Error("carrera");
            const actual = obtener(reto.id);
            if (!unir(actual, userId, actual.tipo === "partido" ? "en_contra" : null)) throw new SinEfectivo();
            empezar(actual);
        })();
    } catch (e) {
        if (e instanceof SinEfectivo) return error(SIN_EFECTIVO);
        if (e.message === "carrera") return error("Este reto ya no está pendiente.");
        throw e;
    }
    log.info(`Reto ${reto.id} aceptado por ${userId}`);
    return { ok: true, reto: obtener(reto.id) };
}

/** Un reto a un partido no se acepta si el partido ya ha empezado: el texto del error, o null. */
function comprobarPartido(reto) {
    if (reto.tipo !== "partido") return null;
    const p = partidoDe(reto.match_id);
    return !p || p.estado !== "abierto" || !(p.start_time > new Date().toISOString()) ? "⏱️ El partido ya ha empezado." : null;
}

/** El rival lo rechaza: se devuelve lo del creador. */
function rechazar(retoId, userId) {
    const reto = obtener(retoId);
    if (!reto || reto.estado !== "pendiente") return error("Este reto ya no está pendiente.");
    if (reto.rival !== String(userId)) return error("⛔ Este reto no es para ti.");
    const r = devolver(reto.id, "rechazado");
    return r ? { ok: true, reto: r.reto } : error("Este reto ya no está pendiente.");
}

/** El creador lo retira antes de que lo acepten. */
function cancelar(retoId, userId) {
    const reto = obtener(retoId);
    if (!reto || reto.estado !== "pendiente") return error("Este reto ya no está pendiente.");
    if (reto.creador !== String(userId)) return error("⛔ Solo quien lanzó el reto puede cancelarlo.");
    const r = devolver(reto.id, "cancelado");
    return r ? { ok: true, reto: r.reto } : error("Este reto ya no está pendiente.");
}

/**
 * Quien participa en un duelo en curso lo da por perdido (#446): el rival cobra el bote de los dos (o de toda la serie, y de
 * lo doblado). Sirve en cualquier duelo `en_juego`; no hay devolución parcial.
 */
function rendirse(retoId, userId) {
    const reto = obtener(retoId);
    if (!reto || reto.tipo !== "duelo") return error("❌ Ese duelo ya no existe.");
    if (reto.estado !== "en_juego") return error("Este duelo ya ha terminado.");
    if (!esParticipante(reto, userId)) return error("⛔ No juegas en este duelo.");
    const rival = reto.participantes.find((p) => p.userId !== String(userId))?.userId;
    const r = ganar(reto.id, [rival], `🏳️ <@${userId}> se ha rendido`);
    return r ? { ok: true, reto: r.reto, pagos: r.pagos } : error("Este duelo ya ha terminado.");
}

// ─── Duelos ──────────────────────────────────────────────────────────────────

function duelo(retoId, userId, juego) {
    const reto = obtener(retoId);
    if (!reto || reto.tipo !== "duelo" || reto.juego !== juego) return { error: error("❌ Ese duelo ya no existe.") };
    if (reto.estado !== "en_juego") return { error: error("Este duelo ya ha terminado.") };
    if (!esParticipante(reto, userId)) return { error: error("⛔ No juegas en este duelo.") };
    return { reto };
}

const tirada = () => [1 + Math.floor(azar() * 6), 1 + Math.floor(azar() * 6)];
const suma = (t) => t[0] + t[1];

/** Una partida de dados: dos dados cada uno; gana la suma más alta y, si empatan, se vuelve a tirar (hasta 10 veces). */
function partidaDeDados(reto) {
    const tiradas = [];
    for (let n = 0; n < 10; n++) {
        const t = { [reto.creador]: tirada(), [reto.rival]: tirada() };
        tiradas.push(t);
        if (suma(t[reto.creador]) !== suma(t[reto.rival])) break;
    }
    const ultima = tiradas.at(-1);
    const a = ultima[reto.creador];
    const b = ultima[reto.rival];
    const texto = `🎲 ${a[0]}+${a[1]} = **${suma(a)}** contra ${b[0]}+${b[1]} = **${suma(b)}**${tiradas.length > 1 ? ` (tras ${tiradas.length - 1} empate${tiradas.length > 2 ? "s" : ""})` : ""}`;
    if (suma(a) === suma(b)) return { tiradas, resultado: { ganador: null, motivo: "empate", texto } };
    return { tiradas, resultado: { ganador: suma(a) > suma(b) ? reto.creador : reto.rival, texto } };
}

/** Dados: se juegan al aceptar. A una partida, gana la suma más alta; en una serie se tiran todas las que hagan falta. */
function jugarDados(reto) {
    let datos = datosDePartida(reto);
    for (let n = 0; n < 4 * MAX_EMPATES_SERIE; n++) {
        const { tiradas, resultado } = partidaDeDados(reto);
        const { sigue, hecho } = terminarPartida(reto, { ...datos, tiradas }, resultado);
        if (!sigue) return hecho;
        datos = obtener(reto.id).datos;
    }
    return devolver(reto.id, "empate");
}

/** Piedra, papel o tijera: cada uno elige en secreto; con las dos jugadas se resuelve. Empate: otra ronda. */
function jugarPpt(retoId, userId, jugada) {
    const { reto, error: e } = duelo(retoId, userId, "ppt");
    if (e) return e;
    if (!PPT[jugada]) return error("❌ Jugada no válida.");
    const datos = reto.datos || datosDePartida(reto);
    if (datos.jugadas[String(userId)]) return error("Ya has elegido en esta ronda: falta el otro.");
    datos.jugadas[String(userId)] = jugada;
    const a = datos.jugadas[reto.creador];
    const b = datos.jugadas[reto.rival];
    if (!a || !b) {
        guardarDatos(reto.id, datos);
        return { ok: true, reto: obtener(reto.id), mensaje: `Has elegido ${PPT[jugada].emoji} **${jugada}**. Falta el otro.` };
    }
    if (a === b) {
        datos.empates.push(a);
        if (datos.empates.length >= MAX_RONDAS_PPT) {
            guardarDatos(reto.id, datos);
            const { hecho } = terminarPartida(reto, datos, { ganador: null, motivo: `empate ${MAX_RONDAS_PPT} veces seguidas` });
            return { ok: true, reto: hecho?.reto || obtener(reto.id), mensaje: textoUltimaPartida(obtener(reto.id)) || undefined };
        }
        datos.jugadas = {};
        // El Duende vuelve a elegir en cuanto empieza la ronda nueva.
        if (esParticipante(reto, DUENDE)) datos.jugadas[DUENDE] = jugadaAlAzar();
        datos.ronda++;
        guardarDatos(reto.id, datos);
        return { ok: true, reto: obtener(reto.id), mensaje: `🤝 Empate a ${PPT[a].emoji}: otra ronda.` };
    }
    guardarDatos(reto.id, datos);
    const ganador = PPT[a].gana_a === b ? reto.creador : reto.rival;
    const { hecho } = terminarPartida(reto, datos, { ganador, texto: `${PPT[a].emoji} ${a} contra ${PPT[b].emoji} ${b}` });
    const actual = hecho?.reto || obtener(reto.id);
    return { ok: true, reto: actual, mensaje: textoUltimaPartida(actual) || undefined };
}

// Blackjack: cada uno juega su mano a la vez y sin ver la del otro (se ve en privado); al terminar los dos, gana
// el que más se acerque a 21 sin pasarse. Sin crupier.
function repartirBlackjack(reto) {
    const baraja = bj.crearBaraja(1);
    const robar = () => bj.sacarCarta(baraja, azar);
    const manos = { [reto.creador]: [robar(), robar()], [reto.rival]: [robar(), robar()] };
    // Con 21 de salida no hay nada que hacer: esa mano ya está plantada.
    const plantados = Object.fromEntries(Object.entries(manos).map(([id, m]) => [id, bj.handValue(m) === 21]));
    return { baraja, manos, plantados };
}

/** Valor de la mano de alguien en un duelo de blackjack. */
function valorMano(reto, userId) {
    return bj.handValue(reto.datos?.manos?.[String(userId)] || []);
}

/** Resuelve la partida de blackjack con las manos que hay. En una serie puede dejar el reto en juego (devuelve null). */
function resolverBlackjack(reto) {
    const { manos } = reto.datos;
    const va = bj.handValue(manos[reto.creador]);
    const vb = bj.handValue(manos[reto.rival]);
    const puntos = (v, mano) => (v > 21 ? -1 : v === 21 && bj.esBlackjack(mano) ? 21.5 : v);
    const pa = puntos(va, manos[reto.creador]);
    const pb = puntos(vb, manos[reto.rival]);
    const txt = (v, mano) => (v > 21 ? `${v} (se pasa)` : bj.esBlackjack(mano) ? "blackjack" : String(v));
    const texto = `🃏 ${txt(va, manos[reto.creador])} contra ${txt(vb, manos[reto.rival])}`;
    const resultado =
        pa === pb
            ? { ganador: null, motivo: va > 21 ? "empate: los dos se pasan" : `empate a ${txt(va, manos[reto.creador])}`, texto }
            : { ganador: pa > pb ? reto.creador : reto.rival, texto };
    return terminarPartida(reto, reto.datos, resultado).hecho;
}

/** Pedir carta (`pedir`), plantarse o doblar (#444). Cuando los dos han terminado, se resuelve la partida. */
function jugarBlackjack(retoId, userId, accion) {
    const { reto, error: e } = duelo(retoId, userId, "blackjack");
    if (e) return e;
    const yo = String(userId);
    const datos = reto.datos;
    if (datos.plantados[yo]) return error("Ya has terminado tu mano: falta el otro.");
    if (accion === "doblar" && datos.manos[yo].length !== 2) return error("Solo puedes doblar con tus dos primeras cartas.");
    return db.transaction(() => {
        if (accion === "doblar") {
            // Se pone otra vez lo mismo, una sola carta más y la mano queda plantada.
            if (!cobrarExtra(reto, yo, reto.cantidad))
                return error(`❌ No te llega el efectivo para doblar (${reto.cantidad.toLocaleString("es")} 🪙).`);
            datos.doblados = { ...datos.doblados, [yo]: true };
            datos.manos[yo].push(bj.sacarCarta(datos.baraja, azar));
            datos.plantados[yo] = true;
        } else if (accion === "pedir") {
            datos.manos[yo].push(bj.sacarCarta(datos.baraja, azar));
            if (bj.handValue(datos.manos[yo]) >= 21) datos.plantados[yo] = true;
        } else {
            datos.plantados[yo] = true;
        }
        guardarDatos(reto.id, datos);
        const actual = obtener(reto.id);
        if (Object.values(datos.plantados).every(Boolean)) {
            const hecho = resolverBlackjack(actual);
            const despues = hecho?.reto || obtener(reto.id);
            return { ok: true, reto: despues, mensaje: textoUltimaPartida(despues) || undefined };
        }
        return { ok: true, reto: actual };
    })();
}

module.exports = {
    aceptar,
    rechazar,
    cancelar,
    rendirse,
    jugarPpt,
    jugarBlackjack,
    valorMano,
    resolverBlackjack,
    empezar,
    comprobarPartido,
    textoUltimaPartida,
};
