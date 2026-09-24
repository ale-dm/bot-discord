const fs = require("fs");
const os = require("os");
const path = require("path");

// Carpeta de logs propia para este fichero de test.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "el-duende-logger-"));
process.env.LOG_DIR = dir;
process.env.LOG_LEVEL = "info";
process.env.GOOGLE_API_KEY = "AIzaFAKEKEY1234567890";

const logger = require("../src/core/logger");
const { format, redact } = logger.__test;

const read = (type) => {
    try {
        return fs.readFileSync(path.join(dir, `${type}-log.txt`), "utf8");
    } catch {
        return "";
    }
};

afterAll(async () => {
    await logger.flushLogs();
});

describe("redacción de secretos", () => {
    test("oculta claves en la query de URLs", () => {
        const out = redact("GET https://api.x.com/v4/odds?apiKey=abc123&regions=eu y https://g.com/m?key=zzz");
        expect(out).not.toMatch(/abc123|zzz/);
        expect(out).toMatch(/apiKey=\*\*\*&regions=eu/);
    });

    test("oculta valores de variables de entorno secretas", () => {
        expect(redact("fallo con AIzaFAKEKEY1234567890 dentro")).toBe("fallo con *** dentro");
    });

    test("oculta secretos registrados en caliente (claves del panel)", () => {
        logger.registerSecret("clave-del-panel-999");
        expect(redact("tautulli clave-del-panel-999")).toBe("tautulli ***");
    });

    test("oculta la cabecera X-Api-Key", () => {
        expect(redact('{"X-Api-Key":"supersecreto"}')).not.toMatch(/supersecreto/);
    });
});

describe("formato", () => {
    test("los errores incluyen traza, código y causa", () => {
        const err = new Error("externo", { cause: new Error("interno") });
        err.code = 50013;
        const out = format(["falló:", err]);
        expect(out).toMatch(/falló: Error: externo/);
        expect(out).toMatch(/code=50013/);
        expect(out).toMatch(/Causado por: Error: interno/);
    });

    test("los objetos se muestran legibles, no como [object Object]", () => {
        expect(format([{ a: 1, b: "x" }])).toBe("{ a: 1, b: 'x' }");
    });

    test("recorta mensajes enormes", () => {
        const out = format(["x".repeat(50000)]);
        expect(out.length).toBeLessThan(9000);
        expect(out).toMatch(/recortado, 50000 caracteres/);
    });
});

describe("ficheros y niveles", () => {
    test("app-log tiene todo; warn/error solo lo suyo; debug no se escribe en nivel info", async () => {
        const log = logger.createLogger("Prueba");
        log.debug("mensaje-debug");
        log.info("mensaje-info");
        log.warn("mensaje-warn");
        log.error("mensaje-error", new Error("boom\nsegunda línea"));
        await logger.flushLogs();

        const app = read("app");
        expect(app).toMatch(/INFO {2}\[Prueba\] mensaje-info/);
        expect(app).toMatch(/WARN {2}\[Prueba\] mensaje-warn/);
        expect(app).toMatch(/ERROR \[Prueba\] mensaje-error/);
        expect(app).not.toMatch(/mensaje-debug/);
        expect(read("warn")).not.toMatch(/mensaje-info|mensaje-error/);
        expect(read("error")).toMatch(/mensaje-error/);

        // Cada entrada empieza por la fecha; las líneas de continuación van sangradas.
        for (const line of app.trim().split("\n")) {
            expect(line).toMatch(/^(\d{4}-\d{2}-\d{2}T| {4})/);
        }
    });

    test("setLogLevel activa debug en caliente", async () => {
        logger.setLogLevel("debug");
        logger.createLogger("Prueba").debug("ahora-si-debug");
        logger.setLogLevel("info");
        await logger.flushLogs();
        expect(read("app")).toMatch(/DEBUG \[Prueba\] ahora-si-debug/);
    });

    test("cuenta errores y avisos", () => {
        const stats = logger.getLogStats();
        expect(stats.error).toBeGreaterThanOrEqual(1);
        expect(stats.warn).toBeGreaterThanOrEqual(1);
        expect(stats.lastError.scope).toBe("Prueba");
    });
});
