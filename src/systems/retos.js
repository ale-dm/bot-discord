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
const db = require("../core/db");
const dinero = require("./dinero");
const bj = require("./blackjack");
const { createLogger } = require("../core/logger");

const log = createLogger("Retos");

const MIN = 10;
const MAX = 100_000;
/** Retos sin aceptar que puede tener abiertos una persona a la vez. */
const MAX_PENDIENTES = 5;
/** Tiempo para aceptar un reto (en los de partido, como mucho hasta que empieza). */
const ESPERA_ACEPTAR_MS = 24 * 3600 * 1000;
/** Un duelo sin tocar este tiempo se da por abandonado. */
const ABANDONO_MS = 15 * 60 * 1000;
/** Una porra sin resolver en este tiempo se devuelve. */
const PORRA_DIAS = 30;
const PORRA_MAX_OPCIONES = 5;
const PORRA_MAX_LARGO_OPCION = 40;
const MAX_RONDAS_PPT = 5;

const JUEGOS = {
    ppt: { emoji: "🪨", nombre: "Piedra, papel o tijera" },
    dados: { emoji: "🎲", nombre: "Dados" },
    blackjack: { emoji: "🃏", nombre: "Blackjack" },
};
const PPT = {
    piedra: { emoji: "🪨", gana_a: "tijera" },
    papel: { emoji: "📄", gana_a: "piedra" },
    tijera: { emoji: "✂️", gana_a: "papel" },
};
const ELECCIONES = ["home", "draw", "away"];
const FINALES = ["resuelto", "devuelto"];
const SIN_EFECTIVO = "❌ No te llega el efectivo. Saca dinero del banco en `/perfil` → 💰 Economía → 💵 Sacar.";

let rng = Math.random;

class SinEfectivo extends Error {}

const error = (mensaje) => ({ ok: false, mensaje });
const corto = (texto, max) => (texto.length > max ? `${texto.slice(0, max - 1)}…` : texto);

// ─── Lectura ─────────────────────────────────────────────────────────────────

/** Un reto con sus participantes, y `opciones` y `datos` ya leídos del JSON. null si no existe. */
function obtener(id) {
    const r = db.prepare("SELECT * FROM retos WHERE id = ?").get(Number(id));
    if (!r) return null;
    return {
        ...r,
        opciones: r.opciones ? JSON.parse(r.opciones) : null,
        datos: r.datos ? JSON.parse(r.datos) : null,
        participantes: db.prepare("SELECT * FROM retos_participantes WHERE reto_id = ? ORDER BY unido_en, rowid").all(r.id),
    };
}

const partidoDe = (matchId) => db.prepare("SELECT * FROM apuestas_partidos WHERE match_id = ?").get(matchId);

/** Los próximos partidos abiertos (de cualquier competición), para elegir uno al retar. */
function partidosParaRetar(limite = 25) {
    return db
        .prepare("SELECT * FROM apuestas_partidos WHERE estado = 'abierto' AND start_time > ? ORDER BY start_time LIMIT ?")
        .all(new Date().toISOString(), limite);
}

/** "Betis vs Sevilla", "duelo de Dados" o 'porra "¿llegará Jorge tarde?"': para el historial y los DMs. */
function descripcion(reto) {
    if (reto.tipo === "partido") {
        const p = partidoDe(reto.match_id);
        return p ? `${p.home_team} vs ${p.away_team}` : "un partido";
    }
    if (reto.tipo === "duelo") return `duelo de ${JUEGOS[reto.juego]?.nombre || reto.juego}`;
    return `porra "${corto(reto.pregunta || "", 60)}"`;
}

const esParticipante = (reto, userId) => reto.participantes.some((p) => p.userId === String(userId));

// ─── Dinero ──────────────────────────────────────────────────────────────────

function validarCantidad(cantidad) {
    if (!Number.isInteger(cantidad) || cantidad < MIN || cantidad > MAX) {
        return `❌ La cantidad tiene que ser un número entero entre ${MIN} y ${MAX.toLocaleString("es")}.`;
    }
    return null;
}

