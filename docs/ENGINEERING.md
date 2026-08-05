# 工程與部署 / Engineering and deployment

這份文件描述 AisleStage v0.6 restricted release foundation 的公開工程合約。實際帳戶、資源名稱、identifier、URL、secret、使用者資料及營運記錄不屬於 repository 內容。

## Runtime map

```text
React SPA
  -> Cloudflare Static Assets
  -> public `/` + Access-protected `/app*`
  -> /api/* Worker routes
       -> signed Access JWT validation
       -> D1 metadata and authorization
       -> private R2 source/output objects
       -> CampaignAgent Durable Object
       -> Generation Queue
            -> deterministic SVG composition
            -> optional background provider in assisted mode
```

`wrangler.jsonc` 是可公開、不可直接部署的結構模板。應用程式只依賴 `DB`、`MEDIA_BUCKET`、`GENERATION_QUEUE`、`CAMPAIGN_AGENT`、`ASSETS` 這些 generic binding 名稱。

`worker-env.d.ts` 由以下命令生成並納入型別檢查：

```bash
npm run cf:types
npm run cf:types:check
```

## Server-side modes

| 變數 | 值 | 行為 |
| --- | --- | --- |
| `AUTH_MODE` | `access` | 正式模式；每個受保護 API 驗證 Access JWT 與 D1 membership |
|  | `password` | 只供本機、隔離測試或遷移相容 |
| `ACCESS_AUTO_PROVISION` | `disabled` | 只綁定既有 active account |
|  | `enabled` | 只為已通過 Access allow policy 的新身份建立 beta workspace |
| `REGISTRATION_MODE` | `closed` | 只容許已有帳號登入 |
|  | `invite` | 需要電郵綁定的一次性邀請碼 |
|  | `open` | 只供受控本機／隔離環境 |
| `GENERATION_MODE` | `disabled` | 不接受建立輸出 |
|  | `deterministic` | 不接觸模型，建立確定性 SVG |
|  | `assisted` | 只有其餘 approval gates 全部通過時才可使用外部 provider |
| `AGENT_MODE` | `deterministic` | 固定規則規劃三個輸出 |
|  | `assisted` | 只有全域 assisted policy 通過時，模型才可更新摘要與理由；仍需人工批准 |
| `ASSISTED_PROVIDER` | `disabled` | 不選擇外部 AI provider |
| `ASSISTED_DATA_POLICY` | `disabled` | 私人資料不可離開確定性路徑 |
| `ASSISTED_EVALUATION` | `disabled` | assisted 評估未批准 |
| `ASSISTED_BUDGET_MODE` | `disabled` | 付費推理與相關預算未批准 |
| `MAX_ACTIVE_GENERATIONS_PER_WORKSPACE` | `3` | 每個 workspace 最多三個 reserved Queue outputs |

目前 adapter 的 credential 是 Worker-side secret。只有 `GENERATION_MODE=assisted`、provider allowlist、資料政策、固定評估、預算及 secret 六項全部通過時才會使用。結構化回應會再由本機 validator 核對完整 schema；拒絕、缺漏或無效 JSON 會 fail closed。

## Authentication and workspace boundary

- 公開 `/` 與私人 `/app` 分開；正式 Access policy 亦保護受保護 API；
- Static Assets 對 `/app` 及 `/app/*` 採 Worker-first；Access 模式先完成 JWT 與 active D1 membership 驗證，才經 `ASSETS` binding 返回 no-store 的 SPA shell；
- Worker 以 remote JWKS 驗證 RS256、issuer、audience、有效期、subject 與電郵；
- Access subject 只保存單向 hash，身份與帳戶不符時 fail closed；
- password endpoint 在 Access 模式停用，避免雙重登入或繞過 edge identity；
- 密碼以 PBKDF2 衍生 hash；session token 只保存 SHA-256 hash；
- session cookie 為 HttpOnly、SameSite=Lax，非本機環境加上 Secure；
- 所有 state-changing API 會核對 same-origin／fetch metadata；
- active user 必須同時擁有 active workspace membership；
- 無權資產與輸出一律返回 not found，避免跨 workspace 枚舉；
- 登入／註冊短期限制只保存電郵與來源 IP 的單向 key；
- 定期 trigger 清理過期 session 與短期驗證記錄。

## Campaign Agent lifecycle

```text
idle -> needs-input -> awaiting-approval -> approved
```

前端修改任何商業欄位或商品圖時，現有計劃立即在 UI 失效。Worker 在建立 Campaign Pack 前仍會獨立檢查：

