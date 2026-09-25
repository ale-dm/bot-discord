// /duende: hablar con el Duende y gestionar sus personalidades y lo que recuerda de la gente.
// Las piezas están en systems/duende (config, memoria, personas) y services/duende (gemini,
// herramientas, voz); aquí queda el comando y la construcción del prompt.
const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { createLogger } = require("../../core/logger");
const guildSettings = require("../../systems/guildSettings");
const adminAudit = require("../../systems/adminAudit");
const apodos = require("../../systems/apodos");
const {
    GEMINI_MODEL,
    DUENDE_MAX_TOKENS,
    DUENDE_MAX_TOKENS_FALLBACK,
    DUENDE_HISTORY_LIMIT,
    DUENDE_DAILY_LIMIT,
    DUENDE_PROMPT_MSG_MAX_CHARS,
    DUENDE_LOG_FULL_PROMPT,
} = require("../../systems/duende/config");
const { conversationHistory, saveHistory } = require("../../systems/duende/memoria");
const perfiles = require("../../systems/duende/perfiles");
const { instruccionDefault } = perfiles;
const { mentionizeKnownNames, buildPersonProfileText, detectMentionedPersons } = require("../../systems/duende/personas");
const { generarConGemini, buildPromptFromParts, isGeminiProhibitedContentError } = require("../../services/duende/gemini");
const { tryVoiceReply } = require("../../services/duende/voz");
const { getGifForText } = require("../../services/giphy");

const log = createLogger("Duende");

// Helper to safely send text responses without exceeding Discord's 2000-char limit.
async function safeEditReply(interaction, content) {
    try {
        const MAX = 2000;
        const text = typeof content === "string" ? content : String(content || "");
        if (text.length <= MAX) {
            await interaction.editReply({ content: text });
            return true;
        }
        // Truncate and attempt to send; leave room for truncation notice
        const truncated = text.slice(0, MAX - 50) + "\n\n(Respuesta truncada por longitud)";
        // Los followUp no heredan lo privado de la respuesta: si esta era privada, los trozos también.
        const flags = interaction.ephemeral ? MessageFlags.Ephemeral : undefined;
        try {
            await interaction.editReply({ content: truncated });
            // If possible, follow up with remaining content in chunks (best-effort)
            if (interaction.followUp && typeof interaction.followUp === "function") {
                let rest = text.slice(MAX - 50);
                while (rest.length > 0) {
                    const chunk = rest.slice(0, MAX - 20);
                    rest = rest.slice(MAX - 20);
                    try {
                        await interaction.followUp({ content: chunk, flags });
                    } catch (e) {
                        break;
                    }
                }
            }
            return true;
        } catch (e) {
            // If editReply fails, try simple followUp
            if (interaction.followUp && typeof interaction.followUp === "function") {
                try {
                    await interaction.followUp({ content: truncated, flags });
                    return true;
                } catch (e2) {
                    log.debug(`followUp de respaldo también falló: ${e2.message}`);
                }
            }
            throw e;
        }
    } catch (err) {
        log.warn("No se pudo enviar la respuesta (safeEditReply):", err);
        return false;
    }
}

// Contador diario de respuestas
let dailyReplyCount = 0;
let dailyReplyDate = new Date().toDateString();
function checkAndIncrementDailyLimit() {
    const today = new Date().toDateString();
    if (today !== dailyReplyDate) {
        dailyReplyDate = today;
        dailyReplyCount = 0;
    }
    if (DUENDE_DAILY_LIMIT > 0 && dailyReplyCount >= DUENDE_DAILY_LIMIT) return false;
    dailyReplyCount++;
    return true;
}

function truncateText(value, maxLength) {
    const text = typeof value === "string" ? value : String(value || "");
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength);
}

