import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { parseDocument } from 'yaml';
type Service = { image?: string; environment?: Record<string, string>; ports?: string[]; profiles?: string[]; read_only?: boolean; healthcheck?: {test: string[]}; networks?: unknown; command?: string[] };
describe('deployment static checks (Docker not executed)', () => {
  it('parses Compose YAML and checks internal database, role separation and pinned images', async () => {
    const yaml = parseDocument(await readFile(new URL('../../deploy/docker-compose.yml', import.meta.url), 'utf8'));
    assert.deepEqual(yaml.errors, []);
    const compose = yaml.toJS() as { services: Record<string, Service>; networks: Record<string, {internal?: boolean}> };
    assert.deepEqual(Object.keys(compose.services).sort(), ['api', 'backup', 'caddy', 'migrate', 'postgres']);
    assert.equal(compose.services.postgres!.ports, undefined);
    assert.equal(compose.services.api!.ports, undefined);
    assert.equal(compose.networks.database!.internal, true);
    assert.equal(compose.services.api!.read_only, true);
    assert.ok(compose.services.api!.environment!.DATABASE_URL!.includes('runtime'));
    for (const key of ['POSTGRES_PASSWORD', 'MIGRATION_DATABASE_URL', 'API_DB_PASSWORD', 'BACKUP_DB_PASSWORD']) assert.equal(compose.services.api!.environment![key], undefined);
    for (const service of ['postgres', 'caddy', 'backup']) assert.match(compose.services[service]!.image!, /@sha256:[0-9a-f]{64}$/);
    assert.ok(compose.services.api!.healthcheck!.test.join(' ').includes('/api/health/ready'));
    assert.deepEqual(compose.services.migrate!.command, ['node', 'dist/db/migrate.js']);
  });
  it('production and staging reserve API .3, Caddy .2 and trust only Caddy', async () => {
    const production = parseDocument(await readFile(new URL('../../deploy/docker-compose.yml', import.meta.url), 'utf8')).toJS();
    const staging = parseDocument(await readFile(new URL('../../deploy/docker-compose.staging.yml', import.meta.url), 'utf8')).toJS();
    const edge = parseDocument(await readFile(new URL('../../deploy/docker-compose.edge.yml', import.meta.url), 'utf8')).toJS();
    for (const [api, caddy] of [[production.services.api, production.services.caddy], [staging.services.api, edge.services.caddy]]) {
      assert.equal(api.networks.edge?.ipv4_address, '172.30.240.3');
      assert.equal(caddy.networks.edge.ipv4_address, '172.30.240.2');
      assert.equal(api.environment.TRUST_PROXY_CIDR, '172.30.240.2/32');
    }
  });
  it('staging requires an explicit APP_ORIGIN without an HTTP fallback', async () => {
    const staging = await readFile(new URL('../../deploy/docker-compose.staging.yml', import.meta.url), 'utf8');
    const compose = parseDocument(staging).toJS();
    assert.equal(compose.services.api.environment.APP_ORIGIN, '${APP_ORIGIN:?Set APP_ORIGIN}');
    assert.doesNotMatch(staging, /APP_ORIGIN[^\n]*http:\/\//);
  });
  it('acceptance request keeps credentials out of local and remote argv offline', () => {
    const result = JSON.parse(execFileSync('python3', [new URL('../scripts/password-fix-r3-offline-check.py', import.meta.url).pathname], { encoding: 'utf8' }));
    assert.equal(result.argv_credentials_absent, true);
    assert.equal(result.offline, true);
  });
  it('staging only trusts the fixed edge Caddy address and never publishes the API port', async () => {
    const staging = parseDocument(await readFile(new URL('../../deploy/docker-compose.staging.yml', import.meta.url), 'utf8')).toJS();
    const edge = parseDocument(await readFile(new URL('../../deploy/docker-compose.edge.yml', import.meta.url), 'utf8')).toJS();
    assert.equal(staging.services.api.ports, undefined);
    assert.equal(staging.services.api.environment.TRUST_PROXY_CIDR, '172.30.240.2/32');
    assert.deepEqual(Object.keys(staging.services.api.networks), ['edge', 'database']);
    // Reserve API .3 so Docker cannot allocate Caddy's trusted .2 during API-first startup.
    assert.equal(staging.services.api.networks.edge.ipv4_address, '172.30.240.3');
    assert.equal(edge.services.caddy.networks.edge.ipv4_address, '172.30.240.2');
    assert.equal(staging.networks.edge.name, edge.networks.edge.name);
    assert.equal(staging.networks.edge.ipam.config[0].subnet, '172.30.240.0/24');
    assert.equal(edge.networks.edge.external, true);
  });
  it('Caddy preserves API prefix, returns asset 404s and serves the configured apex domain', async () => {
    const caddy = await readFile(new URL('../../deploy/Caddyfile', import.meta.url), 'utf8');
    // www has no DNS record; the deployed Caddyfile intentionally serves only the apex.
    assert.match(caddy, /^jeayon\.com \{/);
    assert.ok(!caddy.includes('www.jeayon.com'));
    assert.match(caddy, /@api path \/api \/api\/\*/);
    assert.match(caddy, /handle @api\s*\{[\s\S]*?reverse_proxy api:8787/);
    assert.ok(!caddy.includes('handle_path'));
    const assets = caddy.match(/handle \/assets\/\* \{([^}]+)\}/)![1]!;
    assert.ok(!assets.includes('try_files'));
  });
  it('Dockerfile builds compiled JS separately and runs as the node user', async () => {
    const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
    assert.equal((dockerfile.match(/^FROM /gm) ?? []).length, 2);
    assert.match(dockerfile, /USER node/);
    assert.match(dockerfile, /npm ci --omit=dev/);
    assert.match(dockerfile, /COPY --from=build/);
    const ignored = await readFile(new URL('../.dockerignore', import.meta.url), 'utf8');
    assert.ok(ignored.includes('.env\n'));
  });
  it('backup and database-init shell scripts pass bash syntax checks', () => {
    execFileSync('bash', ['-n', new URL('../../deploy/backup.sh', import.meta.url).pathname, new URL('../../deploy/init-db.sh', import.meta.url).pathname]);
  });
});
