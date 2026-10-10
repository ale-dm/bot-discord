// /imagen (#239): descarga de adjuntos de referencia (fetch simulado), validación de tipo y tamaño, reintentos de la
// API de imagen, mensajes de error según la causa, cooldown por persona y la respuesta con el fichero adjunto.
// Las constantes del módulo se leen al cargarlo, así que el entorno se fija antes del require.
process.env.GOOGLE_API_KEY = "clave-de-prueba";
process.env.IMAGE_GEN_RETRY_BASE_MS = "1";
process.env.IMAGE_GEN_MAX_RETRIES = "2";
process.env.IMAGE_GEN_TIMEOUT_MS = "80";

const imagen = require("../src/commands/duende/imagen");

const cliente = { user: { displayAvatarURL: () => "https://cdn.test/bot.png" } };
const API = "generativelanguage.googleapis.com";
let n = 0;

function adjunto(nombre, { tipo = "image/png", size = 1024 } = {}) {
    return { name: nombre, contentType: tipo, size, url: `https://cdn.test/${nombre}` };
}

function interaccion({ descripcion = "un gato astronauta", estilo = null, adjuntos = {}, id = `img-${++n}` } = {}) {
    return {
        user: { id, tag: `artista${n}#0001`, username: `artista${n}` },
        deferReply: jest.fn(async () => {}),
        editReply: jest.fn(async () => {}),
        options: {
            getString: (k) => (k === "descripcion" ? descripcion : k === "estilo" ? estilo : null),
            getAttachment: (k) => adjuntos[k] ?? null,
        },
    };
}

const respuestaImagen = (mimeType = "image/png") =>
    new Response(
        JSON.stringify({
            candidates: [{ content: { parts: [{ inlineData: { data: Buffer.from("pixeles").toString("base64"), mimeType } }] } }],
        }),
        { status: 200 },
    );
const respuestaSinImagen = () =>
    new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "no puedo" }] }, finishReason: "STOP" }] }), { status: 200 });
const descarga = () => new Response(Buffer.from("bytes-de-referencia"), { status: 200 });

// Enruta fetch: las descargas de adjuntos van a cdn.test y las llamadas a la API a Google.
function rutas({ api = [], descargas = () => descarga() } = {}) {
    let turno = 0;
    return jest.spyOn(global, "fetch").mockImplementation(async (url, opciones) => {
        if (String(url).includes(API)) {
            const r = api[Math.min(turno++, api.length - 1)];
            if (typeof r === "function") return r(opciones);
            if (r instanceof Error) throw r;
            return r;
        }
        return descargas(url);
    });
}

afterEach(() => {
    jest.restoreAllMocks();
});

describe("definición del comando", () => {
    test("se llama imagen, con descripción obligatoria, cinco adjuntos y ocho estilos", () => {
        expect(imagen.data.name).toBe("imagen");
        const opciones = imagen.data.options;
        expect(opciones.find((o) => o.name === "descripcion").required).toBe(true);
        expect(opciones.filter((o) => /^imagen[1-5]$/.test(o.name))).toHaveLength(5);
        expect(opciones.find((o) => o.name === "estilo").choices).toHaveLength(8);
    });
});

