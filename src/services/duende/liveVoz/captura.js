// Captura de voz en directo: quién habla, cómo se envía su audio a Gemini y la tertulia (turnos y mezcla).

const { EndBehaviorType } = require("@discordjs/voice");
const prism = require("prism-media");
const perfiles = require("../../../systems/duende/perfiles");
const { buildPersonProfileText } = require("../../../systems/duende/personas");
const { FRAME_MS } = require("../mezclador");
const { FIN_TURNO_TERTULIA_MS, IDLE_DISCONNECT_MS, MAX_DURATION_MS, IDLE_CHECK_INTERVAL_MS } = require("./constantes");
const { pararConversacion, marcarActividad } = require("./sesion");
const { createLogger } = require("../../../core/logger");

const log = createLogger("Duende").child("VozEnVivo");

function suscribirCaptura(receiver, sesion, userId, alTrozo) {
    const opusStream = receiver.subscribe(userId, { end: { behavior: EndBehaviorType.Manual } });
    opusStream.on("error", (e) => log.warn(`Error leyendo el audio entrante (opus) de ${userId}: ${e.message}`));
    sesion.suscripciones.set(userId, opusStream);
    const pcmStream = opusStream.pipe(new prism.opus.Decoder({ channels: 1, rate: 16000, frameSize: 320 }));
    pcmStream.on("error", (e) => log.warn(`Error decodificando el audio entrante de ${userId}: ${e.message}`));
    pcmStream.on("data", (chunk) => {
        marcarActividad(sesion);
        alTrozo(chunk);
    });
}

// Quién es, para decírselo a Gemini antes de su turno (igual que el chat de texto, que
// resuelve el perfil de quien habla con cada mensaje) — mismo sistema de perfiles/apodos
// que usa consultar_perfil_persona.
function identificarHablante(interaction, userId) {
    const member = interaction.guild.members.cache.get(userId);
    const perfil = perfiles.perfilDe(member ? member.user : { id: userId });
    const nombre = perfil?.name || member?.displayName || member?.user?.username || "alguien";
    return { nombre, perfilTexto: perfil ? buildPersonProfileText(perfil) : null };
}

// Tertulia: se abre un turno para todos a la vez y el audio de cada persona entra en el mezclador. El turno se
// cierra cuando nadie ha hablado durante FIN_TURNO_TERTULIA_MS.
function alEmpezarHablarTertulia({ liveSession, receiver, sesion }, userId) {
    sesion.hablantes.add(userId);
    clearTimeout(sesion.finTurnoTimer);
    if (!sesion.enTurno) {
        sesion.enTurno = true;
        sesion.turnoTranscripcion = "";
        sesion.avisoIgnoradoEsteTurno = false;
        sesion.permitirAudioSalida = !sesion.soloSiLeLlaman;
        try {
            liveSession.sendRealtimeInput({ activityStart: {} });
        } catch (e) {
            log.warn(`Error avisando a Gemini del turno de la tertulia: ${e.message}`);
        }
    }
    if (sesion.suscripciones.has(userId)) return;
    suscribirCaptura(receiver, sesion, userId, (chunk) => sesion.mezclador.empujar(userId, chunk));
}

function alDejarDeHablarTertulia({ liveSession, sesion }, userId) {
    sesion.hablantes.delete(userId);
    if (sesion.hablantes.size) return;
    clearTimeout(sesion.finTurnoTimer);
    sesion.finTurnoTimer = setTimeout(() => {
        if (sesion.hablantes.size || !sesion.enTurno) return;
        sesion.enTurno = false;
        try {
            liveSession.sendRealtimeInput({ activityEnd: {} });
        } catch (e) {
            log.warn(`Error avisando a Gemini del fin del turno de la tertulia: ${e.message}`);
        }
    }, FIN_TURNO_TERTULIA_MS);
}

