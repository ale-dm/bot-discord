// 🎞️ Caché de GIF del Duende: una entrada caducada se borra al guardar otra, y la caché no pasa de su tope.
const giphy = require("../src/services/giphy");

const { gifCache, guardarGif, GIF_CACHE_MAX, GIF_CACHE_TTL } = giphy.__test;

beforeEach(() => gifCache.clear());
afterEach(() => jest.useRealTimers());

test("al guardar, se borran las entradas caducadas", () => {
    jest.useFakeTimers();
    guardarGif("viejo", "https://gif/1");
    jest.advanceTimersByTime(GIF_CACHE_TTL + 1000);
    guardarGif("nuevo", "https://gif/2");
    expect([...gifCache.keys()]).toEqual(["nuevo"]);
});

test("la caché no pasa de su tope: saca la entrada más antigua", () => {
    for (let i = 0; i < GIF_CACHE_MAX + 50; i++) guardarGif(`q${i}`, `https://gif/${i}`);
    expect(gifCache.size).toBe(GIF_CACHE_MAX);
    expect(gifCache.has("q0")).toBe(false);
    expect(gifCache.has(`q${GIF_CACHE_MAX + 49}`)).toBe(true);
});
