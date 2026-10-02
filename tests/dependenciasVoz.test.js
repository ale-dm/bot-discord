// Desde marzo de 2026 Discord exige DAVE (cifrado de extremo a extremo) para entrar en un canal de voz. Con
// @discordjs/voice 0.18 (sin DAVE) la conexión nunca llegaba a Ready y /tts, /escuchar y la voz del Duende fallaban
// con "AbortError: The operation was aborted". Estos tests avisan si se vuelve a una versión sin DAVE o si la imagen
// de Docker no tiene el Node que pide.
const fs = require("fs");
const path = require("path");
const { generateDependencyReport } = require("@discordjs/voice");

const raiz = path.join(__dirname, "..");
const pkg = require("../package.json");
const version = (v) =>
    v
        .replace(/[^\d.]/g, "")
        .split(".")
        .map(Number);

test("@discordjs/voice es 0.19 o más (con DAVE) y tiene la librería de DAVE, Opus y cifrado", () => {
    const informe = generateDependencyReport();
    const [mayor, menor] = version(/@discordjs\/voice: ([\d.]+)/.exec(informe)[1]);
    expect(mayor > 0 || menor >= 19).toBe(true);
    expect(informe).toMatch(/@snazzah\/davey: \d/);
    expect(informe).toMatch(/opusscript: \d/);
    expect(informe).toMatch(/native crypto support for aes-256-gcm: yes|libsodium-wrappers: \d/);
});

test("la imagen de Docker usa un Node que cumple lo que pide package.json", () => {
    const desde = /^FROM node:(\d+)/m.exec(fs.readFileSync(path.join(raiz, "Dockerfile"), "utf8"));
    expect(desde).not.toBeNull();
    const [minimo] = version(pkg.engines.node);
    expect(Number(desde[1])).toBeGreaterThanOrEqual(minimo);
    expect(minimo).toBeGreaterThanOrEqual(22);
});
