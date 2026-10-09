const fs = require("fs");
const path = require("path");
// 📦 Carga de los módulos del bot: busca los ficheros .js de una carpeta (comandos, componentes, migraciones).

// src/commands solo contiene slash commands (un fichero por comando, en subcarpetas por tema).
function getAllJsFiles(dir) {
    let results = [];
    fs.readdirSync(dir).forEach((file) => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat && stat.isDirectory()) {
            results = results.concat(getAllJsFiles(filePath));
        } else if (file.endsWith(".js")) {
            results.push(filePath);
        }
    });
    return results;
}

module.exports = { getAllJsFiles };