/** Cobra la entrada y apunta a alguien en el reto. Va dentro de una transacción. @returns {boolean} */
function unir(reto, userId, opcion = null) {
    if (!dinero.cobrar(userId, reto.cantidad)) return false;
    db.prepare("INSERT INTO retos_participantes (reto_id, userId, opcion, cantidad, unido_en) VALUES (?, ?, ?, ?, ?)").run(
        reto.id,
        String(userId),
        opcion,
        reto.cantidad,
        Date.now(),
    );
    dinero.apuntar(userId, "retos", `Reto: ${descripcion(reto)}`, -reto.cantidad);
    return true;
}

/**
 * Cierra un reto que sigue abierto, con lo que recibe cada participante (`premios`: userId → monedas). Si ya estaba
 * cerrado (dos clics a la vez, el cron y un botón...) no hace nada y devuelve null.
 * @returns {{ reto: object, pagos: Array<{userId, premio, descripcion, reembolso}> } | null}
 */
function cerrar(retoId, premios, estado, resultado) {
    return db.transaction(() => {
        const ahora = Date.now();
        const r = db
            .prepare(
                "UPDATE retos SET estado = ?, resultado = ?, resuelto_en = ?, actualizado_en = ? WHERE id = ? AND estado NOT IN ('resuelto', 'devuelto')",
            )
            .run(estado, resultado, ahora, ahora, retoId);
        if (r.changes !== 1) return null;
        const reto = obtener(retoId);
        const desc = descripcion(reto);
        const reembolso = estado === "devuelto";
        const pagos = [];
        for (const p of reto.participantes) {
            const premio = premios[p.userId] || 0;
            db.prepare("UPDATE retos_participantes SET premio = ? WHERE reto_id = ? AND userId = ?").run(premio, retoId, p.userId);
            if (premio <= 0) continue;
            dinero.pagar(p.userId, premio);
            dinero.apuntar(p.userId, "retos", reembolso ? `Reto devuelto: ${desc} (${resultado})` : `Reto ganado: ${desc}`, premio);
            pagos.push({
                userId: p.userId,
                premio,
                descripcion: reembolso ? `Reembolso: ${desc}, ${resultado}` : `reto: ${desc}`,
                reembolso,
            });
        }
        log.info(
            `Reto ${retoId} (${reto.tipo}) ${estado}: ${resultado} · ${pagos.map((p) => `${p.userId} +${p.premio}`).join(", ") || "sin pagos"}`,
        );
        return { reto: obtener(retoId), pagos };
    })();
}

/** Devuelve a cada participante lo que puso. */
function devolver(retoId, motivo) {
    const reto = obtener(retoId);
    if (!reto) return null;
    return cerrar(retoId, Object.fromEntries(reto.participantes.map((p) => [p.userId, p.cantidad])), "devuelto", motivo);
}

/** Reparte todo el bote entre `ganadores` (a partes iguales; lo que sobra de la división, al primero). */
function ganar(retoId, ganadores, resultado) {
    const reto = obtener(retoId);
    if (!reto || !ganadores.length) return null;
    const bote = reto.participantes.reduce((s, p) => s + p.cantidad, 0);
    const parte = Math.floor(bote / ganadores.length);
    const premios = Object.fromEntries(ganadores.map((id, n) => [String(id), parte + (n === 0 ? bote - parte * ganadores.length : 0)]));
    return cerrar(retoId, premios, "resuelto", resultado);
}

// ─── Crear ───────────────────────────────────────────────────────────────────

