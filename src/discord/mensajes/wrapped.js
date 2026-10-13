// La imagen del Plex Wrapped como adjunto de un DM (#472).
const { AttachmentBuilder } = require("discord.js");

/** Los adjuntos del DM: la imagen si hay, o ninguno. */
const adjuntoWrapped = (buf) => (buf ? [new AttachmentBuilder(buf, { name: "wrapped.png" })] : []);

module.exports = { adjuntoWrapped };
