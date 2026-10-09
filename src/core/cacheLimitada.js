/**
 * Mapa con tope de entradas para cachés de módulo (#216). Al pasarse del tope se echa la entrada más antigua
 * (la primera en entrar o en volver a guardarse). Con `ttlMs`, una entrada caducada no se devuelve.
 *
 * Tiene la misma forma que Map para lo que usa el bot: get, set, has, delete y size.
 */
class CacheLimitada {
    constructor({ max, ttlMs = null }) {
        if (!(max > 0)) throw new Error("CacheLimitada necesita un máximo mayor que 0");
        this.max = max;
        this.ttlMs = ttlMs;
        this.entradas = new Map();
    }

    get size() {
        return this.entradas.size;
    }

    has(clave) {
        const entrada = this.entradas.get(clave);
        if (!entrada) return false;
        if (this.ttlMs != null && Date.now() - entrada.ts >= this.ttlMs) {
            this.entradas.delete(clave);
            return false;
        }
        return true;
    }

    get(clave) {
        return this.has(clave) ? this.entradas.get(clave).valor : undefined;
    }

    set(clave, valor) {
        // Borrar antes de volver a meter: así la entrada que se acaba de guardar pasa a ser la más nueva.
        this.entradas.delete(clave);
        this.entradas.set(clave, { valor, ts: Date.now() });
        while (this.entradas.size > this.max) this.entradas.delete(this.entradas.keys().next().value);
        return this;
    }

    delete(clave) {
        return this.entradas.delete(clave);
    }
}

module.exports = { CacheLimitada };