function insertar(campos, opcionCreador) {
    try {
        const reto = db.transaction(() => {
            const ahora = Date.now();
            const info = db
                .prepare(
                    `INSERT INTO retos (tipo, estado, creador, rival, cantidad, guildId, channelId, match_id, eleccion, juego, pregunta, opciones,
                                        creado_en, actualizado_en, expira_en)
                     VALUES (@tipo, @estado, @creador, @rival, @cantidad, @guildId, @channelId, @match_id, @eleccion, @juego, @pregunta, @opciones,
                             @ahora, @ahora, @expira_en)`,
                )
                .run({
                    guildId: null,
                    channelId: null,
                    match_id: null,
                    eleccion: null,
                    juego: null,
                    pregunta: null,
                    opciones: null,
                    ...campos,
                    creador: String(campos.creador),
                    rival: campos.rival ? String(campos.rival) : null,
                    ahora,
                });
            const nuevo = obtener(info.lastInsertRowid);
            if (opcionCreador !== undefined && !unir(nuevo, campos.creador, opcionCreador)) throw new SinEfectivo();
            return obtener(nuevo.id);
        })();
        log.info(`Reto ${reto.id} creado (${reto.tipo}) por ${reto.creador}${reto.rival ? ` contra ${reto.rival}` : ""}: ${reto.cantidad}`);
        return { ok: true, reto };
    } catch (e) {
        if (e instanceof SinEfectivo) return error(SIN_EFECTIVO);
        throw e;
    }
}

function validarDuelo(creador, rival, cantidad) {
    if (!rival) return "❌ Elige a quién retas.";
    if (String(rival) === String(creador)) return "❌ No puedes retarte a ti mismo.";
    const n = db.prepare("SELECT COUNT(*) AS n FROM retos WHERE creador = ? AND estado = 'pendiente'").get(String(creador)).n;
    if (n >= MAX_PENDIENTES) return `❌ Ya tienes ${n} retos sin aceptar: espera a que respondan o cancela alguno.`;
    return validarCantidad(cantidad);
}

/** Apuesta 1 contra 1 a un partido: el creador va con `eleccion` (home/draw/away) y el rival con lo contrario. */
function crearPartido({ creador, rival, matchId, eleccion, cantidad, guildId = null, channelId = null }) {
    const invalido = validarDuelo(creador, rival, cantidad);
    if (invalido) return error(invalido);
    if (!ELECCIONES.includes(eleccion)) return error("❌ Elige un resultado.");
    const p = partidoDe(matchId);
    if (!p) return error("❌ No encuentro ese partido.");
    if (p.estado !== "abierto" || !(p.start_time > new Date().toISOString())) return error("⏱️ Ese partido ya ha empezado.");
    const expira = Math.min(Date.now() + ESPERA_ACEPTAR_MS, Date.parse(p.start_time));
    return insertar(
        {
            tipo: "partido",
            estado: "pendiente",
            creador,
            rival,
            cantidad,
            guildId,
            channelId,
            match_id: matchId,
            eleccion,
            expira_en: expira,
        },
        "a_favor",
    );
}

/** Duelo de casino (ppt, dados o blackjack) contra otra persona. */
function crearDuelo({ creador, rival, juego, cantidad, guildId = null, channelId = null }) {
    const invalido = validarDuelo(creador, rival, cantidad);
    if (invalido) return error(invalido);
    if (!JUEGOS[juego]) return error("❌ Ese juego no existe.");
    return insertar(
        {
            tipo: "duelo",
            estado: "pendiente",
            creador,
            rival,
            cantidad,
            guildId,
            channelId,
            juego,
            expira_en: Date.now() + ESPERA_ACEPTAR_MS,
        },
        null,
    );
}

/** Opciones de una porra a partir de lo escrito en el formulario (una por línea o separadas por comas). */
function leerOpciones(texto) {
    const opciones = String(texto || "")
        .split(/[\n,]/)
        .map((o) => o.trim())
        .filter(Boolean);
    return opciones.length ? opciones : ["Sí", "No"];
}

