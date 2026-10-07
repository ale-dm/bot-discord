// 📊 Resumen semanal para admins (F-AD-02, issue #38): errores y comandos de la semana sacados de ficheros de log de
// verdad (en una carpeta temporal), uso de Gemini desde el resumen anterior, créditos de la Odds API, el DM de los lunes
// a quien recibe las alertas (una vez por semana) y la vista previa del panel.
const fs = require("fs");
const os = require("os");
const path = require("path");

const usoGemini = { llamadas: 0, errores: 0, cuotaAgotada: 0, tokensEntrada: 0, tokensSalida: 0 };
jest.mock("../src/services/geminiClient", () => ({
    ...jest.requireActual("../src/services/geminiClient"),
    getUsage: () => ({ ...usoGemini }),
}));
const alertas = require("../src/systems/alertas");
const resumen = require("../src/systems/resumenAdmin");
const paneladmin = require("../src/commands/admin/paneladmin");

// Lunes 12 de octubre de 2026 a las 09:30 en Madrid (07:30 UTC).
const LUNES = Date.UTC(2026, 9, 12, 7, 30);
const hace = (dias, horas = 0) => new Date(LUNES - (dias * 24 + horas) * 3600 * 1000).toISOString();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "el-duende-resumen-"));
const escribir = (fichero, lineas) => fs.writeFileSync(path.join(dir, fichero), lineas.join("\n") + "\n");

escribir("error-log.1.txt", [
    `${hace(9)} ERROR [Casino] Error antiguo, de hace 9 días`,
    `${hace(6)} ERROR [Apuestas] Falló el partido 1234`,
    "    at algo (fichero.js:10:5)",
]);
escribir("error-log.txt", [
    `${hace(3)} ERROR [Apuestas] Falló el partido 98765`,
    `${hace(2)} ERROR [Tienda] No se pudo comprar`,
    `${hace(1)} ERROR [Apuestas] Falló el partido 5`,
]);
escribir("app-log.txt", [
    `${hace(8)} INFO  [Comando] /perfil · ana (1) en #general @ S · 10 ms`,
    `${hace(5)} INFO  [Comando] /juegos seccion=casino · ana (1) en #general @ S · 20 ms`,
    `${hace(4)} INFO  [Comando] /perfil · luis (2) en #general @ S · 15 ms`,
    `${hace(4)} INFO  [Comando] /perfil usuario=@ana · pepe (3) en #general @ S · 12 ms`,
    `${hace(3)} INFO  [Comando] /juegos denegado por ACL de /juegos · pepe (3) en #otro @ S · ⛔`,
    `${hace(2)} INFO  [Componente] botón juegos_casino · ana (1) en #general @ S · 5 ms`,
    `${hace(1)} ERROR [Comando] /tienda falló · ana (1) en #general @ S · 30 ms`,
]);

test("errores de la semana agrupados (el mismo con otros números es uno) y sin los de antes", () => {
    const e = resumen.errores(LUNES - 7 * 86400 * 1000, dir);
    expect(e).toEqual({
        total: 4,
        lista: [
            { texto: "[Apuestas] Falló el partido #", veces: 3 },
            { texto: "[Tienda] No se pudo comprar", veces: 1 },
        ],
        principioPerdido: false,
    });
});

test("comandos más usados de la semana: solo los que terminaron bien", () => {
    expect(resumen.comandos(LUNES - 7 * 86400 * 1000, dir)).toEqual({
        total: 3,
        lista: [
            { comando: "perfil", veces: 2 },
            { comando: "juegos", veces: 1 },
        ],
        principioPerdido: false,
    });
});

test("si ya se han borrado logs rotados y no queda nada anterior a la semana, se avisa de que puede faltar", () => {
    const otro = fs.mkdtempSync(path.join(os.tmpdir(), "el-duende-resumen-rotado-"));
    fs.writeFileSync(path.join(otro, "app-log.5.txt"), `${hace(2)} INFO  [Comando] /ping · ana (1) en #g @ S · 1 ms\n`);
    fs.writeFileSync(path.join(otro, "app-log.txt"), `${hace(1)} INFO  [Comando] /ping · ana (1) en #g @ S · 1 ms\n`);
    expect(resumen.comandos(LUNES - 7 * 86400 * 1000, otro)).toMatchObject({ total: 2, principioPerdido: true });
    expect(resumen.construir(LUNES, { dir: otro }).data.fields.at(-1)).toMatchObject({ name: "ℹ️ Logs" });
});

