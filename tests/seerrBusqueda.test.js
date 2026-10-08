// 🔎 Búsquedas de Seerr (recomendaciones, pedidos): el texto que llega a Seerr no lleva caracteres reservados, porque Seerr
// lo reenvía a TMDB, que rechaza con 400 los títulos con ":", "&", "#", "/" o "'". Sin red: se mira la petición que saldría.
const axios = require("axios");
const guildSettings = require("../src/systems/guildSettings");
const seerrClient = require("../src/services/seerrClient");

const G = "guild-seerr-busqueda";

beforeAll(() => {
    guildSettings.setSetting(G, "seerr.url", "http://seerr.test");
    guildSettings.setSetting(G, "seerr.api_key", "clave-de-prueba");
});
afterEach(() => jest.restoreAllMocks());

function espiarBusqueda() {
    return jest.spyOn(axios, "request").mockResolvedValue({ status: 200, data: { results: [] } });
}

test("un título con ':' sale sin los dos puntos y va a /search", async () => {
    const espia = espiarBusqueda();
    await seerrClient.searchMulti(G, "Star Wars: Episode IV");
    const enviada = espia.mock.calls[0][0];
    expect(enviada.url).toMatch(/\/api\/v1\/search$/);
    expect(enviada.params.query).toBe("Star Wars Episode IV");
});

test("la consulta enviada no contiene caracteres reservados y conserva las letras", async () => {
    const espia = espiarBusqueda();
    await seerrClient.searchMulti(G, "Tom & Jerry: La #película / ¿Y tú? (2021)");
    const enviada = espia.mock.calls[0][0];
    // axios recibe la consulta en params, que el serializador de Seerr codifica al enviarla.
    expect(enviada.params.query).toBe("Tom Jerry La película Y tú 2021");
});

test("un título que no deja nada útil no hace petición", async () => {
    const espia = espiarBusqueda();
    expect(await seerrClient.searchMulti(G, " :&# ")).toEqual([]);
    expect(espia).not.toHaveBeenCalled();
});