/** Porra: cualquiera entra con `cantidad` eligiendo una opción, y un admin decide cuál gana. */
function crearPorra({ creador, pregunta, opciones, cantidad, guildId = null, channelId = null }) {
    const texto = String(pregunta || "").trim();
    if (texto.length < 3 || texto.length > 200) return error("❌ La pregunta tiene que tener entre 3 y 200 caracteres.");
    if (opciones.length < 2 || opciones.length > PORRA_MAX_OPCIONES) {
        return error(`❌ Pon entre 2 y ${PORRA_MAX_OPCIONES} opciones.`);
    }
    if (opciones.some((o) => o.length > PORRA_MAX_LARGO_OPCION)) {
        return error(`❌ Cada opción puede tener como mucho ${PORRA_MAX_LARGO_OPCION} caracteres.`);
    }
    if (new Set(opciones.map((o) => o.toLowerCase())).size !== opciones.length) return error("❌ Hay opciones repetidas.");
    const invalida = validarCantidad(cantidad);
    if (invalida) return error(invalida);
    return insertar({
        tipo: "porra",
        estado: "abierta",
        creador,
        cantidad,
        guildId,
        channelId,
        pregunta: texto,
        opciones: JSON.stringify(opciones),
        expira_en: Date.now() + PORRA_DIAS * 24 * 3600 * 1000,
    });
}

/** El mensaje público donde está el reto, para poder editarlo cuando cambie. */
function guardarMensaje(retoId, channelId, messageId) {
    db.prepare("UPDATE retos SET channelId = ?, messageId = ? WHERE id = ?").run(channelId, messageId, retoId);
}

// ─── Aceptar, rechazar, cancelar ─────────────────────────────────────────────

function guardarDatos(retoId, datos) {
    db.prepare("UPDATE retos SET datos = ?, actualizado_en = ? WHERE id = ?").run(JSON.stringify(datos), Date.now(), retoId);
}

/** El rival acepta: se le cobra y empieza (los dados se tiran en el momento). */
function aceptar(retoId, userId) {
    const reto = obtener(retoId);
    if (!reto || !["partido", "duelo"].includes(reto.tipo)) return error("❌ Ese reto ya no existe.");
    if (reto.estado !== "pendiente") return error("Este reto ya no está pendiente.");
    if (reto.rival !== String(userId)) return error("⛔ Este reto no es para ti.");
    if (reto.expira_en && reto.expira_en <= Date.now()) return error("⌛ Este reto ha caducado.");
    if (reto.tipo === "partido") {
        const p = partidoDe(reto.match_id);
        if (!p || p.estado !== "abierto" || !(p.start_time > new Date().toISOString())) return error("⏱️ El partido ya ha empezado.");
    }
    try {
        db.transaction(() => {
            const r = db
                .prepare("UPDATE retos SET estado = 'en_juego', actualizado_en = ? WHERE id = ? AND estado = 'pendiente'")
                .run(Date.now(), reto.id);
            if (r.changes !== 1) throw new Error("carrera");
            if (!unir(reto, userId, reto.tipo === "partido" ? "en_contra" : null)) throw new SinEfectivo();
            if (reto.juego === "ppt") guardarDatos(reto.id, { ronda: 1, jugadas: {}, empates: [] });
            if (reto.juego === "blackjack") guardarDatos(reto.id, repartirBlackjack(reto));
            if (reto.juego === "dados") jugarDados(reto);
        })();
    } catch (e) {
        if (e instanceof SinEfectivo) return error(SIN_EFECTIVO);
        if (e.message === "carrera") return error("Este reto ya no está pendiente.");
        throw e;
    }
    log.info(`Reto ${reto.id} aceptado por ${userId}`);
    return { ok: true, reto: obtener(reto.id) };
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

// ─── Duelos ──────────────────────────────────────────────────────────────────

function duelo(retoId, userId, juego) {
    const reto = obtener(retoId);
    if (!reto || reto.tipo !== "duelo" || reto.juego !== juego) return { error: error("❌ Ese duelo ya no existe.") };
    if (reto.estado !== "en_juego") return { error: error("Este duelo ya ha terminado.") };
    if (!esParticipante(reto, userId)) return { error: error("⛔ No juegas en este duelo.") };
    return { reto };
}

const tirada = () => [1 + Math.floor(rng() * 6), 1 + Math.floor(rng() * 6)];
const suma = (t) => t[0] + t[1];

/** Dos dados cada uno; gana la suma más alta y, si empatan, se vuelve a tirar. */
function jugarDados(reto) {
    const tiradas = [];
    for (let n = 0; n < 10; n++) {
        const t = { [reto.creador]: tirada(), [reto.rival]: tirada() };
        tiradas.push(t);
        if (suma(t[reto.creador]) !== suma(t[reto.rival])) break;
    }
    guardarDatos(reto.id, { tiradas });
    const ultima = tiradas.at(-1);
    const a = ultima[reto.creador];
    const b = ultima[reto.rival];
    const texto = `🎲 ${a[0]}+${a[1]} = **${suma(a)}** contra ${b[0]}+${b[1]} = **${suma(b)}**${tiradas.length > 1 ? ` (tras ${tiradas.length - 1} empate${tiradas.length > 2 ? "s" : ""})` : ""}`;
    if (suma(a) === suma(b)) return devolver(reto.id, "empate");
    return ganar(reto.id, [suma(a) > suma(b) ? reto.creador : reto.rival], texto);
}

/** Piedra, papel o tijera: cada uno elige en secreto; con las dos jugadas se resuelve. Empate: otra ronda. */
function jugarPpt(retoId, userId, jugada) {
    const { reto, error: e } = duelo(retoId, userId, "ppt");
    if (e) return e;
    if (!PPT[jugada]) return error("❌ Jugada no válida.");
    const datos = reto.datos || { ronda: 1, jugadas: {}, empates: [] };
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
            const r = devolver(reto.id, `empate ${MAX_RONDAS_PPT} veces seguidas`);
            return { ok: true, reto: r?.reto || obtener(reto.id) };
        }
        datos.jugadas = {};
        datos.ronda++;
        guardarDatos(reto.id, datos);
        return { ok: true, reto: obtener(reto.id), mensaje: `🤝 Empate a ${PPT[a].emoji}: otra ronda.` };
    }
    guardarDatos(reto.id, datos);
    const ganador = PPT[a].gana_a === b ? reto.creador : reto.rival;
    const r = ganar(reto.id, [ganador], `${PPT[a].emoji} ${a} contra ${PPT[b].emoji} ${b}`);
    return { ok: true, reto: r?.reto || obtener(reto.id) };
}

