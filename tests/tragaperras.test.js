const tragaperras = require("../src/juegos/casino/tragaperras");

describe("tragaperras calcularGanancia", () => {
    const { calcularGanancia } = tragaperras.__test;

    test("jackpot devuelve el bote pasado por override", () => {
        const resultado = calcularGanancia(["7️⃣", "7️⃣", "7️⃣"], 100, 12345);
        expect(resultado.tipo).toBe("jackpot");
        expect(resultado.multiplicador).toBe("JACKPOT");
        expect(resultado.ganancia).toBe(12345);
    });

    test("triple aplica multiplicador completo del símbolo", () => {
        const resultado = calcularGanancia(["💎", "💎", "💎"], 100);
        expect(resultado.tipo).toBe("triple");
        expect(resultado.multiplicador).toBe("x15");
        expect(resultado.ganancia).toBe(1500);
    });

    test("doble tiene mínimo x1 (nunca x0)", () => {
        const resultado = calcularGanancia(["🍒", "🍒", "🍋"], 100);
        expect(resultado.tipo).toBe("doble");
        expect(resultado.multiplicador).toBe("x1");
        expect(resultado.ganancia).toBe(100);
    });

    test("sin combinación no paga", () => {
        const resultado = calcularGanancia(["🍒", "🍋", "🍊"], 100);
        expect(resultado.tipo).toBe("perdida");
        expect(resultado.multiplicador).toBe("x0");
        expect(resultado.ganancia).toBe(0);
    });
});
