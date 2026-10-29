import { createDb } from './index.js';
import { migrate } from './migrator.js';
const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!url) throw new Error('MIGRATION_DATABASE_URL or DATABASE_URL required');
const db = createDb(url);
try { console.log((await migrate(db)).map(r => `${r.migrationName}: ${r.status}`).join('\n') || 'Migrations already current'); }
finally { await db.destroy(); }
