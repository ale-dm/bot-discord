// Quién es quién para el Duende: resolver nombres/apodos a personas reales, convertir nombres
// en menciones y encontrar los perfiles de las personas de las que se habla.
const apodos = require("../apodos");
const { normalizarApodo, sinArticulo } = require("../apodosUtil");
const perfiles = require("./perfiles");

// Miembro del servidor al que corresponde un perfil: por Discord ID o, si aún no está vinculado
// (perfil importado del JSON antiguo), por username.
function miembroDePerfil(p, guild) {
    const cache = guild?.members?.cache;
    if (!cache) return null;
    if (p.discordId) return cache.get(p.discordId) || null;
    if (!p.username) return null;
    const u = p.username.toLowerCase();
    return cache.find((m) => m.user.username.toLowerCase() === u) || null;
}

// Convierte en menciones reales de Discord los nombres de la gente (su nombre principal en
// los apodos, o el de su perfil) que aparezcan en la respuesta generada, para que a quien se
// nombre le llegue la notificación en vez de quedarse como texto plano.
// Solo el nombre principal: "el perro" en una respuesta no debe convertirse en mención.
function mentionizeKnownNames(text, guild) {
    if (!text || !guild) return text;
    const nameToId = new Map();
    for (const { discordId, nombre } of apodos.nombres(guild.id)) nameToId.set(nombre.toLowerCase(), discordId);
    for (const p of perfiles.listarPerfiles()) {
        if (!p.name) continue;
        const member = miembroDePerfil(p, guild);
        if (member && !nameToId.has(p.name.toLowerCase())) nameToId.set(p.name.toLowerCase(), member.id);
    }
    if (nameToId.size === 0) return text;

    // Nombres más largos primero, para no pisar substrings de nombres más largos.
    const names = [...nameToId.keys()].sort((a, b) => b.length - a.length);
    let result = text;
    for (const nameLower of names) {
        const id = nameToId.get(nameLower);
        if (!guild.members.cache.has(id)) continue;
        const escaped = nameLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        // Límites de palabra con letras Unicode: \b no reconoce «José» ni «Tonín» (la bandera u hace falta para \p{L}).
        const re = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "giu");
        result = result.replace(re, `<@${id}>`);
    }
    return result;
}

// Quita tildes/diacríticos para que "Raúl"/"raul", "Martín"/"martin", etc. resuelvan igual.
const normalizeName = normalizarApodo;

// Resuelve un nombre en lenguaje natural (ej. "Raúl", "el perro") a un userId de Discord
// real. Orden: 1) apodos del servidor (Panel admin → Config Global → Duende → Apodos; prueba también sin
// artículo), 2) nombres de los perfiles del Duende, 3) username/apodo/nombre visible de los
// miembros del server. Nunca acepta un ID directamente del modelo — solo nombres.
function resolveNameToDiscordId(name, guild) {
    if (!name) return null;
    const nameLower = normalizeName(name);
    if (!nameLower) return null;
    const nameSinArticulo = sinArticulo(nameLower);

    const porApodo = apodos.resolver(guild?.id, name);
    if (porApodo) return porApodo;
    if (!guild) return null;

    for (const p of perfiles.listarPerfiles()) {
        const pNameNorm = normalizeName(p.name);
        if (pNameNorm !== nameLower && pNameNorm !== nameSinArticulo) continue;
        const member = miembroDePerfil(p, guild);
        if (member) return member.id;
    }

    for (const uname of new Set([nameLower, nameSinArticulo])) {
        // Se comparan los dos lados sin tildes: «Tonin» tiene que encontrar a «Tonín».
        const member = guild.members.cache.find(
            (m) =>
                normalizeName(m.user.username || "") === uname ||
                normalizeName(m.nickname || "") === uname ||
                normalizeName(m.displayName || "") === uname,
        );
        if (member) return member.id;
    }
    return null;
}

// Junta descripción + notas de una persona en un único texto: la descripción tiene el grueso
// del contenido (cómo tratarle, en broma qué usar) y las notas son apuntes sueltos añadidos
// después con /duende recuerda.
function buildPersonProfileText(p) {
    const piezas = [];
    if (p?.description) piezas.push(String(p.description).trim());
    if (Array.isArray(p?.notas) && p.notas.length) piezas.push(p.notas.join("; "));
    return piezas.join(" | ");
}

// Encuentra qué personas con perfil se mencionan en un mensaje: por mención real de Discord
// (<@id>) o por su nombre en el texto. Se usa para saber de quién más, aparte de quien habla,
// hay que darle el perfil completo al modelo. excludeUserId = quien habla.
function detectMentionedPersons(text, guild, excludeUserId) {
    if (!text) return [];
    const found = new Map();
    const textNorm = normalizeName(text);
    const todos = perfiles.listarPerfiles();

    for (const [, id] of text.matchAll(/<@!?(\d+)>/g)) {
        if (id === excludeUserId) continue;
        const member = guild?.members?.cache?.get(id);
        const profile = perfiles.perfilDe(member ? member.user : { id });
        if (profile) found.set(profile.key, profile);
    }

    for (const p of todos) {
        if (!p.name || (excludeUserId && p.discordId === excludeUserId)) continue;
        const nameNorm = normalizeName(p.name);
        if (!nameNorm) continue;
        const escaped = nameNorm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (new RegExp(`\\b${escaped}\\b`).test(textNorm)) found.set(p.key, p);
    }

    return [...found.values()];
}

module.exports = { mentionizeKnownNames, resolveNameToDiscordId, buildPersonProfileText, detectMentionedPersons };
