# 绑定自有域名（jeayon.com）

> **结论先行：不能直接把 `jeayon.com` 绑到这个应用上。**
> 把 A 记录改指过来，页面能打开，但登录、建团队、写日报、看甘特图——所有读写会全部失败。
> 卡点不在 DNS，在云服务数据面的跨域校验。本文记录实测依据和唯一能走的技术路径。
>
> 写于 2026-10-26。以下数据均为对线上环境的真实请求结果，不是推测。

## 1. 三个卡点

### 卡点一：没有可用的绑定入口（工具侧）

发布与应用管理两个工具的全部参数里，**没有任何一个能写入自定义域名**：

```
workbuddy_sites_deploy:  action / directory / language / port / installCmd / startCmd /
                         entryHtml / userAskedToPublish / miniProgramRequested /
                         appName / domainPrefix / appId
workbuddy_cloud_service: action / directory / applicationMode / applicationId /
                         appName / domainPrefix / intent / appType
```

`domainPrefix` 只能决定 `*.app.workbuddy.host` 的第一段，不能换成自有根域。
本机也没有 EdgeOne / 腾讯云 CLI 与凭证（`edgeone`、`tccli` 均未安装，无 `~/.tccli`）。

自定义域名只能由人在**腾讯云 EdgeOne 控制台**里添加，属于纯人工步骤。

### 卡点二：数据面按 Origin 白名单校验（这是真正的死结）

应用的页面和云服务数据面（`https://daily-work-84804.app.workbuddy.host`）目前**同源**，
所以从没触发过跨域。换成 `jeayon.com` 之后，页面去请求平台域名就是跨域。

实测两组对照（`GET / OPTIONS https://daily-work-84804.app.workbuddy.host/.cloud/database/rest/v1/teams`）：

| 请求方 Origin | OPTIONS 预检 | 实际请求 |
| --- | --- | --- |
| `https://daily-work-84804.app.workbuddy.host` | **204 No Content**，带 `Access-Control-Allow-Origin` 回显 | 401（未带登录态，属正常） |
| `https://jeayon.com` | **403 Forbidden**，**无** `Access-Control-Allow-Origin` | 401，回显该 Origin |

关键在预检那一行。SDK 的请求都带 `apikey` / `authorization` 头，属于非简单请求，
浏览器**必须先过预检**。预检 403 且没有 CORS 头，浏览器会直接判定失败，
真正的请求根本发不出去。表现就是：页面渲染出来了，点登录没反应，列表全空，控制台一片红。

这条白名单由平台按应用锁定，工具侧没有修改入口。官方对 `workbuddy_cloud_service` 的说明也印证了这点：

> Reusing the id keeps the reserved domain (and therefore the cloud-service Origin) intact;
> a brand-new app gets a different domain and the app's cloud login breaks,
> because the server enforces an exact Origin match.

即：域名 ↔ Origin 是一对一焊死的。

### 卡点三：`jeayon.com` 已被另一个站点占用

```
jeayon.com      A     216.198.79.1
jeayon.com      NS    freesia.dnspod.net / eric.dnspod.net
www.jeayon.com        Non-existent domain
https://jeayon.com    HTTP 200, Server: Vercel, X-Vercel-Cache: HIT
页面标题              NOVA OS - 成长操作系统
```

改 A/CNAME 会立刻切断 NOVA OS 的访问。这属于会影响既有线上服务的操作，**代码侧不会自动执行**。

## 2. 唯一的绕法：让页面与数据面重新同源

卡点二里有一个可用的细节：服务端对未知 Origin 的**实际请求**并不拦截（上表第三行返回 401 而非 403，且回显了 Origin），
它只在预检层做白名单。而**同源请求不触发预检**。

所以思路是：不要跨域，让 `jeayon.com/.cloud/**` 也走数据面。

```
浏览器                    EdgeOne                     源站
  │  同源请求                │                          │
  ├─ /            ─────────► ├─ 静态产物（dist）         │
  └─ /.cloud/**   ─────────► └─ 反代 ────────────────► daily-work-84804.app.workbuddy.host/.cloud/**
```

再配合构建时把数据面地址改成同源：

```dotenv
VITE_WBCS_ENDPOINT=https://jeayon.com
```

（`src/config/publicConfig.ts` 已支持该变量覆盖，无需改代码。改完必须重新 `npm run build` 再发布。）