// Cualquiera del canal puede hablarle, no solo quien pidió /conversación — pero de uno
// en uno: mientras sesion.hablanteActivo esté puesto, se ignora a quien más empiece a
// hablar (no hay forma de mezclar a dos personas en el mismo turno de Gemini).
function alEmpezarHablar({ interaction, liveSession, receiver, sesion }, userId) {
    if (sesion.soloEscuchaA && userId !== sesion.soloEscuchaA) return;
    if (sesion.hablanteActivo) return;
    sesion.hablanteActivo = userId;
    // Nuevo turno: hasta que no se oiga la palabra de llamada (si el modo la exige), se
    // ignora la respuesta. El saludo inicial ya se reprodujo con permitirAudioSalida en
    // true desde el principio, así que esto solo afecta a partir de que alguien habla.
    sesion.turnoTranscripcion = "";
    sesion.avisoIgnoradoEsteTurno = false;
    sesion.permitirAudioSalida = !sesion.soloSiLeLlaman;

    const { nombre, perfilTexto } = identificarHablante(interaction, userId);
    try {
        // turnComplete: false para que esto no dispare una respuesta por sí solo — solo
        // deja constancia de quién habla antes de que llegue su audio de verdad. Mezclar
        // sendClientContent con audio en tiempo real dentro del mismo turno no está 100%
        // garantizado por la Live API, pero es la única forma de decirle quién habla.
        liveSession.sendClientContent({
            turns: `(Quien va a hablar ahora es ${nombre}${perfilTexto ? `. Esto es lo que sabes de ${nombre}: ${perfilTexto}` : ""}.)`,
            turnComplete: false,
        });
    } catch (e) {
        log.warn(`Error identificando a ${userId} ante Gemini: ${e.message}`);
    }
    // Esto es lo que le dice a Gemini que empieza el turno — se manda cada vez que
    // alguien habla, no solo la primera.
    try {
        liveSession.sendRealtimeInput({ activityStart: {} });
    } catch (e) {
        log.warn(`Error avisando a Gemini de que ${userId} ha empezado a hablar: ${e.message}`);
    }

    if (sesion.suscripciones.has(userId)) return;
    log.info(`${userId} (${nombre}) ha empezado a hablar: suscribiendo captura de audio.`);
    suscribirCaptura(receiver, sesion, userId, (chunk) => {
        // Trozo sobrante fuera de su activityStart/activityEnd (del decoder, con el
        // stream ya "parado"), o de alguien que no tiene el turno: no se manda.
        if (sesion.hablanteActivo !== userId) return;
        sesion.chunksAudioEntrada = (sesion.chunksAudioEntrada || 0) + 1;
        if (sesion.chunksAudioEntrada === 1) {
            log.info(`Primer trozo de audio de ${userId} capturado (${chunk.length} bytes) — mandándolo a Gemini.`);
        }
        try {
            // El campo es "audio" (stream de audio en tiempo real de verdad), no el
            // genérico "media" — con la detección manual de actividad puesta, el server
            // necesita el audio por ese campo para poder casarlo con activityStart/End;
            // por "media" llegaba igual pero sin ese seguimiento, y cortaba la sesión
            // con "Precondition check failed" a los pocos segundos de hablar.
            liveSession.sendRealtimeInput({ audio: { data: chunk.toString("base64"), mimeType: "audio/pcm;rate=16000" } });
        } catch (e) {
            log.warn(`Error enviando audio a Gemini Live: ${e.message}`);
        }
    });
}

/** Entrada: cualquiera del canal puede hablarle; cada persona se suscribe al primer "empieza a hablar". */
function escucharHablantes(interaction, sesion) {
    const liveSession = sesion.liveSession;
    const receiver = sesion.connection.receiver;
    const ctx = { interaction, sesion, liveSession, receiver };

    const onSpeakingStart = (userId) => (sesion.tertulia ? alEmpezarHablarTertulia(ctx, userId) : alEmpezarHablar(ctx, userId));
    // El "end" de Discord llega ~100ms después del último paquete de voz real — mucho más
    // fiable como señal de fin de turno que esperar a que Gemini la adivine de un audio con
    // huecos (sin paquetes durante los silencios, no hay "silencio" que analizar).
    const onSpeakingEnd = (userId) => {
        if (sesion.tertulia) return alDejarDeHablarTertulia(ctx, userId);
        if (sesion.hablanteActivo !== userId) return;
        sesion.hablanteActivo = null;
        try {
            liveSession.sendRealtimeInput({ activityEnd: {} });
        } catch (e) {
            log.warn(`Error avisando a Gemini de que ${userId} ha dejado de hablar: ${e.message}`);
        }
    };
    receiver.speaking.on("start", onSpeakingStart);
    receiver.speaking.on("end", onSpeakingEnd);
    if (sesion.tertulia) {
        // Cada FRAME_MS, lo que se haya mezclado de todos sale hacia Gemini en tiempo real.
        sesion.mezcladorTimer = setInterval(() => {
            const trozo = sesion.mezclador.tick();
            if (!trozo) return;
            try {
                liveSession.sendRealtimeInput({ audio: { data: trozo.toString("base64"), mimeType: "audio/pcm;rate=16000" } });
            } catch (e) {
                log.warn(`Error enviando la tertulia a Gemini Live: ${e.message}`);
            }
        }, FRAME_MS);
    }
    sesion.receiver = receiver;
    sesion.onSpeakingStart = onSpeakingStart;
    sesion.onSpeakingEnd = onSpeakingEnd;
}

/** Corta la conversación por inactividad o por tope de duración. */
function programarLimites(sesion, guildId) {
    sesion.idleCheckInterval = setInterval(() => {
        if (Date.now() - sesion.ultimaActividad > IDLE_DISCONNECT_MS) {
            pararConversacion(guildId, `${Math.round(IDLE_DISCONNECT_MS / 60000)} min sin actividad`);
        }
    }, IDLE_CHECK_INTERVAL_MS);
    sesion.maxDurationTimer = setTimeout(() => {
        pararConversacion(guildId, `tope de ${Math.round(MAX_DURATION_MS / 60000)} min de duración`);
    }, MAX_DURATION_MS);
}

/**
 * Empieza una conversación de voz en directo en el canal de quien invoca.
 * @returns {Promise<{ok: true, voiceChannel: object} | {ok: false, error: string}>}
 */

module.exports = {
    suscribirCaptura,
    identificarHablante,
    alEmpezarHablarTertulia,
    alDejarDeHablarTertulia,
    alEmpezarHablar,
    escucharHablantes,
    programarLimites,
};
