// Rachas diarias (systems/xp/rachas.js), en hora de Madrid: contar los días seguidos, el bonus de XP, la racha que
// cuenta hoy y el aviso diario a quien está a punto de perderla. El reloj es simulado; la BD, la de setupEnv.js.
const db = require("../src/core/db");
const xp = require("../src/systems/xpSystem");
const rachas = require("../src/systems/xp/rachas");
const { ensureUser } = require("../src/systems/xp/config");

let n = 0;
const nuevoServidor = () => `g-rachas-${++n}`;
const UID = "u-racha";

function dia(iso) {
    jest.setSystemTime(new Date(iso));
}

function fijarRacha(guildId, userId, dias, ultimoDia) {
    ensureUser(guildId, userId);
    db.prepare("UPDATE xp_users SET streak_dias = ?, streak_last_day = ? WHERE guildId = ? AND userId = ?").run(
        dias,
        ultimoDia,
        guildId,
        userId,
    );
}

const filaRacha = (guildId, userId) =>
    db.prepare("SELECT streak_dias, streak_last_day FROM xp_users WHERE guildId = ? AND userId = ?").get(guildId, userId);

beforeEach(() => {
    jest.useFakeTimers({ now: new Date("2026-10-10T12:00:00Z") });
});

afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
});

describe("madridDateStr: el día en hora de Madrid", () => {
    test("usa el día de Madrid, que puede ser distinto del de UTC", () => {
        // Invierno (UTC+1): 23:30 UTC ya es el día siguiente en Madrid.
        expect(rachas.madridDateStr(new Date("2026-01-15T23:30:00Z"))).toBe("2026-01-16");
        // Verano (UTC+2): 22:30 UTC ya es el día siguiente en Madrid.
        expect(rachas.madridDateStr(new Date("2026-07-01T22:30:00Z"))).toBe("2026-07-02");
    });

    test("sin argumento usa la hora actual, con el límite de medianoche en Madrid", () => {
        dia("2026-10-10T21:59:59Z"); // 23:59:59 en Madrid
        expect(rachas.madridDateStr()).toBe("2026-10-10");
        dia("2026-10-10T22:00:00Z"); // 00:00 en Madrid del día 11
        expect(rachas.madridDateStr()).toBe("2026-10-11");
    });
});

describe("updateStreak: contar los días seguidos", () => {
    test("el primer mensaje del día cuenta como racha de 1 y queda guardado", () => {
        const g = nuevoServidor();

        expect(rachas.updateStreak(g, UID)).toEqual({ streakDias: 1, incremented: true });
        expect(filaRacha(g, UID)).toEqual({ streak_dias: 1, streak_last_day: "2026-10-10" });
    });

    test("más mensajes el mismo día no vuelven a sumar", () => {
        const g = nuevoServidor();
        rachas.updateStreak(g, UID);

        expect(rachas.updateStreak(g, UID)).toEqual({ streakDias: 1, incremented: false });
        expect(filaRacha(g, UID).streak_dias).toBe(1);
    });

    test("al día siguiente suma uno", () => {
        const g = nuevoServidor();
        rachas.updateStreak(g, UID);
        dia("2026-10-11T10:00:00Z");

        expect(rachas.updateStreak(g, UID)).toEqual({ streakDias: 2, incremented: true });
    });

    test("si pasa más de un día sin ganar XP, la racha vuelve a 1", () => {
        const g = nuevoServidor();
        fijarRacha(g, UID, 4, "2026-10-08");

        expect(rachas.updateStreak(g, UID)).toEqual({ streakDias: 1, incremented: true });
    });

    test("el cambio de día es a medianoche de Madrid y no a la UTC", () => {
        const g = nuevoServidor();
        dia("2026-10-10T21:59:00Z"); // 23:59 en Madrid
        rachas.updateStreak(g, UID);

        dia("2026-10-10T22:01:00Z"); // 00:01 en Madrid, día nuevo
        expect(rachas.updateStreak(g, UID)).toEqual({ streakDias: 2, incremented: true });
    });
});

describe("streakBonusPct: bonus de XP por racha", () => {
    test("sin racha no hay bonus, tampoco con días negativos", () => {
        const g = nuevoServidor();
        expect(rachas.streakBonusPct(g, 0)).toBe(0);
        expect(rachas.streakBonusPct(g, -3)).toBe(0);
    });

    test("por defecto 2% por día, con tope del 50%", () => {
        const g = nuevoServidor();
        expect(rachas.streakBonusPct(g, 3)).toBe(6);
        expect(rachas.streakBonusPct(g, 25)).toBe(50);
        expect(rachas.streakBonusPct(g, 30)).toBe(50);
    });

    test("el porcentaje por día y el tope se cambian desde la configuración", () => {
        const g = nuevoServidor();
        xp.setConfig(g, "streak_bonus_pct_per_day", "5");
        expect(rachas.streakBonusPct(g, 3)).toBe(15);

        xp.setConfig(g, "streak_bonus_cap_pct", "10");
        expect(rachas.streakBonusPct(g, 3)).toBe(10);
    });

    test("un 0 apaga el bonus y un tope negativo no baja de 0", () => {
        const g = nuevoServidor();
        xp.setConfig(g, "streak_bonus_pct_per_day", "0");
        expect(rachas.streakBonusPct(g, 5)).toBe(0);

        xp.setConfig(g, "streak_bonus_pct_per_day", "2");
        xp.setConfig(g, "streak_bonus_cap_pct", "-1");
        expect(rachas.streakBonusPct(g, 5)).toBe(0);
    });
});