describe("generación sin adjuntos", () => {
    test("genera la imagen y la adjunta con el texto de cabecera", async () => {
        const f = rutas({ api: [respuestaImagen()] });
        const i = interaccion({ estilo: "anime style, manga, vibrant colors, cel-shaded" });
        await imagen.run(cliente, i);
        const payload = i.editReply.mock.calls.at(-1)[0];
        expect(payload.content).toContain("🎨 **Imagen generada**");
        expect(payload.content).toContain("🖌️ Estilo: anime style");
        expect(payload.files).toHaveLength(1);
        expect(payload.files[0].name).toBe("imagen_generada.png");
        const cuerpo = JSON.parse(f.mock.calls.find(([u]) => String(u).includes(API))[1].body);
        expect(cuerpo.contents[0].parts[0].text).toContain("Estilo: anime style, manga");
    });

    test("un tipo de imagen que no sea png usa su propia extensión", async () => {
        rutas({ api: [respuestaImagen("image/bmp")] });
        const i = interaccion();
        await imagen.run(cliente, i);
        expect(i.editReply.mock.calls.at(-1)[0].files[0].name).toBe("imagen_generada.bmp");
    });

    test("sin clave de API avisa y no genera nada", async () => {
        jest.resetModules();
        const saved = process.env.GOOGLE_API_KEY;
        delete process.env.GOOGLE_API_KEY;
        try {
            const sinClave = require("../src/commands/duende/imagen");
            const f = rutas({ api: [respuestaImagen()] });
            const i = interaccion();
            await sinClave.run(cliente, i);
            expect(i.editReply.mock.calls[0][0].content).toContain("no está configurada");
            expect(f).not.toHaveBeenCalled();
        } finally {
            process.env.GOOGLE_API_KEY = saved;
        }
    });
});

describe("adjuntos de referencia", () => {
    test("descarga cada adjunto y lo manda a la API en base64 con su tipo", async () => {
        const f = rutas({ api: [respuestaImagen()] });
        const i = interaccion({ adjuntos: { imagen1: adjunto("a.jpg", { tipo: "image/jpeg" }), imagen2: adjunto("b.png") } });
        await imagen.run(cliente, i);
        expect(i.editReply.mock.calls.at(-1)[0].content).toContain("Imágenes de referencia: 2");
        const cuerpo = JSON.parse(f.mock.calls.find(([u]) => String(u).includes(API))[1].body);
        const refs = cuerpo.contents[0].parts.filter((p) => p.inlineData);
        expect(refs).toHaveLength(2);
        expect(refs[0].inlineData.mimeType).toBe("image/jpeg");
        expect(Buffer.from(refs[0].inlineData.data, "base64").toString()).toBe("bytes-de-referencia");
    });

    test("un adjunto que no es imagen se rechaza antes de generar", async () => {
        const f = rutas({ api: [respuestaImagen()] });
        const i = interaccion({ adjuntos: { imagen1: adjunto("notas.txt", { tipo: "text/plain" }) } });
        await imagen.run(cliente, i);
        expect(i.editReply.mock.calls[0][0].content).toContain("no es una imagen válida");
        expect(f).not.toHaveBeenCalled();
    });

    test("un adjunto de más de 10 MB se rechaza", async () => {
        rutas({ api: [respuestaImagen()] });
        const i = interaccion({ adjuntos: { imagen1: adjunto("enorme.png", { size: 11 * 1024 * 1024 }) } });
        await imagen.run(cliente, i);
        expect(i.editReply.mock.calls[0][0].content).toContain("supera los 10 MB");
    });

    test("si una descarga falla, se avisa con el mensaje genérico", async () => {
        rutas({ api: [respuestaImagen()], descargas: () => new Response("", { status: 404 }) });
        const i = interaccion({ adjuntos: { imagen1: adjunto("perdida.png") } });
        await imagen.run(cliente, i);
        expect(i.editReply.mock.calls.at(-1)[0].content).toContain("Hubo un error");
    });
});

