// GIFs de Giphy del Duende: la clave se lee al cargar el módulo, así que se fija antes del require. La red se simula
// con un spy sobre fetch: no sale nada a Giphy. Se cubren los candidatos de búsqueda en orden, los tamaños de imagen,
// los fallos (timeout, red, respuesta que no es JSON), la caché por texto y su caducidad.
process.env.GIPHY_API_KEY = "clave-giphy-prueba";

const giphy = require("../src/services/giphy");
const { gifCache } = giphy.__test;

// Cada respuesta se crea al pedirla: un Response solo se puede leer una vez.
const gifRes = (images) => async () => new Response(JSON.stringify({ data: [{ images }] }), { status: 200 });
const vacia = async () => new Response(JSON.stringify({ data: [] }), { status: 200 });
const dosGifs = async () =>
    new Response(
        JSON.stringify({
            data: [{ images: { original: { url: "https://g/a.gif" } } }, { images: { original: { url: "https://g/b.gif" } } }],
        }),
    );

let fetchSpy;

beforeEach(() => {
    gifCache.clear();
    fetchSpy = jest.spyOn(global, "fetch");
});

afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
});

// El parámetro q de cada llamada a Giphy, en el orden en que se hicieron.
const consultas = () => fetchSpy.mock.calls.map(([url]) => new URL(url).searchParams.get("q"));

describe("petición a Giphy", () => {
    test("sin GIPHY_API_KEY no hace ninguna llamada y no hay GIF", async () => {
        const original = process.env.GIPHY_API_KEY;
        delete process.env.GIPHY_API_KEY;
        try {
            let sinClave;
            jest.isolateModules(() => {
                sinClave = require("../src/services/giphy");
            });
            expect(await sinClave.getGifForText("me hace mucha risa")).toBeNull();
            expect(fetchSpy).not.toHaveBeenCalled();
        } finally {
            process.env.GIPHY_API_KEY = original;
        }
    });

    test("manda la clave, el texto, 16 resultados y clasificación pg-13", async () => {
        fetchSpy.mockImplementation(gifRes({ original: { url: urlDe("risa") } }));
        await giphy.getGifForText("me hace mucha risa");
        const url = new URL(fetchSpy.mock.calls[0][0]);
        expect(url.origin + url.pathname).toBe("https://api.giphy.com/v1/gifs/search");
        expect(url.searchParams.get("api_key")).toBe("clave-giphy-prueba");
        expect(url.searchParams.get("q")).toBe("risa");
        expect(url.searchParams.get("limit")).toBe("16");
        expect(url.searchParams.get("rating")).toBe("pg-13");
    });

    test("devuelve la imagen original; si no la hay, la mediana y luego la de altura fija", async () => {
        fetchSpy.mockImplementationOnce(gifRes({ original: { url: "https://g/original.gif" } }));
        expect(await giphy.getGifForText("risa")).toBe("https://g/original.gif");

        gifCache.clear();
        fetchSpy.mockImplementationOnce(gifRes({ downsized_medium: { url: "https://g/mediana.gif" } }));
        expect(await giphy.getGifForText("risa")).toBe("https://g/mediana.gif");

        gifCache.clear();
        fetchSpy.mockImplementationOnce(gifRes({ fixed_height: { url: "https://g/alto.gif" } }));
        expect(await giphy.getGifForText("risa")).toBe("https://g/alto.gif");
    });

    test("un resultado sin ninguna URL utilizable no cuenta como GIF", async () => {
        fetchSpy.mockImplementationOnce(gifRes({}));
        fetchSpy.mockImplementationOnce(gifRes({ original: { url: "https://g/segundo.gif" } }));
        // El primer candidato ("risa") no tenía URL; el siguiente sí.
        expect(await giphy.getGifForText("me hace mucha risa")).toBe("https://g/segundo.gif");
        expect(consultas()).toEqual(["risa", "hace"]);
    });

    test("elige uno al azar entre los resultados", async () => {
        const azar = jest.spyOn(Math, "random").mockReturnValue(0.99);
        fetchSpy.mockImplementationOnce(dosGifs);
        expect(await giphy.getGifForText("risa")).toBe("https://g/b.gif");

        azar.mockReturnValue(0);
        gifCache.clear();
        fetchSpy.mockImplementationOnce(dosGifs);
        expect(await giphy.getGifForText("risa")).toBe("https://g/a.gif");
    });
});

