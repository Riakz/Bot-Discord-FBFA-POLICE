import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

export function loadEnv({ verbose = false } = {}) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const botRoot = join(__dirname, '..', '..');
  const botEnv = join(botRoot, '.env');
  const projectRoot = dirname(botRoot);
  const rootEnv = join(projectRoot, '.env');

  if (verbose) {
    console.log('[ENV][debug] __dirname =', __dirname);
    console.log('[ENV][debug] botRoot   =', botRoot);
    console.log('[ENV][debug] botEnv    =', botEnv, 'exists =', existsSync(botEnv));
    console.log('[ENV][debug] rootEnv   =', rootEnv, 'exists =', existsSync(rootEnv));
  }

  if (existsSync(botEnv)) {
    dotenv.config({ path: botEnv });
    if (verbose) console.log('[ENV] Loaded from bot:', botEnv);
    sanitizeAndAlias({ verbose });
    return 'bot';
  }
  if (existsSync(rootEnv)) {
    dotenv.config({ path: rootEnv });
    if (verbose) console.log('[ENV] Loaded from root:', rootEnv);
    sanitizeAndAlias({ verbose });
    return 'root';
  }
  dotenv.config();
  if (verbose) console.warn('[ENV] No .env found, relying on process.env');
  sanitizeAndAlias({ verbose });
  return 'none';
}

function sanitizeAndAlias({ verbose = false } = {}) {
  const clean = (v) => (v ? v.replace(/^['"]|['"]$/g, '').trim() : v);

  const keys = ['DISCORD_TOKEN', 'CLIENT_ID', 'GUILD_ID', 'TICKET_CATEGORY_ID', 'STAFF_ROLE_ID'];
  for (const k of keys) {
    if (process.env[k]) process.env[k] = clean(process.env[k]);
  }

  const aliases = [
    { from: 'DISCORD_BOT_TOKEN', to: 'DISCORD_TOKEN' },
    { from: 'BOT_TOKEN', to: 'DISCORD_TOKEN' },
    { from: 'TOKEN', to: 'DISCORD_TOKEN' },
    { from: 'DISCORD_CLIENT_ID', to: 'CLIENT_ID' },
    { from: 'APPLICATION_ID', to: 'CLIENT_ID' },
    { from: 'APP_ID', to: 'CLIENT_ID' },
    { from: 'CLIENTID', to: 'CLIENT_ID' },
    { from: 'GUILD', to: 'GUILD_ID' },
    { from: 'SERVER_ID', to: 'GUILD_ID' },
  ];

  for (const { from, to } of aliases) {
    const v = clean(process.env[from]);
    if (!process.env[to] && v) {
      process.env[to] = v;
      if (verbose) console.log(`[ENV] Alias applied: ${from} -> ${to}`);
    }
  }
}
