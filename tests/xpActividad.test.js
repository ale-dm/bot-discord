// De dónde sale la XP (#240): mensajes (cooldown, bonus por longitud, canales ignorados) y minutos en voz (solo sin
// mute ni ensordecer, con alguien más en el canal). La BD es la de memoria (tests/setupEnv.js); lo que da XP y logros
// se simula, porque habla con Discord.
const db = require("../src/core/db");
const { ensureGuildDefaults, getConfig } = require("../src/systems/xp/config");
const { addXp } = require("../src/systems/xp/progreso");
const { handleMessageXp, handleVoiceStateUpdate, voiceTick } = require("../src/systems/xp/actividad");

jest.mock("../src/systems/xp/progreso", () => ({ addXp: jest.fn(async () => {}) }));
jest.mock("../src/systems/achievementsSystem", () => ({ applyEvent: jest.fn(async () => []) }));

const G = "g-xp-actividad";
let n = 0;
const uid = () => `xp-${++n}`;

beforeEach(() => {
    addXp.mockClear();
    ensureGuildDefaults(G);
});

function mensaje({ userId = uid(), channelId = "canal-texto", contenido = "hola", bot = false, guild = true } = {}) {
    return {
        id: `m-${n}-${Math.random()}`,
        content: contenido,
        channelId,
        author: { id: userId, bot, tag: `${userId}#0` },
        member: { id: userId },
        guild: guild ? { id: G, members: { fetch: async () => null } } : null,
    };
}

// Un estado de voz: quién está, en qué canal y si está muteado/ensordecido.
function estadoVoz({ channelId = "canal-voz", miembros = 2, selfMute = false, selfDeaf = false } = {}) {
    const humanos = Array.from({ length: miembros }, (_, i) => ({ user: { bot: false }, id: `h${i}` }));
    return {
        channelId,
        channel: { members: { filter: (fn) => ({ size: humanos.filter(fn).length }) } },
        selfMute,
        selfDeaf,
        serverMute: false,
        serverDeaf: false,
    };
}

describe("XP por mensajes", () => {
    test("un bot o un mensaje fuera de servidor no da XP", async () => {
        await handleMessageXp(mensaje({ bot: true }));
        await handleMessageXp(mensaje({ guild: false }));
        expect(addXp).not.toHaveBeenCalled();
    });

    test("un canal ignorado no da XP", async () => {
        const canal = `canal-ignorado-${n}`;
        db.prepare("INSERT INTO xp_ignored_channels (guildId, channelId) VALUES (?, ?)").run(G, canal);
        await handleMessageXp(mensaje({ channelId: canal }));
        expect(addXp).not.toHaveBeenCalled();
    });

    test("el cooldown impide dos mensajes seguidos y deja pasar el siguiente tras el tiempo", async () => {
        const u = uid();
        const cooldownMs = Number(getConfig(G, "xp_message_cooldown_sec")) * 1000;
        const ahora = Date.now();
        const spy = jest.spyOn(Date, "now");
        try {
            spy.mockReturnValue(ahora);
            await handleMessageXp(mensaje({ userId: u }));
            spy.mockReturnValue(ahora + 1000);
            await handleMessageXp(mensaje({ userId: u }));
            expect(addXp).toHaveBeenCalledTimes(1);
            spy.mockReturnValue(ahora + cooldownMs + 1);
            await handleMessageXp(mensaje({ userId: u }));
            expect(addXp).toHaveBeenCalledTimes(2);
        } finally {
            spy.mockRestore();
        }
    });

    test("un mensaje largo da más XP, con tope de bonus, y las letras repetidas no cuentan", async () => {
        const base = Number(getConfig(G, "xp_message_base"));
        const bonusMax = Number(getConfig(G, "xp_message_len_bonus_max"));
        await handleMessageXp(mensaje({ contenido: "x" }));
        const corto = addXp.mock.calls[0][2];
        expect(corto).toBe(Math.max(1, base));

        await handleMessageXp(mensaje({ contenido: "a".repeat(400) }));
        const repetido = addXp.mock.calls[1][2];
        // "aaaa…" se reduce a "aa": es como un mensaje de dos letras, no de 400.
        expect(repetido).toBe(base);

        await handleMessageXp(mensaje({ contenido: "palabra distinta ".repeat(20) }));
        const largo = addXp.mock.calls[2][2];
        expect(largo).toBe(base + bonusMax);
    });
});

