// Arranca el servidor Vosk para desarrollo local (npm run start:vosk / npm start).
// Usa el Python de vosk/.venv si existe (lo crea `npm run stt:setup`); si no, el del sistema.
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { ROOT, MODELS_DIR } = require("../src/core/paths");

const venvPython =
    process.platform === "win32"
        ? path.join(ROOT, "vosk", ".venv", "Scripts", "python.exe")
        : path.join(ROOT, "vosk", ".venv", "bin", "python");
const python = fs.existsSync(venvPython) ? venvPython : "python";
const model = process.env.VOSK_MODEL_PATH || path.join(MODELS_DIR, "vosk-model-small-es-0.42");
const port = process.env.VOSK_PORT || "5001";

if (!fs.existsSync(model)) {
    console.error(`No está el modelo de Vosk en ${model}. Ejecuta: npm run stt:setup`);
    process.exit(1);
}

const child = spawn(python, [path.join(ROOT, "vosk", "server.py"), "--model", model, "--port", port], { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