// Blackjack: cada uno juega su mano a la vez y sin ver la del otro (se ve en privado); al terminar los dos, gana
// el que más se acerque a 21 sin pasarse. Sin crupier.
function repartirBlackjack(reto) {
    const baraja = bj.crearBaraja(1);
    const robar = () => bj.sacarCarta(baraja, rng);
    const manos = { [reto.creador]: [robar(), robar()], [reto.rival]: [robar(), robar()] };
    // Con 21 de salida no hay nada que hacer: esa mano ya está plantada.
    const plantados = Object.fromEntries(Object.entries(manos).map(([id, m]) => [id, bj.handValue(m) === 21]));
    return { baraja, manos, plantados };
}

/** Valor de la mano de alguien en un duelo de blackjack. */
function valorMano(reto, userId) {
    return bj.handValue(reto.datos?.manos?.[String(userId)] || []);
}

function resolverBlackjack(reto) {
    const { manos } = reto.datos;
    const va = bj.handValue(manos[reto.creador]);
    const vb = bj.handValue(manos[reto.rival]);
    const puntos = (v, mano) => (v > 21 ? -1 : v === 21 && bj.esBlackjack(mano) ? 21.5 : v);
    const pa = puntos(va, manos[reto.creador]);
    const pb = puntos(vb, manos[reto.rival]);
    const txt = (v, mano) => (v > 21 ? `${v} (se pasa)` : bj.esBlackjack(mano) ? "blackjack" : String(v));
    const texto = `🃏 ${txt(va, manos[reto.creador])} contra ${txt(vb, manos[reto.rival])}`;
    if (pa === pb) return devolver(reto.id, va > 21 ? "empate: los dos se pasan" : `empate a ${txt(va, manos[reto.creador])}`);
    return ganar(reto.id, [pa > pb ? reto.creador : reto.rival], texto);
}