describe("orden de los candidatos", () => {
    test("primero las palabras clave que aparecen en el texto o en la entrada", async () => {
        fetchSpy.mockImplementation(vacia);
        await giphy.getGifForText("qué perro tan molesto", "");
        // "molesto" y "perro" son palabras clave y van antes que el resto.
        expect(consultas().slice(0, 2)).toEqual(["molesto", "perro"]);
    });

    test("la palabra clave de la entrada del usuario también cuenta", async () => {
        fetchSpy.mockImplementationOnce(gifRes({ original: { url: "https://g/x.gif" } }));
        await giphy.getGifForText("respuesta sin nada", "un perro");
        expect(consultas()[0]).toBe("perro");
    });

    test("sin texto ni entrada solo prueba el último recurso «funny»", async () => {
        fetchSpy.mockImplementationOnce(gifRes({ original: { url: "https://g/funny.gif" } }));
        expect(await giphy.getGifForText(null, undefined)).toBe("https://g/funny.gif");
        expect(consultas()).toEqual(["funny"]);
    });

    test("si ningún candidato da GIF, devuelve null tras probar todos y acabar en «funny»", async () => {
        fetchSpy.mockImplementation(vacia);
        expect(await giphy.getGifForText("me hace mucha risa", "")).toBeNull();
        expect(consultas()).toEqual(["risa", "hace", "mucha", "me hace mucha risa", "funny"]);
    });

    test("un candidato repetido no se vuelve a consultar", async () => {
        fetchSpy.mockImplementation(vacia);
        await giphy.getGifForText("risa", "risa");
        expect(consultas().filter((q) => q === "risa")).toHaveLength(1);
    });
});

describe("caché por texto", () => {
    test("la misma búsqueda dentro de la caducidad no vuelve a Giphy", async () => {
        fetchSpy.mockImplementation(gifRes({ original: { url: "https://g/cacheado.gif" } }));
        expect(await giphy.getGifForText("risa")).toBe("https://g/cacheado.gif");
        expect(await giphy.getGifForText("risa")).toBe("https://g/cacheado.gif");
        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    test("pasadas seis horas la entrada caduca y se vuelve a preguntar", async () => {
        jest.useFakeTimers({ now: new Date("2026-10-10T12:00:00Z"), toFake: ["Date"] });
        fetchSpy.mockImplementation(gifRes({ original: { url: "https://g/viejo.gif" } }));
        await giphy.getGifForText("risa");
        jest.setSystemTime(new Date("2026-10-10T17:59:00Z"));
        await giphy.getGifForText("risa");
        expect(fetchSpy).toHaveBeenCalledTimes(1);

        jest.setSystemTime(new Date("2026-10-10T18:00:01Z"));
        fetchSpy.mockImplementation(gifRes({ original: { url: "https://g/nuevo.gif" } }));
        expect(await giphy.getGifForText("risa")).toBe("https://g/nuevo.gif");
        expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
});

describe("fallos de la red", () => {
    test("un timeout o una cancelación pasa al siguiente candidato", async () => {
        fetchSpy.mockRejectedValueOnce(Object.assign(new Error("tardó"), { name: "TimeoutError" }));
        fetchSpy.mockRejectedValueOnce(Object.assign(new Error("cancelada"), { name: "AbortError" }));
        fetchSpy.mockImplementationOnce(gifRes({ original: { url: "https://g/tercero.gif" } }));
        expect(await giphy.getGifForText("me hace mucha risa")).toBe("https://g/tercero.gif");
        expect(consultas()).toEqual(["risa", "hace", "mucha"]);
    });

    test("un error de red cualquiera tampoco corta la búsqueda", async () => {
        fetchSpy.mockRejectedValueOnce(new TypeError("fetch failed"));
        fetchSpy.mockImplementationOnce(gifRes({ original: { url: "https://g/recuperado.gif" } }));
        expect(await giphy.getGifForText("risa")).toBe("https://g/recuperado.gif");
    });

    test("una respuesta que no es JSON se trata como sin resultados", async () => {
        fetchSpy.mockImplementationOnce(async () => new Response("<html>502</html>", { status: 502 }));
        fetchSpy.mockImplementationOnce(gifRes({ original: { url: "https://g/tras-502.gif" } }));
        expect(await giphy.getGifForText("risa")).toBe("https://g/tras-502.gif");
    });

    test("un fallo no se guarda en caché: la siguiente vez se vuelve a pedir", async () => {
        // Texto "risa": candidatos "risa" y, al final, "funny".
        fetchSpy.mockRejectedValueOnce(new TypeError("sin red"));
        fetchSpy.mockImplementationOnce(vacia);
        expect(await giphy.getGifForText("risa")).toBeNull();
        expect(gifCache.has("giphy:risa")).toBe(false);

        fetchSpy.mockImplementationOnce(gifRes({ original: { url: "https://g/ok.gif" } }));
        expect(await giphy.getGifForText("risa")).toBe("https://g/ok.gif");
        expect(consultas()).toEqual(["risa", "funny", "risa"]);
    });
});

function urlDe(q) {
    return `https://media.giphy.test/${encodeURIComponent(q)}.gif`;
}