describe("XP en voz", () => {
    test("entrar en un canal con alguien más empieza a contar", () => {
        const u = uid();
        handleVoiceStateUpdate({ id: u, guild: { id: G }, channelId: null }, { id: u, guild: { id: G }, ...estadoVoz() });
        const fila = db.prepare("SELECT voz_inicio FROM xp_users WHERE guildId = ? AND userId = ?").get(G, u);
        expect(fila.voz_inicio).not.toBeNull();
    });

    test("estar muteado pausa la cuenta y suma los segundos ya vividos", () => {
        const u = uid();
        const hace = Date.now() - 120_000;
        db.prepare("INSERT INTO xp_users (guildId, userId, voz_inicio) VALUES (?, ?, ?)").run(G, u, hace);
        handleVoiceStateUpdate({ id: u, guild: { id: G }, ...estadoVoz() }, { id: u, guild: { id: G }, ...estadoVoz({ selfMute: true }) });
        const fila = db.prepare("SELECT voz_inicio, voz_segundos FROM xp_users WHERE guildId = ? AND userId = ?").get(G, u);
        expect(fila.voz_inicio).toBeNull();
        expect(fila.voz_segundos).toBeGreaterThanOrEqual(119);
    });

    test("quedarse solo en el canal no cuenta", () => {
        const u = uid();
        handleVoiceStateUpdate({ id: u, guild: { id: G }, channelId: null }, { id: u, guild: { id: G }, ...estadoVoz({ miembros: 1 }) });
        const fila = db.prepare("SELECT voz_inicio FROM xp_users WHERE guildId = ? AND userId = ?").get(G, u);
        expect(fila.voz_inicio).toBeNull();
    });

    test("cambiar de canal acumula lo vivido y reinicia el contador", () => {
        const u = uid();
        const hace = Date.now() - 60_000;
        db.prepare("INSERT INTO xp_users (guildId, userId, voz_inicio) VALUES (?, ?, ?)").run(G, u, hace);
        handleVoiceStateUpdate(
            { id: u, guild: { id: G }, ...estadoVoz({ channelId: "a" }) },
            { id: u, guild: { id: G }, ...estadoVoz({ channelId: "b" }) },
        );
        const fila = db.prepare("SELECT voz_inicio, voz_segundos FROM xp_users WHERE guildId = ? AND userId = ?").get(G, u);
        expect(fila.voz_segundos).toBeGreaterThanOrEqual(59);
        expect(fila.voz_inicio).not.toBeNull();
    });
});

describe("tick de voz (cada minuto)", () => {
    function clienteCon(miembros) {
        return {
            guilds: {
                cache: {
                    get: (id) =>
                        id === G ? { id: G, members: { cache: { get: (u) => miembros[u] }, fetch: async () => null } } : undefined,
                },
            },
        };
    }

    test("quien está en voz recibe XP por los minutos vividos", async () => {
        const u = uid();
        const hace = Date.now() - 3 * 60_000;
        db.prepare("INSERT INTO xp_users (guildId, userId, voz_inicio) VALUES (?, ?, ?)").run(G, u, hace);
        const perMin = Number(getConfig(G, "xp_voice_per_min"));
        const miembro = { id: u, user: { bot: false }, voice: estadoVoz() };
        await voiceTick(clienteCon({ [u]: miembro }));
        expect(addXp).toHaveBeenCalledTimes(1);
        // Tres minutos de voz: la XP sale por minuto completo.
        expect(addXp.mock.calls[0][2]).toBe(Math.floor(3 * perMin));
    });

    test("quien ya no está en voz deja de contar", async () => {
        const u = uid();
        db.prepare("INSERT INTO xp_users (guildId, userId, voz_inicio) VALUES (?, ?, ?)").run(G, u, Date.now() - 60_000);
        await voiceTick(clienteCon({}));
        expect(db.prepare("SELECT voz_inicio FROM xp_users WHERE guildId = ? AND userId = ?").get(G, u).voz_inicio).toBeNull();
        expect(addXp).not.toHaveBeenCalled();
    });

    test("quien está en un canal ignorado no recibe XP, y se queda como está", async () => {
        const u = uid();
        const canal = `canal-ignorado-voz-${n}`;
        db.prepare("INSERT INTO xp_ignored_channels (guildId, channelId) VALUES (?, ?)").run(G, canal);
        db.prepare("INSERT INTO xp_users (guildId, userId, voz_inicio) VALUES (?, ?, ?)").run(G, u, Date.now() - 60_000);
        await voiceTick(clienteCon({ [u]: { id: u, user: { bot: false }, voice: estadoVoz({ channelId: canal }) } }));
        expect(addXp).not.toHaveBeenCalled();
    });
});
