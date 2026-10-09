// Rutas del proyecto en un solo sitio. Antes cada módulo las calculaba por su cuenta
// (relativas a su propia carpeta o al directorio de trabajo), así que mover un fichero
// o arrancar desde otra carpeta rompía dónde se leían/escribían los datos.
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");

module.exports = {
    ROOT,
    // Datos persistentes (BD y JSON del Duende). En Docker es un volumen.
    DATA_DIR: process.env.DATA_DIR || path.join(ROOT, "data"),
    // Logs. En Docker es un volumen.
    LOGS_DIR: process.env.LOG_DIR || path.join(ROOT, "logs"),
    // Modelos de Vosk (STT).

    // Un fichero .js por slash command, agrupados en subcarpetas por tema.
    COMMANDS_DIR: path.join(ROOT, "src", "commands"),
    // Juegos y apuestas: no son comandos (se entra por /juegos), pero sus botones se registran igual.
    JUEGOS_DIR: path.join(ROOT, "src", "juegos"),
    // Botones de /perfil que no son de un comando (dinero: ingresar, sacar, transferir...).
    PERFIL_DIR: path.join(ROOT, "src", "perfil"),
};