1. 目前 Agent state 是 `approved`；
2. revision 完全相同；
3. sanitized brief 與批准版本逐項相同；
4. 三個 workflow／比例均在批准計劃內；
5. 商品 asset 屬於目前 workspace。

## Atomic Campaign Pack

`POST /api/campaign-packs` 接受一個 client-generated idempotency key，以及 1–3 個已批准輸出。正式 UI 固定提交 1:1、4:5、9:16 三個輸出。

D1 batch 會在同一交易內：

1. 確認足夠可用輸出數，且新增 reservation 不超過 workspace active-output 上限；
2. 建立一個 `campaign_packs` 記錄；
3. 為每個輸出建立 reservation ledger；
4. 建立三個 queued generation 記錄。

沒有足夠 allowance 時，整個 batch 不留下部分記錄。重送同一 workspace + idempotency key 會返回原有 pack，不再預留。Queue batch 入列失敗時，三個輸出全部標示失敗並各自退回；重複 delivery 由 generation claim 與 unique ledger event 保持冪等。

## Product fidelity

- 上傳只接受 PNG、JPEG、WebP，最大 4 MB；
- MIME type 與檔案 signature 必須相符；
- JPEG／PNG／WebP 的 EXIF、XMP 或文字 metadata 會被拒絕，原始檔名會改為 generic 名稱；
- R2 object key 只由 server 生成；
- 確定性 compositor 把已批准原圖位元組嵌入 SVG，不重新繪製商品；
- 品牌、商品名、價格、優惠、賣點、規格與 CTA 經 XML escaping 後排版；
- 超出固定安全區的文字會在排隊前拒絕；
- private SVG route 加入 restrictive CSP、private cache、no-sniff 及 no-referrer headers。
- DELETE routes 只處理一個經授權的明確 asset／generation ID；處理中的 Queue output 不可刪除。

為降低 Worker CPU 及輸出體積，來源圖上限為 4 MB，base64 轉換使用 `node:buffer` 的 runtime implementation。

## Local and CI verification

```bash
npm ci
npm run check
npm test
npm run build
npm run cf:dry-run
npm audit --omit=dev
npm run release:check
```

Integration tests 會套用所有 D1 migrations，並覆蓋：

- registration、invite、session、rate limit 與 account lifecycle；
- workspace isolation、private uploads 及 response headers；
- Agent revision 與 exact brief matching；
- Campaign Pack atomicity、idempotency、Queue failure rollback；
- workspace active-output cap 及 assisted multi-gate fail-closed policy；
- duplicate Queue delivery、retry recovery、settlement 與 release；
- deterministic SVG 不呼叫外部 provider；
- synthetic assisted quality／latency／budget evaluation；
- structured provider output parsing。

## Protected deployment

GitHub Actions 只執行公開安全的驗證：

```bash
npm ci
npm run check
npm test
npm audit --omit=dev
npm run cf:dry-run
npm run release:check
```

它不持有 Cloudflare credential、帳戶 identifier 或資源映射。本機正式部署只使用被 Git 忽略、權限限制為目前使用者的 `wrangler.local.jsonc`：

```bash
npm run cf:migrate
npm run cf:deploy
```

`main` push 會由 `aislestage` Worker 的 Cloudflare Workers Builds Git 連線觸發。Cloudflare 使用專用 build token、加密的資源映射變數、`npm run check && npm test && npm run build && npm run release:check` build command，以及 `npm run cf:deploy:build` deploy command；非正式分支 build 停用。restricted release 的生成設定固定為 disabled，Access auto-provision 亦固定關閉。部署腳本只可產生被 Git 忽略的 `wrangler.ci.generated.jsonc`，並且不得把變數值寫入 log 或 artifact。

公開 log、artifact、PR 或文件不得輸出本機或自動部署設定內容。GitHub Actions 保持純驗證，不取得 Cloudflare credential；Cloudflare Workers Builds 的 dashboard、token、資源路徑與 build 詳情也不可複製到公開 repository。D1 migration 不屬於 push 自動部署，仍需先由獲授權維護者核對目標再執行。

任何部署都必須先把 D1 migration 套用到經核對的目標環境，再部署相容 Worker。部署後至少檢查公開主頁、Access 對 `/app` 的攔截、origin JWT 驗證、D1 membership、登出、私人資產 headers、Campaign Pack 三輸出及 Queue 完成狀態。完整 path/policy 合約見 [ACCESS_SETUP.md](ACCESS_SETUP.md)。
