// Contexto del turno del Duende: la configuración del servidor, las instrucciones, los perfiles y el historial que van al prompt.

const apodos = require("../../../systems/apodos");
const { DUENDE_HISTORY_LIMIT, DUENDE_PROMPT_MSG_MAX_CHARS } = require("../../../systems/duende/config");
const { conversationHistory } = require("../../../systems/duende/memoria");
const perfiles = require("../../../systems/duende/perfiles");
const { ajusteDeTono } = require("../../../systems/duende/tono");
const { buildPersonProfileText, detectMentionedPersons } = require("../../../systems/duende/personas");
const { truncateText } = require("./generar");
const { instruccionDefault } = perfiles;

function leerConfiguracion(guildCfg) {
    return {
        configuredModel: String(guildCfg?.model || "").trim(),
        historyLimit: Math.max(1, Number(guildCfg?.history_limit || DUENDE_HISTORY_LIMIT)),
        temperature: Number.isFinite(Number(guildCfg?.temperature))
            ? Number(guildCfg.temperature)
            : Number(process.env.DUENDE_TEMPERATURE || 0.7),
        allowedChannel: String(guildCfg?.allowed_channel_id || "").trim(),
    };
}

// Selección de personalidad: opción en comando > configuración de canal > default. Encima se le dice quién habla,
// y el tono de madrugada o formal del canal (F-DU-02).
function construirInstrucciones(interaction, channelId, userName) {
    const requestedPersonality = interaction.options.getString("personality") || null;
    let instrucciones = instruccionDefault;
    let personaObj = null;
    if (requestedPersonality) personaObj = perfiles.obtenerPersonalidad(requestedPersonality);
    if (!personaObj) personaObj = perfiles.obtenerPersonalidad(perfiles.personalidadDeCanal(channelId));
    if (personaObj) instrucciones = personaObj.systemInstructions;

    // Los perfiles de las personas SÍ moldean el trato: es contenido escrito a
    // mano para eso (ver buildPersonProfileText/lineaPerfiles más abajo). Cuando
    // se hable de alguien, se le da al modelo tanto el perfil de quien pregunta
    // como el de quien es el tema, para que pueda compararlos/relacionarlos en
    // la misma respuesta en vez de describir solo al otro de forma aislada.
    // El recordatorio de "usa las herramientas siempre" ya no va aquí: las
    // personalidades personalizadas (masiko, javier, sanchez...) sustituyen del
    // todo `instruccionDefault`, y mezclado en este texto competía con ellas en
    // igualdad de condiciones. Ahora vive en el systemInstruction real de Gemini
    // (gemini.js), que no se puede pisar cambiando de personalidad.
    instrucciones = `${instrucciones} El usuario que te habla es: ${userName}. Si se te dan perfiles de personas, úsalos para decidir tu tono con cada una; si hablas de alguien y también tienes el perfil de quien pregunta, compáralos o relaciónalos en la misma respuesta en vez de describir solo al otro de forma aislada.`;
    // 🌙 Más borde de madrugada y 👔 más formal en ciertos canales (F-DU-02), encima de la personalidad que toque.
    const tono = ajusteDeTono(interaction.guildId, channelId);
    if (tono) instrucciones = `${instrucciones} ${tono}`;
    return { instrucciones, personaObj };
}

// Perfil completo (sin truncar de forma agresiva, a diferencia de antes que
// cortaba a 200 caracteres y encima ignoraba `description` si había `notas`)
// para quien habla ahora + quien se mencione por nombre/apodo/mención en el
// mensaje. Es lo que le permite al Duende tratar a cada uno según lo que sabe
// de él y relacionar a ambos en la misma respuesta.
async function lineaDePerfiles(interaction, userInput) {
    const speakerProfile = perfiles.perfilDe(interaction.user);
    const mentionedProfiles = detectMentionedPersons(userInput, interaction.guild, interaction.user.id)
        .filter((p) => !speakerProfile || p.key !== speakerProfile.key)
        .slice(0, 3);

    // Con pocas notas se dan todas (perfiles.notasRelevantes no llama a Gemini); con
    // muchas, solo las más relacionadas con lo que se acaba de decir en vez de
    // siempre las últimas MAX_NOTAS — así no se pierden notas antiguas que sí vienen
    // a cuento ahora. Si falla la llamada a Gemini, cae a las últimas como antes.
    const conNotasRelevantes = async (p) => p && { ...p, notas: await perfiles.notasRelevantes(p, userInput) };
    const [speakerConNotas, ...mentionedConNotas] = await Promise.all([
        conNotasRelevantes(speakerProfile),
        ...mentionedProfiles.map(conNotasRelevantes),
    ]);

    const perfilesDestacados = [];
    if (speakerConNotas) {
        perfilesDestacados.push(
            `${speakerConNotas.name} (quien te habla ahora): ${truncateText(buildPersonProfileText(speakerConNotas), perfiles.MAX_PERFIL_PROMPT)}`,
        );
    }
    for (const p of mentionedConNotas) {
        perfilesDestacados.push(
            `${p.name} (mencionado en el mensaje): ${truncateText(buildPersonProfileText(p), perfiles.MAX_PERFIL_PROMPT)}`,
        );
    }
    return perfilesDestacados.length ? "Perfiles a tener en cuenta ahora mismo:\n" + perfilesDestacados.join("\n") : null;
}

