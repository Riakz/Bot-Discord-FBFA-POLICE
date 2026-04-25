import { getGuildConfig, updateGuildConfig } from './guildConfig.js';

export function getLogChannel(guildId, type) {
    const config = getGuildConfig(guildId);
    return config.logs ? config.logs[type] : null;
}

export function setLogChannel(guildId, type, channelId) {
    updateGuildConfig(guildId, {
        logs: {
            [type]: channelId
        }
    });
}

export function getAllLogConfig(guildId) {
    const config = getGuildConfig(guildId);
    return config.logs || {};
}
