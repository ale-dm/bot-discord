// Se ejecuta antes de cada fichero de test: BD en memoria y logs fuera del proyecto,
// para que los tests nunca toquen data/banco.db ni logs/ reales.
const os = require("os");
const path = require("path");

process.env.DB_PATH = ":memory:";
process.env.LOG_DIR = path.join(os.tmpdir(), "el-duende-test-logs");
// duende.js reescribe sus JSON (personalidades, historial) al cargarse.
process.env.DATA_DIR = path.join(os.tmpdir(), "el-duende-test-data");
// Sin salida por consola durante los tests (los logs siguen yendo a LOG_DIR).
process.env.LOG_CONSOLE_LEVEL = "off";
// Los tests no cargan el .env real, igual que en CI: ni secretos ni servicios reales.
jest.mock("dotenv", () => ({ config: () => ({ parsed: {} }), configDotenv: () => ({ parsed: {} }), parse: () => ({}) }));
