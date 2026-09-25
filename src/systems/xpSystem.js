// Sistema de XP y niveles. Las piezas están en systems/xp/: config (configuración, títulos, fórmula y
// canales ignorados), rachas, roles (recompensas y anuncio de nivel), progreso (ganar XP, perfil,
// ranking y ajustes manuales) y actividad (XP por mensajes y voz). Aquí se juntan para que el resto
// del bot siga usando `require("systems/xpSystem")`.
const config = require("./xp/config");
const rachas = require("./xp/rachas");
const roles = require("./xp/roles");
const progreso = require("./xp/progreso");
const actividad = require("./xp/actividad");

module.exports = {
    ensureGuildDefaults: config.ensureGuildDefaults,
    getConfig: config.getConfig,
    getAllConfig: config.getAllConfig,
    setConfig: config.setConfig,
    xpForNextLevel: config.xpForNextLevel,
    getUserCostMultiplier: config.getUserCostMultiplier,
    setUserCostMultiplier: config.setUserCostMultiplier,
    removeUserCostMultiplier: config.removeUserCostMultiplier,
    titleForLevel: config.titleForLevel,
    nextTitle: config.nextTitle,
    getTitles: config.getTitles,
    getIgnoredChannels: config.getIgnoredChannels,
    addIgnoredChannel: config.addIgnoredChannel,
    removeIgnoredChannel: config.removeIgnoredChannel,
    clearIgnoredChannels: config.clearIgnoredChannels,
    handleMessageXp: actividad.handleMessageXp,
    handleVoiceStateUpdate: actividad.handleVoiceStateUpdate,
    voiceTick: actividad.voiceTick,
    getProfile: progreso.getProfile,
    getTop: progreso.getTop,
    getLevelHistory: progreso.getLevelHistory,
    addXp: progreso.addXp,
    adjustUserXp: progreso.adjustUserXp,
    resetUser: progreso.resetUser,
    getRewards: roles.getRewards,
    setRewardDescription: roles.setRewardDescription,
    setReward: roles.setReward,
    removeReward: roles.removeReward,
    backfillRoles: roles.backfillRoles,
    runStreakWarningJob: rachas.runStreakWarningJob,
    getEffectiveStreak: rachas.getEffectiveStreak,
    streakBonusPct: rachas.streakBonusPct,
};