describe("getEffectiveStreak: la racha que cuenta hoy", () => {
    test("sin racha, o con la última de hace más de un día, es 0", () => {
        const g = nuevoServidor();
        expect(rachas.getEffectiveStreak(g, UID)).toBe(0);

        fijarRacha(g, UID, 7, "2026-10-08");
        expect(rachas.getEffectiveStreak(g, UID)).toBe(0);
    });

    test("cuenta si la última vez fue hoy o ayer", () => {
        const g = nuevoServidor();
        fijarRacha(g, UID, 7, "2026-10-09");
        expect(rachas.getEffectiveStreak(g, UID)).toBe(7);

        fijarRacha(g, UID, 7, "2026-10-10");
        expect(rachas.getEffectiveStreak(g, UID)).toBe(7);
    });
});

describe("sendDm: el DM no debe romper el flujo", () => {
    test("devuelve true cuando el mensaje sale", async () => {
        const send = jest.fn(async () => {});
        const client = { users: { fetch: jest.fn(async () => ({ send })) } };

        await expect(rachas.sendDm(client, UID, { content: "hola" })).resolves.toBe(true);
        expect(client.users.fetch).toHaveBeenCalledWith(UID);
        expect(send).toHaveBeenCalledWith({ content: "hola" });
    });

    test("con los DMs cerrados (50007) devuelve false sin lanzar", async () => {
        const client = {
            users: {
                fetch: jest.fn(async () => ({
                    send: async () => {
                        throw Object.assign(new Error("Cannot send messages to this user"), { code: 50007 });
                    },
                })),
            },
        };

        await expect(rachas.sendDm(client, UID, {})).resolves.toBe(false);
    });

    test("cualquier otro error también devuelve false", async () => {
        const client = {
            users: {
                fetch: jest.fn(async () => {
                    throw new Error("Unknown User");
                }),
            },
        };

        await expect(rachas.sendDm(client, UID, {})).resolves.toBe(false);
    });
});

describe("buildStreakContinuedEmbed", () => {
    test("muestra los días seguidos y el bonus redondeado al entero", () => {
        const embed = rachas.buildStreakContinuedEmbed({ name: "Servidor Uno" }, 4, 4.6).data;

        expect(embed.title).toBe("🔥 ¡Racha activa!");
        expect(embed.description).toContain("**4 días seguidos**");
        expect(embed.description).toContain("Servidor Uno");
        expect(embed.fields[0].value).toBe("+5% XP");
    });
});

describe("runStreakWarningJob: aviso a quien va a perder la racha", () => {
    test("avisa solo a quien llevaba 2 o más días seguidos y hoy aún no ha ganado XP", async () => {
        const G1 = nuevoServidor();
        const G2 = nuevoServidor(); // el bot ya no está en este servidor
        const G3 = nuevoServidor(); // avisos apagados
        fijarRacha(G1, "a", 3, "2026-10-09"); // avisa
        fijarRacha(G1, "b", 1, "2026-10-09"); // racha de 1: no
        fijarRacha(G1, "c", 5, "2026-10-08"); // ya la perdió: no
        fijarRacha(G1, "d", 4, "2026-10-10"); // hoy ya ganó XP: no
        fijarRacha(G2, "e", 4, "2026-10-09"); // servidor no visible: no
        fijarRacha(G3, "f", 2, "2026-10-09"); // avisos apagados: no
        fijarRacha(G1, "g", 2, "2026-10-09"); // tiene los DMs cerrados
        xp.setConfig(G3, "streak_enabled", "0");

        const send = jest.fn(async () => {});
        const fetch = jest.fn(async (id) => {
            if (id === "g") throw Object.assign(new Error("closed"), { code: 50007 });
            return { send };
        });
        const client = {
            guilds: {
                cache: new Map([
                    [G1, { id: G1, name: "Uno" }],
                    [G3, { id: G3, name: "Tres" }],
                ]),
            },
            users: { fetch },
        };

        await rachas.runStreakWarningJob(client);

        const avisados = fetch.mock.calls.map(([id]) => id);
        expect(avisados.sort()).toEqual(["a", "g"]);
        expect(send).toHaveBeenCalledTimes(1);
        const embed = send.mock.calls[0][0].embeds[0].data;
        expect(embed.description).toContain("**3 días**");
        expect(embed.description).toContain("Uno");
    });

    test("sin nadie a quien avisar no llama a Discord", async () => {
        const fetch = jest.fn();
        await rachas.runStreakWarningJob({ guilds: { cache: new Map() }, users: { fetch } });
        expect(fetch).not.toHaveBeenCalled();
    });
});
