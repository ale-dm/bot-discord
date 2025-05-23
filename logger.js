// logger.js

const fs = require('fs');
const path = require('path');

// Función para registrar errores en un archivo de log
function logError(errorMessage) {
    const logPath = path.join(__dirname, 'error-log.txt');
    
    // Crear una marca de tiempo para el error
    const timestamp = new Date().toISOString();
    
    // Crear el mensaje del error con la fecha y hora
    const logMessage = `[${timestamp}] - ${errorMessage}\n`;
    
    // Escribir el error en el archivo de log
    fs.appendFile(logPath, logMessage, (err) => {
        if (err) {
            console.error("Error al escribir en el archivo de log:", err);
        } else {
            console.log("Error registrado en el archivo de log.");
        }
    });
}

// Exportar la función para usarla en otros archivos
module.exports = {
    logError
};