/** Pedir carta (`pedir`) o plantarse. Cuando los dos han terminado, se resuelve. */
function jugarBlackjack(retoId, userId, accion) {
    const { reto, error: e } = duelo(retoId, userId, "blackjack");
    if (e) return e;
    const yo = String(userId);
    const datos = reto.datos;
    if (datos.plantados[yo]) return error("Ya has terminado tu mano: falta el otro.");
    if (accion === "pedir") {
        datos.manos[yo].push(bj.sacarCarta(datos.baraja, rng));
        if (bj.handValue(datos.manos[yo]) >= 21) datos.plantados[yo] = true;
    } else {
        datos.plantados[yo] = true;
    }
    return db.transaction(() => {
        guardarDatos(reto.id, datos);
        const actual = obtener(reto.id);
        if (Object.values(datos.plantados).every(Boolean)) {
            const r = resolverBlackjack(actual);
            return { ok: true, reto: r?.reto || obtener(reto.id) };
        }
        return { ok: true, reto: actual };
    })();
}

// ─── Porras ──────────────────────────────────────────────────────────────────

function porra(retoId) {
    const reto = obtener(retoId);
    return reto && reto.tipo === "porra" ? reto : null;
}

/** Entrar en la porra con la opción `indice`. Una vez dentro no se cambia. */
function entrarPorra(retoId, userId, indice) {
    const reto = porra(retoId);
    if (!reto) return error("❌ Esa porra ya no existe.");
    if (reto.estado !== "abierta") return error("🔒 Esta porra ya no admite apuestas.");
    if (!reto.opciones[indice]) return error("❌ Esa opción no existe.");
    const yaDentro = reto.participantes.find((p) => p.userId === String(userId));
    if (yaDentro) return error(`Ya estás dentro: vas con **${reto.opciones[Number(yaDentro.opcion)]}**.`);
    try {
        db.transaction(() => {
            if (!unir(reto, userId, String(indice))) throw new SinEfectivo();
            db.prepare("UPDATE retos SET actualizado_en = ? WHERE id = ?").run(Date.now(), reto.id);
        })();
    } catch (e) {
        if (e instanceof SinEfectivo) return error(SIN_EFECTIVO);
        throw e;
    }
    return {
        ok: true,
        reto: obtener(reto.id),
        mensaje: `✅ Vas con **${reto.opciones[indice]}** (${reto.cantidad.toLocaleString("es")} 🪙).`,
    };
}

/** No se admiten más apuestas (quien la creó o un admin). */
function cerrarPorra(retoId, userId, esAdmin) {
    const reto = porra(retoId);
    if (!reto || reto.estado !== "abierta") return error("Esta porra ya no está abierta.");
    if (reto.creador !== String(userId) && !esAdmin) return error("⛔ Solo quien creó la porra o un admin pueden cerrarla.");
    db.prepare("UPDATE retos SET estado = 'cerrada', actualizado_en = ? WHERE id = ? AND estado = 'abierta'").run(Date.now(), reto.id);
    return { ok: true, reto: obtener(reto.id) };
}

/** Un admin dice qué opción ha ganado: el bote, entre los que la eligieron (si nadie la eligió, se devuelve). */
function resolverPorra(retoId, indice, esAdmin) {
    const reto = porra(retoId);
    if (!reto || !["abierta", "cerrada"].includes(reto.estado)) return error("Esta porra ya está resuelta.");
    if (!esAdmin) return error("⛔ Solo un admin puede decidir el resultado.");
    const opcion = reto.opciones[indice];
    if (!opcion) return error("❌ Esa opción no existe.");
    const ganadores = reto.participantes.filter((p) => p.opcion === String(indice)).map((p) => p.userId);
    const r = ganadores.length
        ? ganar(reto.id, ganadores, `ganó «${opcion}»`)
        : devolver(reto.id, reto.participantes.length ? `ganó «${opcion}» y nadie la eligió` : "sin participantes");
    return r ? { ok: true, reto: r.reto, pagos: r.pagos } : error("Esta porra ya está resuelta.");
}

