// Caché de módulo con tope (#216): echa la más antigua al pasarse y caduca por tiempo si se pide.
const { CacheLimitada } = require("../src/core/cacheLimitada");

describe("CacheLimitada", () => {
    test("no pasa de su tope: se echa la entrada más antigua", () => {
        const c = new CacheLimitada({ max: 2 });
        c.set("a", 1).set("b", 2).set("c", 3);
        expect(c.size).toBe(2);
        expect(c.has("a")).toBe(false);
        expect(c.get("b")).toBe(2);
        expect(c.get("c")).toBe(3);
    });

    test("volver a guardar una clave la deja la más nueva", () => {
        const c = new CacheLimitada({ max: 2 });
        c.set("a", 1).set("b", 2);
        c.set("a", 10);
        c.set("c", 3);
        expect(c.has("b")).toBe(false);
        expect(c.get("a")).toBe(10);
    });

    test("un valor null o 0 cuenta como guardado", () => {
        const c = new CacheLimitada({ max: 3 });
        c.set("escudo", null).set("n", 0);
        expect(c.has("escudo")).toBe(true);
        expect(c.get("escudo")).toBeNull();
        expect(c.get("n")).toBe(0);
    });

    test("delete quita la entrada", () => {
        const c = new CacheLimitada({ max: 3 });
        c.set("a", 1);
        expect(c.delete("a")).toBe(true);
        expect(c.has("a")).toBe(false);
    });

    test("con ttlMs, una entrada caducada no se devuelve y se borra", () => {
        const ahora = jest.spyOn(Date, "now");
        try {
            const c = new CacheLimitada({ max: 3, ttlMs: 1000 });
            ahora.mockReturnValue(0);
            c.set("a", 1);
            ahora.mockReturnValue(999);
            expect(c.get("a")).toBe(1);
            ahora.mockReturnValue(1000);
            expect(c.get("a")).toBeUndefined();
            expect(c.size).toBe(0);
        } finally {
            ahora.mockRestore();
        }
    });

    test("un máximo que no es positivo se rechaza", () => {
        expect(() => new CacheLimitada({ max: 0 })).toThrow();
        expect(() => new CacheLimitada({})).toThrow();
    });
});
