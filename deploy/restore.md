# Deployment and restore / 部署与恢复

This backend has native PostgreSQL 16 test coverage. Docker, Caddy/ACME, Tencent delivery and an actual restore have **not** been executed here. The frontend is unchanged and still needs its separately authorized migration/build before going live.
本后端已用原生 PG16 测试；本机没有 Docker，尚未运行容器、Caddy/ACME、真实腾讯发送或恢复演练。前端未改动，正式上线前还需另行完成前端迁移和构建。

## First deployment / 首次部署

1. Prepare `deploy/.env` from `.env.example`, mode 0600, with independent random passwords/secrets. URL-encode database passwords in connection URLs. Only the PostgreSQL container receives bootstrap credentials; `api` gets the runtime URL; `migrate` gets the DDL URL. The subnet `172.30.240.0/24` must be unused; if changing it, change Caddy's fixed address and `TRUST_PROXY_CIDR` together.
   从示例准备真实 `.env`，权限 0600。独立生成口令/密钥，连接 URL 中密码需编码。网络地址如冲突，必须同步调整代理信任地址。
2. Point `jeayon.com` and `www.jeayon.com` DNS to the deployment host, allow inbound 80/443, verify outbound ACME/Tencent connectivity. Caddy obtains HTTPS certificates automatically. Confirm mainland registration/access requirements before public launch.
   配置两个域名的 DNS、80/443 和出站网络；Caddy 自动申请 HTTPS 证书。备案和接入条件须在上线前确认。
3. The static mount expects **already built** `app/dist`. No frontend build or cloud-SDK replacement is performed by these deployment files. After that work is approved/completed, run from `deploy/`:
   静态挂载要求已有构建完成的 `app/dist`；本批部署文件不修改或构建前端。在前端工作完成后执行：

   ```sh
   export PATH=/opt/node24/bin:$PATH
   docker compose config --quiet
   docker compose build api
   docker compose up -d postgres
   docker compose --profile tools run --rm migrate
   docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -f /opt/dwa/grant-runtime.sql'
   docker compose run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
   docker compose up -d api caddy
   curl --fail https://jeayon.com/api/health/ready
   ```

4. Init scripts only run on a **new empty volume**. Existing PostgreSQL must have roles/schema ownership provisioned explicitly; these scripts do not repair existing production roles. Reapply runtime grants after future migrations. Do not give `dwa_api` ownership, schema CREATE, superuser, BYPASSRLS or migrator membership. Backup uses `dwa_backup`, with read-only grants. Runtime API cannot change migration records.
   初始化脚本只处理新空卷。已有库必须单独配置角色和 schema 所有权；后续迁移后重授运行权限。API 禁止拥有 DDL/owner/超级用户能力；备份角色只读。

## Daily backups / 每日备份

