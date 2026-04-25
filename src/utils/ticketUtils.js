function formatLine(m) {
    const ts = new Date(m.createdTimestamp).toISOString();
    const author = m.author?.tag || m.author?.id || 'unknown';
    let content = (m.content || '').normalize('NFC');
    if (m.attachments?.size) {
        const files = Array.from(m.attachments.values()).map((a) => a.url).join(' ');
        content += (content ? ' ' : '') + files;
    }
    return `[${ts}] ${author}: ${content}`;
}

export async function buildTranscript(channel) {
    let lastId;
    const all = [];
    while (true) {
        const fetched = await channel.messages.fetch({ limit: 100, before: lastId }).catch(() => null);
        if (!fetched || fetched.size === 0) break;
        for (const msg of Array.from(fetched.values())) all.push(msg);
        lastId = fetched.last().id;
        if (all.length > 1000) break;
    }
    all.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    const lines = all.map((m) => formatLine(m));
    return lines.join('\r\n');
}

export function extractMeta(topic, key) {
    const match = topic.match(new RegExp(`${key}:([^\\s]+)`));
    return match ? match[1] : null;
}

export function setMeta(topic, key, value) {
    const regex = new RegExp(`${key}:[^\\s]+`);
    if (regex.test(topic)) {
        return topic.replace(regex, `${key}:${value}`);
    }
    return `${topic} ${key}:${value}`.trim();
}