/** Anular y devolverlo todo: un admin, o quien la creó si nadie más ha entrado. */
function anularPorra(retoId, userId, esAdmin) {
    const reto = porra(retoId);
    if (!reto || !["abierta", "cerrada"].includes(reto.estado)) return error("Esta porra ya está resuelta.");
    const soloSuya = reto.participantes.every((p) => p.userId === reto.creador);
    if (!esAdmin && !(reto.creador === String(userId) && soloSuya)) {
        return error("⛔ Solo un admin puede anularla (o quien la creó, si no ha entrado nadie más).");
    }
    const r = devolver(reto.id, "anulada");
    return r ? { ok: true, reto: r.reto, pagos: r.pagos } : error("Esta porra ya está resuelta.");
}

// ─── Partidos (desde la liquidación de apuestas) ─────────────────────────────

/**
 * Resuelve los retos de un partido terminado (`resultado`: home/draw/away). Se llama dentro de la transacción que
 * cierra el partido. Los que nadie aceptó se devuelven.
 * @returns {{ cerrados: object[], pagos: object[] }}
 */
function resolverPartido(matchId, resultado, marcador) {
    const p = partidoDe(matchId);
    const cerrados = [];
    const pagos = [];
    const retos = db
        .prepare(
            "SELECT id, estado, eleccion, creador, rival FROM retos WHERE tipo = 'partido' AND match_id = ? AND estado IN ('pendiente', 'en_juego')",
        )
        .all(matchId);
    for (const r of retos) {
        const hecho =
            r.estado === "pendiente"
                ? devolver(r.id, "nadie lo aceptó antes del partido")
                : ganar(r.id, [r.eleccion === resultado ? r.creador : r.rival], p ? `${p.home_team} ${marcador} ${p.away_team}` : marcador);
        if (!hecho) continue;
        cerrados.push(hecho.reto);
        pagos.push(...hecho.pagos);
    }
    return { cerrados, pagos };
}

/** Devuelve los retos de un partido que se ha quedado sin resultado. */
function devolverPorPartido(matchId, motivo) {
    const cerrados = [];
    const pagos = [];
    for (const r of db
        .prepare("SELECT id FROM retos WHERE tipo = 'partido' AND match_id = ? AND estado IN ('pendiente', 'en_juego')")
        .all(matchId)) {
        const hecho = devolver(r.id, motivo);
        if (!hecho) continue;
        cerrados.push(hecho.reto);
        pagos.push(...hecho.pagos);
    }
    return { cerrados, pagos };
}

// ─── Revisión periódica ──────────────────────────────────────────────────────

/**
 * Lo que se ha quedado colgado (cron cada 5 min): retos que nadie aceptó a tiempo (se devuelven), duelos
 * abandonados (en el blackjack se planta a quien no terminó y se resuelve; en piedra-papel-tijera se devuelve) y
 * porras sin resolver en PORRA_DIAS días (se devuelven).
 * @returns {{ cerrados: object[], pagos: object[] }}
 */
function revisar(ahora = Date.now()) {
    const cerrados = [];
    const pagos = [];
    const apuntar = (hecho) => {
        if (!hecho) return;
        cerrados.push(hecho.reto);
        pagos.push(...hecho.pagos);
    };
    // También los de un partido que ya ha empezado aunque no hayan caducado (la hora del partido puede cambiar).
    const sinAceptar = db
        .prepare(
            `SELECT id FROM retos WHERE estado = 'pendiente' AND expira_en <= ?
             UNION
             SELECT r.id FROM retos r JOIN apuestas_partidos p ON p.match_id = r.match_id
             WHERE r.tipo = 'partido' AND r.estado = 'pendiente' AND p.start_time <= ?`,
        )
        .all(ahora, new Date(ahora).toISOString());
    for (const r of sinAceptar) apuntar(devolver(r.id, "nadie lo aceptó a tiempo"));
    for (const r of db
        .prepare("SELECT id FROM retos WHERE tipo = 'duelo' AND estado = 'en_juego' AND actualizado_en <= ?")
        .all(ahora - ABANDONO_MS)) {
        const reto = obtener(r.id);
        if (reto.juego === "blackjack" && reto.datos) {
            for (const id of Object.keys(reto.datos.plantados)) reto.datos.plantados[id] = true;
            guardarDatos(reto.id, reto.datos);
            apuntar(resolverBlackjack(obtener(reto.id)));
        } else {
            apuntar(devolver(reto.id, "abandonado: no se jugó a tiempo"));
        }
    }
    for (const r of db
        .prepare("SELECT id FROM retos WHERE tipo = 'porra' AND estado IN ('abierta', 'cerrada') AND expira_en <= ?")
        .all(ahora)) {
        apuntar(devolver(r.id, `sin resolver en ${PORRA_DIAS} días`));
    }
    if (cerrados.length) log.info(`Revisión: ${cerrados.length} retos cerrados (${pagos.length} pagos)`);
    return { cerrados, pagos };
}