这样页面请求 `https://jeayon.com/.cloud/...`：同源 → 无预检 → 服务端只校验 token，不校验 Origin。

**这条路径有两个尚未确认的前提**，动手前必须先验：

1. EdgeOne 是否允许对该站点配置 `/.cloud/*` 的回源规则（不是所有套餐都开放路径级回源）。
   这一条只能在控制台确认，我这边无法代查。
2. 微信登录的 OAuth 回跳域名是否需要在平台侧另行登记 `jeayon.com`。
   `redirectTo` 取的是 `window.location.origin`，未登记会被 relay 拒绝。

另一条前提**已经验证通过**——数据面不受 `?sharecode=` 门禁影响，反代回源时不需要额外带参数：

| 请求 | 结果 | 含义 |
| --- | --- | --- |
| `GET /`（页面根路径） | 403 | 受门禁保护，必须带 `?sharecode=` |
| `GET /.cloud/database/rest/v1/teams`（无 Origin、无 sharecode） | **401** | 未被门禁拦截，仅要求鉴权 |
| 同上 + `X-Forwarded-Host: jeayon.com` | 401，带 `X-Request-Id` | 回源头不影响，可正常打到后端 |

401 是「没带登录态」的正常响应，说明请求已经进了数据面，而不是被门禁挡在门外。

## 3. 如果决定要做，按这个顺序

顺序不能颠倒。先改 DNS 会同时损失 NOVA OS 和本应用。

1. **先验证第 2 节剩下那两个前提**（EdgeOne 路径级回源、微信回跳域名登记）。验不通就到此为止，别动 DNS。
   `/.cloud/**` 不受门禁影响这一点已实测通过，不用再验。
2. 在 EdgeOne 控制台为站点添加自定义域名 `jeayon.com`，拿到它给出的 CNAME 目标
   （形如 `<站点>.eo.dnse.com`，每个站点不同，**不要照抄别人的值**）。
3. 在 DNSPod 添加该 CNAME，TTL 600。**不要用线路解析/分区域解析**——这是证书签发失败最常见的原因。
4. 检查 `jeayon.com` 是否有 CAA 记录，若有必须放开 `letsencrypt.org` 与 `digicert.com`。
5. 等证书签发（一般 5–30 分钟，最长 48 小时）。
6. 用 `VITE_WBCS_ENDPOINT=https://jeayon.com` 重新构建并重新发布。
7. 跑第 4 节的验证清单。

第 2–5 步只能在控制台点，我这边没有可用的 CLI 与凭证，无法代做。

## 4. 切换后的验证清单

按顺序做，任一步失败就停下回退：

- [ ] `https://jeayon.com/?sharecode=...` 返回 200，且页面正常渲染（不是白屏）
- [ ] DevTools → Network，`/.cloud/**` 请求**没有** OPTIONS 预检，且不出现 CORS 报错
- [ ] 手机验证码登录成功，刷新后仍是登录态
- [ ] 建团队 → 建任务 → 写日报 → 甘特图能看到新任务
- [ ] 微信扫码登录往返成功（这一项在平台域名下也还没实测过）
- [ ] 换一台设备/另一个账号访问，数据互通（证明走的是云端而非本地）

## 5. 回退

改回 `jeayon.com` 的 A 记录指向 `216.198.79.1`，并在 EdgeOne 删除自定义域名，
然后用默认 endpoint 重新构建发布一次。平台分配的域名和 `sharecode` 一直保留，不受影响。

## 6. 现状与最终决定

**2026-10-26 决定：留用平台域名，不做自有域名绑定。**

理由：卡点二（数据面 Origin 白名单）无法从工具侧解除，而绕开它需要改动 EdgeOne 站的规则；
该站挂在平台账号下，用户账号无权操作。强行改 DNS 只会同时损失 `jeayon.com` 上现有的站点和本应用的登录能力。

应用当前正常运行在：

```
https://daily-work-84804.app.workbuddy.host/?sharecode=2YANPJPZ7B
```

没有绑定自有域名。这一状态与 `README.md`、`docs/acceptance.md` 的记载一致。

若将来平台开通了自定义域名或 Origin 白名单配置能力，按第 3 节的顺序重做即可——
第 2 节的数据仍然有效，可以直接复用来判断卡点是否已经消失。