test("Gemini: desde el arranque la primera vez, y desde el resumen anterior después", async () => {
    Object.assign(usoGemini, { llamadas: 40, errores: 2, cuotaAgotada: 1, tokensEntrada: 12000, tokensSalida: 3000 });
    expect(resumen.usoGemini(0)).toMatchObject({ llamadas: 40, errores: 2, desdeArranque: true });
    const campo = (embed) => embed.data.fields.find((f) => f.name === "🤖 Gemini").value;
    expect(campo(resumen.construir(LUNES, { dir }))).toMatch(
        /^40 llamadas · 2 errores \(1 por cuota\) · tokens 12\.000 de entrada \/ 3000 de salida\n_Desde el arranque del bot/,
    );
});

describe("el DM de los lunes", () => {
    const user = { send: jest.fn(async () => {}) };
    const client = {
        guilds: { cache: new Map([["g", { id: "g", ownerId: "dueño" }]]) },
        users: { fetch: jest.fn(async () => user) },
    };
    beforeAll(() => alertas.iniciar(client));
    afterAll(() => alertas._reiniciar());

    test("solo los lunes desde las 09:00 de Madrid, una vez por semana, a quien recibe las alertas", async () => {
        expect(await resumen.enviarSiToca(client, LUNES - 3600 * 1000, { dir })).toBe(0); // 08:30
        expect(await resumen.enviarSiToca(client, LUNES + 86400 * 1000, { dir })).toBe(0); // martes
        expect(user.send).not.toHaveBeenCalled();

        expect(await resumen.enviarSiToca(client, LUNES, { dir })).toBe(1);
        expect(client.users.fetch).toHaveBeenCalledWith("dueño");
        const embed = user.send.mock.calls[0][0].embeds[0].data;
        expect(embed.title).toBe("📊 Resumen semanal del bot");
        expect(embed.fields.map((f) => f.name)).toEqual([
            "❌ Errores: 4",
            "⌨️ Comandos más usados: 3 en total",
            "🤖 Gemini",
            "⚽ Odds API",
        ]);
        expect(embed.fields[0].value).toBe("• 3× [Apuestas] Falló el partido #\n• 1× [Tienda] No se pudo comprar");
        expect(embed.fields[1].value).toBe("1. `/perfil` · 2\n2. `/juegos` · 1");
        expect(embed.fields[3].value).toBe("Sin consultar desde el arranque.");

        // Una hora después (o tras reiniciar), nada.
        expect(await resumen.enviarSiToca(client, LUNES + 3600 * 1000, { dir })).toBe(0);
        expect(user.send).toHaveBeenCalledTimes(1);

        // La semana siguiente, Gemini cuenta solo lo nuevo.
        usoGemini.llamadas = 55;
        expect(await resumen.enviarSiToca(client, LUNES + 7 * 86400 * 1000, { dir })).toBe(1);
        const gemini = user.send.mock.calls[1][0].embeds[0].data.fields.find((f) => f.name === "🤖 Gemini").value;
        expect(gemini).toMatch(/^15 llamadas · 0 errores/);
        expect(gemini).not.toMatch(/arranque/);
    });
});

test("/paneladmin → 🩺 Sistema → 🔔 Alertas → 📊 Resumen semanal enseña cómo va, solo a quien lo pulsa", async () => {
    const alertasPantalla = {
        guildId: "g",
        guild: { id: "g", ownerId: "dueño" },
        customId: "paneladmin_sis_alertas",
        user: { id: "admin", tag: "admin" },
        member: { permissions: { has: () => true } },
        reply: jest.fn(async () => {}),
        update: jest.fn(async () => {}),
    };
    await paneladmin.handleButton(null, alertasPantalla);
    const botones = alertasPantalla.update.mock.calls[0][0].components.flatMap((r) => r.toJSON().components.map((c) => c.custom_id));
    expect(botones).toContain("paneladmin_sis_resumen");

    const vista = { ...alertasPantalla, customId: "paneladmin_sis_resumen", reply: jest.fn(async () => {}) };
    await paneladmin.handleButton(null, vista);
    const r = vista.reply.mock.calls[0][0];
    expect(r.flags).toBeTruthy();
    expect(r.embeds[0].data.title).toBe("📊 Resumen semanal del bot");
});
