// 👋 Bienvenida (#435): cuando alguien nuevo entra al servidor, el bot publica en el canal configurado (bienvenida.canal_id) un
// mensaje con su mención, el texto que el admin haya escrito (bienvenida.texto) y una línea de cómo empezar. En el texto, {usuario}
// pasa a ser la mención de la persona y {miembros} el número de miembros del servidor. Los bots que entran no generan mensaje.
// Sin canal configurado no se hace nada. Sin texto, sale uno por defecto.
const guildSettings = require("./guildSettings");
const { fmtNumero } = require("../core/formato");
const { createLogger } = require("../core/logger");

const log = createLogger("Bienvenida");

const TEXTO_POR_DEFECTO = "👋 ¡Bienvenido/a {usuario}! Ya somos {miembros} en el servidor.";
const COMO_EMPEZAR = "Para empezar, mira tu perfil con `/perfil` y descubre lo que puedo hacer con `/ayuda`.";
const MAX_TEXTO = 500;

/** Sustituye {usuario} (la mención) y {miembros} (el número de miembros) en una plantilla. */
function rellenar(plantilla, { usuarioId, miembros }) {
    return String(plantilla ?? "")
        .replaceAll("{usuario}", `<@${usuarioId}>`)
        .replaceAll("{miembros}", fmtNumero(miembros));
}

/**
 * El mensaje de bienvenida de un miembro nuevo: `{ canalId, contenido, allowedMentions }`, o null si no hay que mandar nada
 * (es un bot, no hay canal configurado).
 */
function bienvenidaDe(member) {
    if (member.user?.bot) return null;
    const cfg = guildSettings.getSettings(member.guild.id).bienvenida;
    if (!cfg.canal_id) return null;
    const texto = (cfg.texto || "").trim() || TEXTO_POR_DEFECTO;
    const cuerpo = rellenar(texto, { usuarioId: member.id, miembros: member.guild.memberCount });
    return {
        canalId: cfg.canal_id,
        contenido: `${cuerpo}\n${COMO_EMPEZAR}`,
        // La mención avisa solo a la persona nueva, nunca a lo que el admin haya podido poner en el texto.
        allowedMentions: { users: [member.id] },
    };
}

/** Publica la bienvenida de un miembro que acaba de entrar. Un fallo (canal borrado, sin permisos) queda en el log. */
async function enviarBienvenida(member) {
    const b = bienvenidaDe(member);
    if (!b) return false;
    try {
        const canal = member.guild.channels.cache.get(b.canalId) || (await member.guild.channels.fetch(b.canalId));
        await canal.send({ content: b.contenido, allowedMentions: b.allowedMentions });
        return true;
    } catch (e) {
        log.warn(`No se pudo dar la bienvenida a ${member.id} en ${member.guild.name} (canal ${b.canalId}): ${e.message}`);
        return false;
    }
}

module.exports = { TEXTO_POR_DEFECTO, COMO_EMPEZAR, MAX_TEXTO, rellenar, bienvenidaDe, enviarBienvenida };