// ─── Para los paneles ────────────────────────────────────────────────────────

/** Los retos de alguien: los que le han lanzado, los que espera, los que están en juego y los últimos cerrados. */
function deUsuario(userId, limiteCerrados = 5) {
    const id = String(userId);
    const ids = (sql, ...params) =>
        db
            .prepare(sql)
            .all(...params)
            .map((r) => obtener(r.id));
    return {
        recibidos: ids("SELECT id FROM retos WHERE estado = 'pendiente' AND rival = ? ORDER BY creado_en DESC", id),
        enviados: ids("SELECT id FROM retos WHERE estado = 'pendiente' AND creador = ? ORDER BY creado_en DESC", id),
        enJuego: ids(
            `SELECT id FROM retos WHERE estado IN ('en_juego', 'abierta', 'cerrada')
               AND (creador = ? OR id IN (SELECT reto_id FROM retos_participantes WHERE userId = ?))
             ORDER BY actualizado_en DESC LIMIT 10`,
            id,
            id,
        ),
        cerrados: ids(
            `SELECT r.id FROM retos r JOIN retos_participantes p ON p.reto_id = r.id
             WHERE p.userId = ? AND r.estado IN ('resuelto', 'devuelto') ORDER BY r.resuelto_en DESC LIMIT ?`,
            id,
            limiteCerrados,
        ),
    };
}

/** Ganados, perdidos, devueltos, beneficio y lo que hay en juego de alguien en retos. */
function estadisticas(userId) {
    const r = db
        .prepare(
            `SELECT COUNT(CASE WHEN r.estado = 'resuelto' AND p.premio > 0 THEN 1 END) AS ganados,
                    COUNT(CASE WHEN r.estado = 'resuelto' AND p.premio = 0 THEN 1 END) AS perdidos,
                    COUNT(CASE WHEN r.estado = 'devuelto' THEN 1 END)                  AS devueltos,
                    COALESCE(SUM(CASE WHEN r.estado IN ('resuelto', 'devuelto') THEN p.premio - p.cantidad END), 0) AS beneficio,
                    COALESCE(SUM(CASE WHEN r.estado NOT IN ('resuelto', 'devuelto') THEN p.cantidad END), 0) AS enJuego
             FROM retos_participantes p JOIN retos r ON r.id = p.reto_id
             WHERE p.userId = ?`,
        )
        .get(String(userId));
    return { ganados: r.ganados, perdidos: r.perdidos, devueltos: r.devueltos, beneficio: r.beneficio, enJuego: r.enJuego };
}

module.exports = {
    MIN,
    MAX,
    MAX_PENDIENTES,
    ESPERA_ACEPTAR_MS,
    ABANDONO_MS,
    PORRA_DIAS,
    PORRA_MAX_OPCIONES,
    JUEGOS,
    PPT,
    FINALES,
    obtener,
    partidoDe,
    partidosParaRetar,
    descripcion,
    esParticipante,
    crearPartido,
    crearDuelo,
    crearPorra,
    leerOpciones,
    guardarMensaje,
    aceptar,
    rechazar,
    cancelar,
    jugarPpt,
    jugarBlackjack,
    valorMano,
    entrarPorra,
    cerrarPorra,
    resolverPorra,
    anularPorra,
    resolverPartido,
    devolverPorPartido,
    revisar,
    deUsuario,
    estadisticas,
    // Para tests: dados y cartas predecibles.
    __test: {
        setRng: (fn) => {
            rng = fn || Math.random;
        },
    },
};
