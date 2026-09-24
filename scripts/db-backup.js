// Copia de seguridad de la BD ahora mismo (la misma que hace el bot cada día a las 04:30).
// Uso: npm run db:backup   · Se puede lanzar con el bot en marcha.
require("dotenv").config();
const { hacerBackup, listarBackups, BACKUP_DIR } = require("../src/systems/backups");

hacerBackup()
    .then((r) => {
        console.log(`✓ ${r.fichero} (${(r.bytes / 1024).toFixed(0)} KB) en ${BACKUP_DIR}`);
        console.log(
            `  Copias guardadas: ${listarBackups()
                .map((b) => b.fichero)
                .join(", ")}`,
        );
        return require("../src/core/logger").flushLogs();
    })
    .catch((e) => {
        console.error("✗ No se pudo hacer la copia:", e.message);
        process.exitCode = 1;
    });
