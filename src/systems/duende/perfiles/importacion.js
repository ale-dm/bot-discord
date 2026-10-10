// Importación de los JSON antiguos del Duende (personalidades, perfiles y personalidad de cada canal) a la BD.
const fs = require("fs");
const path = require("path");
const db = require("../../../core/db");
const { createLogger } = require("../../../core/logger");
const { DATA_DIR } = require("../../../core/paths");
const { MAX_NOTAS } = require("./lectura");
const {
    PERSONALIDADES_INICIALES,
    obtenerPersonalidad,
    guardarPersonalidad,
    personalidadDeCanal,
    asignarPersonalidadCanal,
} = require("./personalidades");

const log = createLogger("Duende");

function leerJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (e) {
        log.error(`${path.basename(file)} no es un JSON válido; no se importa:`, e.message);
        return null;
    }
}

/**
 * Importa data/duende-personalities.json y data/duende-config.json si existen (una vez: después
 * se renombran a .importado) y crea las personalidades por defecto si no hay ninguna.
 */
function importarJsonSiExiste() {
    const filePers = path.join(DATA_DIR, "duende-personalities.json");
    const fileCfg = path.join(DATA_DIR, "duende-config.json");

    if (fs.existsSync(filePers)) {
        const datos = leerJson(filePers);
        if (datos) {
            let np = 0;
            let nf = 0;
            db.transaction(() => {
                for (const p of Array.isArray(datos.personalities) ? datos.personalities : []) {
                    if (!p?.id || !p.systemInstructions || obtenerPersonalidad(p.id)) continue;
                    guardarPersonalidad({
                        id: String(p.id),
                        title: String(p.title || p.id),
                        systemInstructions: String(p.systemInstructions),
                    });
                    np++;
                }
                const existe = db.prepare("SELECT 1 FROM duende_perfiles WHERE lower(username) = lower(?)");
                const insert = db.prepare(
                    "INSERT INTO duende_perfiles (discord_id, username, nombre, descripcion, notas, actualizado_en) VALUES (NULL, ?, ?, ?, ?, ?)",
                );
                for (const p of Array.isArray(datos.persons) ? datos.persons : []) {
                    if (!p?.id || existe.get(String(p.id))) continue;
                    const notas = Array.isArray(p.notas) ? p.notas.map(String).slice(-MAX_NOTAS) : [];
                    insert.run(
                        String(p.id),
                        String(p.name || p.id),
                        p.description ? String(p.description) : null,
                        JSON.stringify(notas),
                        Date.now(),
                    );
                    nf++;
                }
            })();
            fs.renameSync(filePers, filePers + ".importado");
            log.info(`Importadas ${np} personalidades y ${nf} perfiles de ${path.basename(filePers)} (renombrado a .importado)`);
        }
    }

    if (fs.existsSync(fileCfg)) {
        const cfg = leerJson(fileCfg);
        if (cfg && typeof cfg === "object") {
            let n = 0;
            for (const [channelId, pid] of Object.entries(cfg)) {
                if (!pid || personalidadDeCanal(channelId)) continue;
                asignarPersonalidadCanal(channelId, String(pid));
                n++;
            }
            fs.renameSync(fileCfg, fileCfg + ".importado");
            log.info(`Importadas ${n} personalidades de canal de ${path.basename(fileCfg)} (renombrado a .importado)`);
        }
    }

    if (!db.prepare("SELECT 1 FROM duende_personalidades LIMIT 1").get()) {
        for (const p of PERSONALIDADES_INICIALES) guardarPersonalidad(p);
    }
}

module.exports = { importarJsonSiExiste };
