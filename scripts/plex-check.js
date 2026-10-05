// Comprueba contra el Tautulli de verdad los supuestos de los logros de Plex (docs/SIGUIENTES_PASOS.md §3), sin tocar la
// BD: idiomas que se detectan (y los que no se reconocen), bibliotecas y cuáles cuentan como anime, que la lista de
// películas pagina, la ficha de una serie con sus temporadas (y la fecha de llegada de los episodios) y las horas del
// historial contra las estadísticas de Tautulli. Solo lee.
// Uso: npm run plex:check [-- --guild <id>] [--muestra 40] [--bd data/banco.db]
// La URL y la clave de Tautulli salen de la BD (lo puesto en el panel) o, si no, de TAUTULLI_URL y TAUTULLI_API_KEY.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

process.env.LOG_CONSOLE_LEVEL = process.env.LOG_CONSOLE_LEVEL || "warn";
const { DATA_DIR } = require("../src/core/paths");

const args = process.argv.slice(2);
const opcion = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
const muestra = Math.max(5, Math.min(500, Number(opcion("--muestra")) || 40));
const bd =
    opcion("--bd") || (process.env.DB_PATH && process.env.DB_PATH !== ":memory:" ? process.env.DB_PATH : path.join(DATA_DIR, "banco.db"));

/** La configuración de Plex de la BD de verdad (solo lectura): la del servidor pedido o la del único que la tiene. */
function configDeLaBd() {
    if (!fs.existsSync(bd)) return {};
    const real = new Database(bd, { readonly: true, fileMustExist: true });
    try {
        const filas = real
            .prepare(
                "SELECT guildId, key, value FROM guild_settings WHERE key IN ('plex.tautulli_url', 'plex.tautulli_api_key', 'plex.bibliotecas_anime')",
            )
            .all();
        const porServidor = new Map();
        for (const f of filas) {
            if (!porServidor.has(f.guildId)) porServidor.set(f.guildId, {});
            porServidor.get(f.guildId)[f.key.slice(5)] = f.value;
        }
        const pedido = opcion("--guild");
        const conUrl = [...porServidor.entries()].filter(([, c]) => c.tautulli_url);
        const [guildId, cfg] = pedido ? [pedido, porServidor.get(pedido) || {}] : conUrl.length === 1 ? conUrl[0] : [null, {}];
        if (!pedido && conUrl.length > 1) console.log(`⚠ Hay ${conUrl.length} servidores con Tautulli: elige uno con --guild <id>`);
        return { guildId, ...cfg };
    } catch (e) {
        console.log(`⚠ No se pudo leer la configuración de ${bd}: ${e.message}`);
        return {};
    } finally {
        real.close();
    }
}

async function main() {
    const cfg = configDeLaBd();
    if (cfg.tautulli_url) process.env.TAUTULLI_URL = cfg.tautulli_url;
    if (cfg.tautulli_api_key) process.env.TAUTULLI_API_KEY = cfg.tautulli_api_key;
    if (!process.env.TAUTULLI_URL || !process.env.TAUTULLI_API_KEY) {
        console.log("✗ Falta Tautulli: ponlo en el panel (y pasa --bd) o en TAUTULLI_URL y TAUTULLI_API_KEY del .env");
        process.exitCode = 1;
        return;
    }
    // El bot abre su BD al cargarse (y le aplica las migraciones): aquí, una en memoria para no tocar la de verdad.
    process.env.DB_PATH = ":memory:";
    const { comprobar } = require("../src/systems/plexDiagnostico");

    console.log(`Tautulli: ${process.env.TAUTULLI_URL}${cfg.guildId ? ` (servidor ${cfg.guildId})` : ""}\n`);
    const pasos = await comprobar(null, { muestra, bibliotecasAnime: cfg.bibliotecas_anime || "" });
    for (const p of pasos) {
        console.log(`${p.ok === true ? "✓" : p.ok === false ? "✗" : "⚠"} ${p.paso}`);
        for (const l of p.lineas) console.log(`    ${l}`);
    }
    const fallos = pasos.filter((p) => p.ok === false).length;
    const avisos = pasos.filter((p) => p.ok === null).length;
    console.log(`\n${fallos ? `✗ ${fallos} con fallos` : "✓ Todo cuadra"}${avisos ? ` · ⚠ ${avisos} para mirar` : ""}`);
    if (fallos) process.exitCode = 1;
}

main().catch((e) => {
    console.error(`✗ ${e.message}`);
    process.exitCode = 1;
});