describe("reintentos de la API", () => {
    test("un 503 se reintenta y la segunda vez llega la imagen", async () => {
        const f = rutas({ api: [new Response("saturado", { status: 503 }), respuestaImagen()] });
        const i = interaccion();
        await imagen.run(cliente, i);
        expect(f.mock.calls.filter(([u]) => String(u).includes(API))).toHaveLength(2);
        expect(i.editReply.mock.calls.at(-1)[0].files).toHaveLength(1);
    });

    test("un 503 que no se resuelve nunca dice que el servicio está saturado", async () => {
        // Una Response solo se puede leer una vez: cada reintento recibe la suya.
        rutas({ api: [() => new Response("saturado", { status: 503 })] });
        const i = interaccion();
        await imagen.run(cliente, i);
        expect(i.editReply.mock.calls.at(-1)[0].content).toContain("saturado");
    });

    test("si la API responde sin imagen dos veces seguidas, se avisa del fallo", async () => {
        rutas({ api: [respuestaSinImagen()] });
        const i = interaccion();
        await imagen.run(cliente, i);
        expect(i.editReply.mock.calls.at(-1)[0].content).toContain("Hubo un error");
    });

    test("si la API responde sin imagen y luego sí, sale bien", async () => {
        rutas({ api: [respuestaSinImagen(), respuestaImagen()] });
        const i = interaccion();
        await imagen.run(cliente, i);
        expect(i.editReply.mock.calls.at(-1)[0].files).toHaveLength(1);
    });

    test("un bloqueo de contenido no se reintenta y se explica con el aviso de seguridad", async () => {
        const f = rutas({
            api: [new Response(JSON.stringify({ promptFeedback: { blockReason: "SAFETY" } }), { status: 200 })],
        });
        const i = interaccion();
        await imagen.run(cliente, i);
        expect(f.mock.calls.filter(([u]) => String(u).includes(API))).toHaveLength(1);
        expect(i.editReply.mock.calls.at(-1)[0].content).toContain("filtros de seguridad");
    });

    test("un error HTTP que no es de saturación no se reintenta", async () => {
        const f = rutas({ api: [new Response("petición mala", { status: 400 })] });
        const i = interaccion();
        await imagen.run(cliente, i);
        expect(f.mock.calls.filter(([u]) => String(u).includes(API))).toHaveLength(1);
    });
});

describe("mensajes de error", () => {
    async function fallaCon(error) {
        rutas({ api: [error] });
        const i = interaccion();
        await imagen.run(cliente, i);
        return i.editReply.mock.calls.at(-1)[0].content;
    }

    test("cada causa tiene su aviso", async () => {
        expect(await fallaCon(new Error("blocked by policy"))).toContain("filtros de seguridad");
        expect(await fallaCon(new Error("resource_exhausted"))).toContain("cuota");
        expect(await fallaCon(new Error("model not found: foo"))).toContain("no está disponible");
    });

    test("un tiempo agotado de la API se explica con el plazo", async () => {
        rutas({
            api: [
                (opciones) =>
                    new Promise((_resolve, reject) => {
                        opciones.signal.addEventListener("abort", () => reject(opciones.signal.reason));
                    }),
            ],
        });
        const i = interaccion();
        await imagen.run(cliente, i);
        expect(i.editReply.mock.calls.at(-1)[0].content).toContain("tardó demasiado");
    });

    test("si tampoco se puede avisar del error, no se rompe", async () => {
        rutas({ api: [new Error("algo raro")] });
        const i = interaccion();
        i.editReply.mockRejectedValue(new Error("Discord caído"));
        await expect(imagen.run(cliente, i)).resolves.toBeUndefined();
    });
});

describe("cooldown", () => {
    test("una segunda imagen seguida de la misma persona se rechaza", async () => {
        rutas({ api: [respuestaImagen()] });
        await imagen.run(cliente, interaccion({ id: "persona-cooldown-img" }));
        const otra = interaccion({ id: "persona-cooldown-img" });
        await imagen.run(cliente, otra);
        expect(otra.editReply.mock.calls[0][0].content).toMatch(/Espera \*\*\d+s\*\*/);
    });

    test("un error libera el cooldown para volver a intentarlo", async () => {
        rutas({ api: [new Error("algo raro"), respuestaImagen()] });
        await imagen.run(cliente, interaccion({ id: "persona-liberada" }));
        const segunda = interaccion({ id: "persona-liberada" });
        await imagen.run(cliente, segunda);
        expect(segunda.editReply.mock.calls.at(-1)[0].files).toHaveLength(1);
    });
});