`backup.sh` supports native PG16 clients using `PGHOST`, `PGDATABASE`, `PGUSER`, `PGPASSFILE`, `BACKUP_DIR`; no URI/password is put in argv or success logs. Alternatively use the `backup` Compose tools profile. Create `deploy/backup.pgpass` (0600) with the actual `dwa_backup` password, libpq format `postgres:5432:dwa:dwa_backup:<password>` (escape `:` and `\` inside the password). This file and backups are gitignored.
脚本可用原生 PG16 客户端，也可运行 Compose backup 工具。创建 0600 的 `backup.pgpass`，填入真实备份口令并遵守 libpq 转义；文件和备份均被忽略。

```sh
export PATH=/opt/node24/bin:$PATH
# First manual backup and verification, on a Docker-capable host:
docker compose --profile tools run --rm backup
# Verify the resulting checksum and archive directory before scheduling.
```

Host cron (substitute the actual absolute deployment directory), with protected log rotation:
在主机 cron 中替换实际路径，并配置受限日志与日志轮转：

```cron
CRON_TZ=Asia/Shanghai
0 3 * * * cd /absolute/project/deploy && docker compose --profile tools run --rm backup >> /restricted/log/dwa-backup.log 2>&1
```

The script locks against overlap, writes `.partial`, verifies `pg_restore --list`, renames only after success, writes SHA256, and retains completed files for 7 days by default. An optional native `BACKUP_UPLOAD_HOOK` executable can encrypt/upload/verify; no upload is configured and no paid service is called. Expired completed files are removed only after the current backup and configured upload hook succeed. Partial failures remain for inspection. Monitor disk space and backup freshness.
脚本防重入、先写 partial、验目录、成功后改名和生成校验和，默认保留七天。可选上传 hook 必须加密、上传且验证；默认不上传、不调用付费服务。失败 partial 留供检查；监控磁盘与最后成功时间。

A `pg_dump` archive contains one database, not cluster roles, secrets, image digests or infrastructure. Keep role/grant scripts, pinned images and protected configuration recovery materials separately. Offsite encrypted copies and monthly restore drills remain operational work; worst-case RPO is 24 hours, RTO must be measured.
单库 dump 不包含集群角色、密钥或基础设施；这些恢复资料须单独安全保存。异机加密副本和每月恢复演练需运维落实。RPO 最坏 24 小时，RTO 尚须实测。

## Restore into a new database / 恢复到新库

1. Pause API writes and take a fresh backup. Preserve the original database/volume. Provision a **new PG16 database/volume** and the same role separation. Do not restore over the source and do not use `--clean`.
   暂停写入并新备份；保留旧库/卷，在新库恢复，不覆盖旧库、不使用 `--clean`。
2. Check archive provenance, checksum and `pg_restore --list`. Use protected libpq environment/pgpass pointing at the **new** database. Restore as its intended owner:
   校验来源、checksum 和目录。用指向新库的受限连接配置，以预期 owner 执行：

   ```sh
   export PATH=/opt/node24/bin:$PATH
   # In the backup directory, with real filenames substituted:
   sha256sum --check <backup.dump.sha256>
   pg_restore --list <backup.dump>
   pg_restore --exit-on-error --no-owner --no-privileges --dbname=<new_database_name> <backup.dump>
   ```

3. Reapply `grant-runtime.sql` to the **restored database**. Verify the migration history includes all migrations (`001_auth`, `002_business`, `003_task_indexes`), identity sequences, row counts, unique constraints/FKs, and runtime-role restrictions. A custom archive normally restores sequence values; imported explicit IDs require a separately reviewed sequence adjustment.
   对恢复库重授权限，核对全部迁移、序列、行数、唯一/FK 约束和运行角色权限。显式 ID 导入另行检查序列。
4. Before allowing API traffic, as the restored database owner, revoke all restored sessions and invalidate pending OTPs; keep historical hashes/audit data so no FK history is destroyed:
   接入流量前，以恢复库 owner 撤销所有恢复会话和未使用验证码，保留历史 hash/审计：

   ```sql
   BEGIN;
   UPDATE sessions SET revoked_at=coalesce(revoked_at,now()), revoke_reason='restore';
   UPDATE otp_codes SET state='superseded' WHERE state IN ('pending','sent');
   COMMIT;
   ```

5. Validate health and owner/admin/member/outsider permissions on the restored API, check historical task/log rows, verify a newly authorized login, then obtain the explicit cutover approval before changing production connection configuration. Keep rollback access to the old database. Do not run real email/SMS tests without approved recipients/configuration.
   验证新库的健康、权限、历史数据和新登录，经明确切换授权后才变更生产连接。保留回退路径，真实邮件/短信需另行授权。

## References / 依据

- [Caddy API + SPA patterns](https://caddyserver.com/docs/caddyfile/patterns)
- [Compose health dependency semantics](https://docs.docker.com/compose/how-tos/startup-order/)
- [PostgreSQL 16 pg_dump](https://www.postgresql.org/docs/16/app-pgdump.html)
