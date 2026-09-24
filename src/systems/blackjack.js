// Reglas del blackjack sin nada de Discord: baraja de 4 mazos, valor de una mano (ases como
// 1 u 11) y blackjack natural. Las usa /blackjack y los tests.

// --- Baraja real ---
function crearBaraja(numBarajas = 4) {
    const valores = [2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10, 10, 11]; // 10=J,Q,K, 11=As
    const palos = ["♠️", "♥️", "♦️", "♣️"];
    const baraja = [];
    for (let n = 0; n < numBarajas; n++) {
        for (const palo of palos) {
            for (let i = 0; i < valores.length; i++) {
                let display = valores[i];
                if (valores[i] === 11) display = "A";
                else if (valores[i] === 10 && i >= 8) display = ["J", "Q", "K"][i - 8];
                baraja.push({ value: valores[i], suit: palo, display: `${display}${palo}` });
            }
        }
    }
    return baraja;
}

function sacarCarta(baraja) {
    const idx = Math.floor(Math.random() * baraja.length);
    return baraja.splice(idx, 1)[0];
}

function handValue(hand) {
    let total = hand.reduce((sum, c) => sum + c.value, 0);
    let aces = hand.filter((c) => c.value === 11).length;
    while (total > 21 && aces > 0) {
        total -= 10;
        aces--;
    }
    return total;
}

function esBlackjack(hand) {
    return hand.length === 2 && handValue(hand) === 21;
}

module.exports = { crearBaraja, sacarCarta, handValue, esBlackjack };
