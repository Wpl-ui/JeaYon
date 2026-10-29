import { createDb } from './index.js';
import { maintain } from './maintenance.js';
const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error('Maintenance requires explicit owner MIGRATION_DATABASE_URL; never use the runtime API role');
const db = createDb(url);
try { console.log(JSON.stringify(await maintain(db))); }
finally { await db.destroy(); }