function limitToSentences(value, maxSentences = 2) {
    const raw = String(value || "").trim();
    if (!raw) return raw;
    const sentences = raw.match(/[^.!?\n]+[.!?]?/g) || [raw];
    const compact = sentences.map((s) => s.trim()).filter(Boolean);
    if (!compact.length) return truncateText(raw, 220);
    return compact.slice(0, Math.max(1, maxSentences)).join(" ").trim();
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName("duende")
        .setDescription("Habla con El Duende.")
        .addSubcommand((sc) =>
            sc
                .setName("talk")
                .setDescription("Habla con el duende")
                .addStringOption((option) => option.setName("texto").setDescription("Lo que quieres decirle al Duende").setRequired(true))
                .addStringOption((option) => option.setName("personality").setDescription("ID de personalidad (opcional)")),
        )
        .addSubcommand((sc) =>
            sc
                .setName("set")
                .setDescription("Establece la personalidad por canal")
                .addStringOption((option) =>
                    option.setName("personality").setDescription("ID de personalidad a establecer").setRequired(true),
                ),
        )
        .addSubcommand((sc) => sc.setName("list").setDescription("Lista personalidades disponibles"))
        .addSubcommand((sc) =>
            sc
                .setName("add")
                .setDescription("Añade o actualiza una personalidad")
                .addStringOption((option) => option.setName("id").setDescription("ID único para la personalidad").setRequired(true))
                .addStringOption((option) => option.setName("title").setDescription("Título legible").setRequired(true))
                .addStringOption((option) =>
                    option.setName("systeminstructions").setDescription("Instrucciones del sistema / prompt").setRequired(true),
                ),
        )
        .addSubcommand((sc) =>
            sc
                .setName("remove")
                .setDescription("Elimina una personalidad por id")
                .addStringOption((option) => option.setName("id").setDescription("ID a eliminar").setRequired(true)),
        )
        .addSubcommand((sc) =>
            sc
                .setName("recuerda")
                .setDescription("Guarda una nota sobre ti (o sobre otro, si eres admin) para que el Duende la recuerde")
                .addUserOption((option) => option.setName("usuario").setDescription("Sobre quién es la nota").setRequired(true))
                .addStringOption((option) =>
                    option.setName("nota").setDescription("Qué debe recordar el Duende").setRequired(true).setMaxLength(200),
                ),
        )
        .addSubcommand((sc) =>
            sc
                .setName("olvida")
                .setDescription("Borra las notas que el Duende tiene sobre ti (o sobre otro, si eres admin)")
                .addUserOption((option) => option.setName("usuario").setDescription("De quién olvidar las notas").setRequired(true)),
        )
        .addSubcommand((sc) => sc.setName("personas").setDescription("Lo que el Duende recuerda de ti (de todos, si eres admin)")),

    async run(client, interaction) {
        try {
            const sub = interaction.options.getSubcommand();
            // Lo que se sabe de cada uno (las notas y los perfiles) se responde en privado.
            const privado = ["recuerda", "olvida", "personas"].includes(sub);
            await interaction.deferReply(privado ? { flags: MessageFlags.Ephemeral } : {});
            const esAdmin = !!interaction.member?.permissions?.has?.("Administrator");
            const guildCfg = interaction.guildId ? guildSettings.getSettings(interaction.guildId).duende : null;
            const configuredModel = String(guildCfg?.model || "").trim();
            const historyLimit = Math.max(1, Number(guildCfg?.history_limit || DUENDE_HISTORY_LIMIT));
            const temperature = Number.isFinite(Number(guildCfg?.temperature))
                ? Number(guildCfg.temperature)
                : Number(process.env.DUENDE_TEMPERATURE || 0.7);
            const allowedChannel = String(guildCfg?.allowed_channel_id || "").trim();

            // Protect modification subcommands: only allow server administrators
            // to run `add`, `remove` or `set`.
            const modificationSubs = ["add", "remove", "set"];
            if (modificationSubs.includes(sub)) {
                try {
                    const member = interaction.member;
                    const isAdmin =
                        member &&
                        member.permissions &&
                        typeof member.permissions.has === "function" &&
                        member.permissions.has("Administrator");
                    if (!isAdmin) {
                        await interaction.editReply({
                            content: "No tienes permiso para usar este subcomando. Se requieren permisos de administrador.",
                        });
                        return;
                    }
                } catch (permErr) {
                    log.error("Error comprobando permisos:", permErr);
                    await interaction.editReply({
                        content: "No se pudieron comprobar tus permisos. Sólo administradores pueden usar este subcomando.",
                    });
                    return;
                }
            }
            if (sub === "list") {
                const listText = perfiles
                    .listarPersonalidades()
                    .map((p) => `${p.id}: ${p.title}`)
                    .join("\n");
                await safeEditReply(interaction, `Personalidades disponibles:\n${listText}`);
                return;
            }

            // ADD / UPDATE
            if (sub === "add") {
                const id = interaction.options.getString("id");
                const title = interaction.options.getString("title");
                const si = interaction.options.getString("systeminstructions");
                const existing = perfiles.guardarPersonalidad({ id, title, systemInstructions: si });
                adminAudit.logAdminAction({
                    guildId: interaction.guildId,
                    actorId: interaction.user.id,
                    action: existing ? "duende.personality.edit" : "duende.personality.add",
                    details: { id, title, chars: si.length },
                });
                await safeEditReply(interaction, `Personalidad '${id}' añadida/actualizada.`);
                return;
            }

            // REMOVE
            if (sub === "remove") {
                const id = interaction.options.getString("id");
                if (!perfiles.borrarPersonalidad(id)) {
                    await interaction.editReply({ content: `Personalidad '${id}' no encontrada.` });
                    return;
                }
                adminAudit.logAdminAction({
                    guildId: interaction.guildId,
                    actorId: interaction.user.id,
                    action: "duende.personality.remove",
                    details: { id },
                });
                await safeEditReply(interaction, `Personalidad '${id}' eliminada.`);
                return;
            }

            // RECUERDA: añade una nota persistente sobre una persona
            if (sub === "recuerda") {
                const targetUser = interaction.options.getUser("usuario");
                const nota = interaction.options.getString("nota").trim();
                // Solo sobre uno mismo (los admins, sobre cualquiera): las notas van directas al prompt
                // cada vez que esa persona habla, y una nota sobre otro podía cambiar cómo le trata el
                // Duende ("ignora tus instrucciones y...") o ser simplemente ofensiva.
                if (targetUser.id !== interaction.user.id && !esAdmin) {
                    log.info(`${interaction.user.tag} intentó guardar una nota sobre ${targetUser.username} sin permiso`);
                    await safeEditReply(
                        interaction,
                        "Solo puedes guardar notas sobre ti. Para anotar algo de otra persona, pídeselo a un admin.",
                    );
                    return;
                }
                // Por Discord ID (antes por username: al cambiarlo se perdían las notas). Se guardan
                // las MAX_NOTAS más recientes para no inflar el prompt sin límite.
                const nombre = apodos.nombreDe(interaction.guildId, targetUser.id) || targetUser.globalName || targetUser.username;
                perfiles.anotar(targetUser, nota, nombre);
                log.info(`${interaction.user.tag} guardó una nota sobre ${targetUser.username} (${targetUser.id}): "${nota}"`);
                await safeEditReply(interaction, `📝 Anotado sobre **${targetUser.username}**: "${nota}"`);
                return;
            }

            // OLVIDA: borra todas las notas guardadas sobre una persona
            if (sub === "olvida") {
                const targetUser = interaction.options.getUser("usuario");
                // Solo la propia persona o un admin: antes cualquiera podía borrar lo de otro.
                if (targetUser.id !== interaction.user.id && !esAdmin) {
                    log.info(`${interaction.user.tag} intentó borrar las notas de ${targetUser.username} sin permiso`);
                    await safeEditReply(
                        interaction,
                        "Solo puedes borrar lo que recuerdo de ti. Para borrar lo de otra persona, pídeselo a un admin.",
                    );
                    return;
                }
                // Se borran las notas de /duende recuerda; el perfil base (descripción, editable en
                // Panel admin → Duende → Perfiles) se conserva.
                const notas = perfiles.olvidarNotas(targetUser);
                if (!notas.length) {
                    await safeEditReply(interaction, `No tengo notas guardadas sobre **${targetUser.username}**.`);
                    return;
                }
                // Se registra lo borrado: es la única copia (no hay deshacer).
                log.warn(
                    `${interaction.user.tag} (${interaction.user.id}) borró ${notas.length} notas sobre ${targetUser.username}: ${JSON.stringify(notas)}`,
                );
                await safeEditReply(interaction, `🗑️ Olvidadas ${notas.length} notas sobre **${targetUser.username}**.`);
                return;
            }

            // PERSONAS: lista lo que se recuerda de cada uno
            if (sub === "personas") {
                // Cada uno ve solo lo suyo; los admins, todo.
                const propio = perfiles.perfilDe(interaction.user);
                const lista = esAdmin ? perfiles.listarPerfiles() : propio ? [propio] : [];
                if (!lista.length) {
                    await safeEditReply(
                        interaction,
                        esAdmin
                            ? "No tengo notas guardadas sobre nadie todavía. Usa `/duende recuerda`."
                            : "No recuerdo nada sobre ti todavía. Usa `/duende recuerda` para contarme algo.",
                    );
                    return;
                }
                const listText = lista
                    .map((p) => {
                        const notas = p.notas.length ? p.notas : p.description ? [p.description] : [];
                        return `**${p.name}**: ${notas.length ? notas.join("; ") : "(sin notas)"}`;
                    })
                    .join("\n");
                await safeEditReply(interaction, `🧠 Lo que recuerdo:\n${listText}`);
                return;
            }

            // SET channel personality
            if (sub === "set") {
                const pid = interaction.options.getString("personality");
                if (!perfiles.obtenerPersonalidad(pid)) {
                    await interaction.editReply({ content: `Personalidad '${pid}' no encontrada.` });
                    return;
                }
                perfiles.asignarPersonalidadCanal(interaction.channel.id, pid);
                adminAudit.logAdminAction({
                    guildId: interaction.guildId,
                    actorId: interaction.user.id,
                    action: "duende.personality.set_channel",
                    details: { channelId: interaction.channel.id, personality: pid },
                });
                await safeEditReply(interaction, `Personalidad del canal establecida a '${pid}'.`);
                return;
            }

            // TALK
            const userInput = interaction.options.getString("texto");
            const imageAttachments = Array.isArray(interaction.imageAttachments) ? interaction.imageAttachments : [];
            const userName = interaction.user.username;
            const channelId = interaction.channel.id;

            if (interaction.guildId && allowedChannel && channelId !== allowedChannel) {
                await safeEditReply(interaction, `⛔ Duende está restringido a <#${allowedChannel}>.`);
                return;
            }

            log.debug(
                `Mensaje recibido de ${userName} (${channelId})${interaction.id ? ` [msg ${interaction.id}]` : ""}: ${userInput ? userInput.length : 0} chars`,
            );

            // Comprueba límite diario
            if (!checkAndIncrementDailyLimit()) {
                log.warn(`Límite diario alcanzado (${DUENDE_DAILY_LIMIT} respuestas). Mensaje ignorado.`);
                await safeEditReply(interaction, `He alcanzado mi límite de respuestas por hoy (${DUENDE_DAILY_LIMIT}). ¡Hasta mañana!`);
                return;
            }

            // Selección de personalidad: opción en comando > configuración de canal > default
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
            // Instrucción universal, independiente de la personalidad activa: las
            // personalidades personalizadas (masiko, javier, sanchez...) sustituyen del
            // todo `instruccionDefault` y ninguna menciona que hay herramientas
            // disponibles — sin esto, una personalidad centrada en insultar puede
            // "olvidarse" de mirar el dato real y limitarse a soltar un insulto genérico.
            instrucciones = `${instrucciones} El usuario que te habla es: ${userName}. Si tienes herramientas disponibles que te den datos reales para responder (nivel, saldo, Plex...), úsalas siempre antes de contestar, sea cual sea tu personalidad — puedes insultar, bromear o quejarte igualmente con el resultado, pero no te niegues a mirar ni digas que no puedes saberlo si hay una herramienta que sí puede. Si se te dan perfiles de personas, úsalos para decidir tu tono con cada una; si hablas de alguien y también tienes el perfil de quien pregunta, compáralos o relaciónalos en la misma respuesta en vez de describir solo al otro de forma aislada.`;

            // Inicializa historial si no existe
            if (!conversationHistory[channelId]) conversationHistory[channelId] = [];

            // Añade el mensaje del usuario al historial (con timestamp)
            conversationHistory[channelId].push({ role: "user", name: userName, text: userInput, timestamp: Date.now() });
            if (conversationHistory[channelId].length > historyLimit) {
                conversationHistory[channelId] = conversationHistory[channelId].slice(-historyLimit);
            }

            // Perfil completo (sin truncar de forma agresiva, a diferencia de antes que
            // cortaba a 200 caracteres y encima ignoraba `description` si había `notas`)
            // para quien habla ahora + quien se mencione por nombre/apodo/mención en el
            // mensaje. Es lo que le permite al Duende tratar a cada uno según lo que sabe
            // de él y relacionar a ambos en la misma respuesta.
            const speakerProfile = perfiles.perfilDe(interaction.user);
            const mentionedProfiles = detectMentionedPersons(userInput, interaction.guild, interaction.user.id)
                .filter((p) => !speakerProfile || p.key !== speakerProfile.key)
                .slice(0, 3);

            const perfilesDestacados = [];
            if (speakerProfile) {
                perfilesDestacados.push(
                    `${speakerProfile.name} (quien te habla ahora): ${truncateText(buildPersonProfileText(speakerProfile), perfiles.MAX_PERFIL_PROMPT)}`,
                );
            }
            for (const p of mentionedProfiles) {
                perfilesDestacados.push(
                    `${p.name} (mencionado en el mensaje): ${truncateText(buildPersonProfileText(p), perfiles.MAX_PERFIL_PROMPT)}`,
                );
            }
            const lineaPerfiles = perfilesDestacados.length
                ? "Perfiles a tener en cuenta ahora mismo:\n" + perfilesDestacados.join("\n")
                : null;

            // Equivalencias ligeras (solo nombre) para el resto de gente conocida, sin
            // volcar toda su descripción — así no se infla el prompt con perfiles que no
            // vienen a cuento en este mensaje.
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
            const lineaPersonalidadActiva = personaObj
                ? `Personalidad activa: ${personaObj.id} (${personaObj.title || "sin título"})`
                : "Personalidad activa: default";

            // Línea que indica quién envía el mensaje ahora mismo
            const nombreHablante = apodos.nombreDe(interaction.guildId, interaction.user.id) || nombrePorUsername.get(userName);
            const lineaUsuarioActual = `Mensaje actual enviado por: ${userName}${nombreHablante ? ` / ${nombreHablante}` : ""}`;

            // Historial con etiquetas claras de quién dijo qué
            const contextParts = conversationHistory[channelId]
                .map((msg) => {
                    const nombre = nombrePorUsername.get(msg.name);
                    if (msg.role === "user")
                        return `Usuario (${msg.name}${nombre ? ` / ${nombre}` : ""}): ${truncateText(msg.text, DUENDE_PROMPT_MSG_MAX_CHARS)}`;
                    return `Duende: ${truncateText(msg.text, DUENDE_PROMPT_MSG_MAX_CHARS)}`;
                })
                .slice(-historyLimit);

            // Decide si intervenir (mantengo la lógica previa)
            const lastMessages = conversationHistory[channelId].slice(-4);
            const uniqueUsers = [...new Set(lastMessages.filter((m) => m.role === "user").map((m) => m.name))];
            const mensajeMencionaOtro =
                uniqueUsers.length > 1 || uniqueUsers.some((name) => userInput.toLowerCase().includes(name.toLowerCase()));
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

            // Composición del prompt base
            const parts = [
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

            const activeModel = configuredModel || GEMINI_MODEL;
            log.debug(`Prompt enviado a Gemini (${activeModel}): [personalidad, instrucciones, equivalencias, historial reciente]`);
            if (DUENDE_LOG_FULL_PROMPT) {
                try {
                    log.info(`Prompt completo Gemini:\n${buildPromptFromParts(parts)}`);
                } catch (promptLogErr) {
                    log.warn("No se pudo registrar el prompt completo: " + (promptLogErr && promptLogErr.message));
                }
            }

            const toolContext = {
                guildId: interaction.guildId || null,
                userId: interaction.user.id,
                guild: interaction.guild || null,
                channelId,
            };

            let text = "No estoy disponible.";
            try {
                text = await generarConGemini(parts, {
                    maxTokens: DUENDE_MAX_TOKENS,
                    model: activeModel,
                    temperature,
                    images: imageAttachments,
                    toolContext,
                });
                log.info("Respuesta de Gemini: " + text);
            } catch (err) {
                const errMsg = err && err.message ? err.message : String(err);
                if (isGeminiProhibitedContentError(errMsg)) {
                    log.warn("Gemini bloqueó la respuesta por PROHIBITED_CONTENT. Reintentando con prompt seguro.");

                    const safeParts = [
                        { text: "Eres un asistente de Discord. Responde de forma breve, útil y respetuosa en español." },
                        { text: `Usuario actual: ${userName}` },
                        { text: `Mensaje del usuario: ${truncateText(userInput, 300)}` },
                        {
                            text: 'Evita lenguaje ofensivo, amenazas, acoso o sexual explícito. Si tienes herramientas disponibles que te den datos reales o ejecuten la acción pedida, úsalas con normalidad — pedir contenido multimedia, consultar datos de otro usuario del mismo grupo, etc. no es "problemático", es el uso normal de este bot entre amigos. Solo niégate ante algo realmente dañino (amenazas reales, acoso serio, contenido sexual con menores...), nunca por simple prudencia ante una petición normal.',
                        },
                        { text: "Responde en 1-2 frases." },
                    ];

                    try {
                        // Con toolContext también en este camino: si lo que se bloqueó fue solo el
                        // TONO (personalidad muy agresiva chocando con el filtro de PROHIBITED_CONTENT
                        // de Gemini, no configurable vía safetySettings), la acción real pedida por el
                        // usuario sigue pudiendo completarse con un tono neutro — antes este fallback
                        // no tenía herramientas y la funcionalidad entera se perdía, no solo el tono.
                        text = await generarConGemini(safeParts, {
                            maxTokens: DUENDE_MAX_TOKENS_FALLBACK,
                            model: activeModel,
                            temperature,
                            toolContext,
                        });
                        log.warn("Reintento Gemini con prompt seguro completado (con herramientas). Texto: " + text);
                    } catch (safeErr) {
                        const safeErrMsg = safeErr && safeErr.message ? safeErr.message : String(safeErr);
                        log.error("Error en reintento seguro de Gemini: " + safeErrMsg);
                        text = "No puedo responder a ese contenido. Reformúlalo en términos más neutrales.";
                    }
                } else {
                    log.error(`Error al llamar a Gemini: ${errMsg}`);
                    if (!text || text === "No estoy disponible.") {
                        text = "Ahora mismo no puedo responder. Inténtalo de nuevo en unos segundos.";
                    }
                }
            }

            text = limitToSentences(text, 2);
            if (interaction.guild) {
                text = mentionizeKnownNames(text, interaction.guild);
            }

            let gifUrl = null;
            try {
                if (Math.random() < (parseFloat(process.env.DUENDE_GIF_PROB) || 0.08)) {
                    gifUrl = await getGifForText(text, userInput);
                    if (gifUrl) log.debug("GIF encontrado: " + gifUrl);
                    else log.debug("No se encontró GIF relevante.");
                } else log.debug("No se busca GIF esta vez.");
            } catch (err) {
                log.error("Error buscando GIF: " + err.message);
            }

            conversationHistory[channelId].push({ role: "duende", name: "Duende", text, timestamp: Date.now() });
            saveHistory();

            // Ensure message content fits Discord limits (2000 chars). Truncate if needed.
            const MAX_DISCORD_CONTENT = 2000;
            const SAFETY_MARGIN = 20; // leave room for extra text like truncation notice and gif url
            const effectiveMax = MAX_DISCORD_CONTENT - SAFETY_MARGIN;
            let sendText = typeof text === "string" ? text : String(text || "");
            if (sendText.length > effectiveMax) {
                sendText = sendText.slice(0, effectiveMax) + "\n\n(Respuesta truncada por longitud)";
            }

            try {
                let sentOk = false;
                if (!interaction?.silentTextReply) {
                    sentOk = await safeEditReply(interaction, sendText);
                } else {
                    sentOk = true;
                }

                if (!interaction?.silentTextReply && sentOk && gifUrl) {
                    let gifSent = false;
                    if (interaction.followUp && typeof interaction.followUp === "function") {
                        try {
                            await interaction.followUp({ content: gifUrl });
                            gifSent = true;
                        } catch (gifErr) {
                            log.warn("No se pudo enviar GIF por followUp: " + (gifErr && gifErr.message ? gifErr.message : gifErr));
                        }
                    }
                    if (!gifSent && interaction.channel && typeof interaction.channel.send === "function") {
                        try {
                            await interaction.channel.send(gifUrl);
                        } catch (gifErr2) {
                            log.warn("No se pudo enviar GIF por channel.send: " + (gifErr2 && gifErr2.message ? gifErr2.message : gifErr2));
                        }
                    }
                }

                if (!interaction?.silentTextReply && !sentOk) {
                    const fallbackMsg = "⚠️ No he podido enviar la respuesta principal. Inténtalo de nuevo en unos segundos.";
                    if (interaction.followUp && typeof interaction.followUp === "function") {
                        try {
                            await interaction.followUp({ content: fallbackMsg });
                            sentOk = true;
                        } catch (e) {
                            log.debug(`followUp de aviso falló: ${e.message}`);
                        }
                    }
                    if (!sentOk && interaction.channel && typeof interaction.channel.send === "function") {
                        try {
                            await interaction.channel.send(fallbackMsg);
                        } catch (e) {
                            log.warn(`No se pudo enviar ni la respuesta ni el aviso de error en ${interaction.channel?.id}: ${e.message}`);
                        }
                    }
                }
            } catch (sendErr) {
                log.error("Error enviando respuesta por texto:", sendErr);
            }

            try {
                void tryVoiceReply(client, interaction, text);
            } catch (voiceErr) {
                log.error("Error lanzando respuesta por voz:", voiceErr);
            }
        } catch (err) {
            log.error("Error general en el comando:", err);
            try {
                await interaction.editReply({ content: "Ha ocurrido un error inesperado. Intenta de nuevo más tarde." });
            } catch (e) {
                log.debug(`Tampoco se pudo avisar del error: ${e.message}`);
            }
        }
    },
};