// Equivalencias ligeras (solo nombre) para el resto de gente conocida, sin
// volcar toda su descripción — así no se infla el prompt con perfiles que no
// vienen a cuento en este mensaje.
function lineasDeUsuarios(interaction, userName) {
    // Nombre de cada uno según sus apodos (username de Discord -> nombre principal).
    const nombrePorUsername = new Map();
    for (const { discordId, nombre } of apodos.nombres(interaction.guildId)) {
        const m = interaction.guild?.members?.cache?.get(discordId);
        if (m) nombrePorUsername.set(m.user.username, nombre);
    }
    const personEntries = perfiles
        .listarPerfiles()
        .filter((p) => p.username)
        .map((p) => `"${p.username}" es ${p.name}`);
    const manualEntries = [...nombrePorUsername].map(([username, nombre]) => `"${username}" es ${nombre}`);
    const equivalencias = [...manualEntries, ...personEntries].join(", ");
    const lineaEquivalencias = "Equivalencias de usuarios: " + equivalencias + ".";

    // Línea que indica quién envía el mensaje ahora mismo
    const nombreHablante = apodos.nombreDe(interaction.guildId, interaction.user.id) || nombrePorUsername.get(userName);
    const lineaUsuarioActual = `Mensaje actual enviado por: ${userName}${nombreHablante ? ` / ${nombreHablante}` : ""}`;
    return { nombrePorUsername, lineaEquivalencias, lineaUsuarioActual };
}

// Historial con etiquetas claras de quién dijo qué
function historialParaPrompt(channelId, historyLimit, nombrePorUsername) {
    return conversationHistory[channelId]
        .map((msg) => {
            const nombre = nombrePorUsername.get(msg.name);
            if (msg.role === "user")
                return `Usuario (${msg.name}${nombre ? ` / ${nombre}` : ""}): ${truncateText(msg.text, DUENDE_PROMPT_MSG_MAX_CHARS)}`;
            return `Duende: ${truncateText(msg.text, DUENDE_PROMPT_MSG_MAX_CHARS)}`;
        })
        .slice(-historyLimit);
}

// Decide si intervenir (mantengo la lógica previa) y añade las reglas de estilo de este turno.
function instruccionesDelTurno(instrucciones, channelId, userInput) {
    const lastMessages = conversationHistory[channelId].slice(-4);
    const uniqueUsers = [...new Set(lastMessages.filter((m) => m.role === "user").map((m) => m.name))];
    const mensajeMencionaOtro = uniqueUsers.length > 1 || uniqueUsers.some((name) => userInput.toLowerCase().includes(name.toLowerCase()));
    const shouldIntervene = mensajeMencionaOtro && Math.random() < (parseFloat(process.env.DUENDE_INTERVENE_PROB) || 0.5);
    let instruccionesFinal = instrucciones;
    if (shouldIntervene)
        instruccionesFinal +=
            " Están hablando entre ellos. Si crees que puedes aportar algo sarcástico o molesto, hazlo. Si no, ignora la conversación.";
    instruccionesFinal +=
        " Regla importante: no repitas literalmente tu última respuesta ni copies frases exactas de mensajes previos. Responde solo una vez y de forma nueva.";
    instruccionesFinal +=
        " Si viene a cuento, termina alguna vez (no siempre, no lo fuerces) con una pregunta corta para seguir la conversación en vez de solo soltar una frase y punto.";
    instruccionesFinal +=
        " Cuando uses un dato que has consultado (fecha, título, cifra...), no lo sueltes en plan ficha ('X hizo Y el [fecha]') ni en dos bloques pegados ('¡exclamación o insulto! + luego el dato aparte') — teje el dato y el insulto/comentario DENTRO de la misma frase, como si el dato fuera parte de la queja o la burla, no un anexo. Nada de empezar siempre con una interjección tipo '¡Me cago en la puta!' antes del dato: varía cómo empiezas cada respuesta (a veces con el dato, a veces con la pulla, a veces con una pregunta retórica) para que no suene a plantilla repetida mensaje tras mensaje.";
    instruccionesFinal +=
        " Regla estricta: si tienes una herramienta que EJECUTA algo real (pedir contenido, comprar, cambiar un dato...), nunca digas en tu respuesta que ya lo has hecho ('ya te lo he pedido', 'hecho', 'ya está') a menos que hayas llamado de verdad a esa herramienta en este mismo turno y haya devuelto éxito. Está prohibido inventarte o dar por hecho el resultado de una acción que no has ejecutado — si dudas si ejecutarla o no, ejecútala (tienes permiso), pero nunca narres una acción como completada sin haberla completado de verdad.";
    return instruccionesFinal;
}

// Composición del prompt base
function construirPartes({
    lineaPersonalidadActiva,
    instruccionesFinal,
    lineaPerfiles,
    lineaEquivalencias,
    lineaUsuarioActual,
    contextParts,
    imageAttachments,
}) {
    return [
        { text: lineaPersonalidadActiva },
        { text: instruccionesFinal },
        ...(lineaPerfiles ? [{ text: lineaPerfiles }] : []),
        { text: lineaEquivalencias },
        { text: lineaUsuarioActual },
        { text: "Conversación reciente (de más antiguo a más nuevo):" },
        ...contextParts.map((text) => ({ text })),
        ...(imageAttachments.length
            ? [{ text: "El usuario ha compartido una imagen adjunta a su último mensaje; coméntala si viene a cuento." }]
            : []),
        { text: "Responde ahora al último mensaje del usuario actual en 1-2 frases." },
    ];
}

module.exports = {
    leerConfiguracion,
    construirInstrucciones,
    lineaDePerfiles,
    lineasDeUsuarios,
    historialParaPrompt,
    instruccionesDelTurno,
    construirPartes,
};
