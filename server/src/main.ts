import { loadConfig } from './config.js';
import { buildApp } from './app.js';
const c = loadConfig(process.env);
const app = buildApp(c);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close().catch(() => { process.exitCode = 1; }); });
try { await app.listen({ host: c.HOST, port: c.PORT }); }
catch { app.log.fatal('API startup failed'); await app.close(); process.exitCode = 1; }
