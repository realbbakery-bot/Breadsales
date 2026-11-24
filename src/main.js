// Entry point.
//   Single bakery:  ADMIN_PASSWORD=... npm start
//   Many bakeries:  OWNER_PASSWORD=... npm start   (each bakery served on its own domain)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './server.js';
import { createPlatform } from './platform.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
const trustProxy = process.env.TRUST_PROXY === '1';
const port = Number(process.env.PORT) || 3000;

let handler;
if (process.env.OWNER_PASSWORD) {
  const platform = createPlatform({ dataDir, ownerPassword: process.env.OWNER_PASSWORD, trustProxy });
  handler = platform.handler;
  // Daily snapshot of every bakery, kept for 14 days, in DATA_DIR/backups/.
  const backup = () => {
    try {
      const dir = path.join(dataDir, 'backups');
      platform.backupAll(path.join(dir, new Date().toISOString().slice(0, 10)));
      for (const old of fs.readdirSync(dir).sort().slice(0, -14)) fs.rmSync(path.join(dir, old), { recursive: true, force: true });
    } catch (e) { console.error('[breadsales] backup failed', e); }
  };
  setTimeout(backup, 60_000);
  setInterval(backup, 24 * 3600 * 1000);
  console.log(`[breadsales] Hosting ${platform.registry.list().length} bakeries. Owner console: http://localhost:${port}/`);
} else {
  handler = createApp({
    dbFile: path.join(dataDir, 'bakery.db'),
    uploadsDir: path.join(dataDir, 'uploads'),
    adminPassword: process.env.ADMIN_PASSWORD,
    trustProxy,
  }).handler;
  console.log(`[breadsales] Shop: http://localhost:${port}/  ·  Dashboard: http://localhost:${port}/admin`);
}

http.createServer(handler).listen(port);
