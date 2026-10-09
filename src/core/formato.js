// Formato de números para los mensajes: separador de miles en español. Vacío o no numérico cuenta como 0.
const fmtNumero = (n) => Number(n || 0).toLocaleString("es");

module.exports = { fmtNumero };
