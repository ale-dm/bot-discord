// `npm start` en desarrollo: arranca el servidor de voz (Vosk) y el bot con una salida limpia,
// una línea por evento y el origen a la izquierda. Sustituye a concurrently + npm run anidados,
// que añadían varias cabeceras por proceso.
//
//   voz │ Vosk listo · vosk-model-small-es-0.42 · 0,3 s · 127.0.0.1:5001
//   bot │ ✓ 31 comandos registrados en Discord
//   bot │ ✓ Conectado como El Duende#5790 · 1 servidor
//
// Ctrl+C para todo de forma ordenada. Si uno de los dos se cae, se para el otro.
const path = require("path");
const readline = require("readline");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const LABELS = { voz: paint("36", " voz"), bot: paint("32", " bot") };
const SEP = paint("90", " │ ");

// El bot formatea sus logs de consola en modo compacto y con colores (ver core/logger.js).
const env = { ...process.env, LOG_PRETTY: "1", PYTHONIOENCODING: "utf-8", ...(color ? { FORCE_COLOR: "1" } : {}) };

const children = new Set();
let stopping = false;

function run(name, script, args = []) {
    const child = spawn(process.execPath, [path.join(ROOT, script), ...args], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
    children.add(child);
    for (const stream of [child.stdout, child.stderr]) {
        readline.createInterface({ input: stream }).on("line", (line) => {
            if (line.trim()) process.stdout.write(`${LABELS[name]}${SEP}${line}\n`);
        });
    }
    return new Promise((resolve) =>
        child.on("exit", (code) => {
            children.delete(child);
            resolve(code ?? 0);
        }),
    );
}

// porSenal: Ctrl+C ya le llega directamente a cada hijo (comparten consola) y cada uno se cierra
// ordenadamente; matarlos desde aquí lo impediría (en Windows kill() es inmediato). Solo se les
// manda la señal cuando el cierre lo provoca otro motivo (p. ej. se ha caído el bot).
function stopAll(code, porSenal = false) {
    if (stopping) return;
    stopping = true;
    if (!porSenal) for (const c of children) c.kill("SIGINT");
    // Si algo no se cierra en 6 s, se fuerza.
    setTimeout(() => {
        for (const c of children) c.kill("SIGKILL");
        process.exit(code);
    }, 6000).unref();
    const wait = () => {
        if (children.size) return setTimeout(wait, 100);
        if (porSenal) process.stdout.write(`${paint("90", " ───")}${SEP}${paint("90", "parado")}\n`);
        process.exit(code);
    };
    wait();
}

process.on("SIGINT", () => stopAll(0, true));
process.on("SIGTERM", () => stopAll(0, true));

(async () => {
    const voz = run("voz", "scripts/start-vosk.js");
    voz.then((code) => {
        if (!stopping) {
            process.stdout.write(
                `${LABELS.voz}${SEP}${paint("33", `el servidor de voz se ha parado (código ${code}); el bot sigue sin /escuchar`)}\n`,
            );
        }
    });

    const registro = await run("bot", "src/core/registerCommands.js");
    if (registro !== 0) {
        process.stdout.write(`${LABELS.bot}${SEP}${paint("31", "no se pudieron registrar los comandos; el bot no arranca")}\n`);
        return stopAll(registro);
    }
    const bot = await run("bot", "src/index.js");
    stopAll(bot);
})();
