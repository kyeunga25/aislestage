# Cloudflare 自部署指南 / Self-hosting on Cloudflare

核對日期：2026-08-07

這份指南說明如何把 AisleStage 部署成你自己 Cloudflare 帳戶內的一個 Worker。Worker code、React SPA Static Assets、D1、private R2、Queues、Durable Object、Cron 及 Cloudflare Access 會共同組成一個獨立環境。

Self-hosting creates a separate environment in your own Cloudflare account. It does not connect to, copy, or grant access to any existing AisleStage deployment or data.

本文件只使用通用 binding、合成名稱及 placeholder。不要把實際帳戶、資源、網域、Access audience、身份、資料或 secret 加回本文件、repository、issue、PR、CI log 或截圖。

Repository 可公開讀取不代表已取得軟件、媒體、品牌或商標授權。本指南只說明技術流程；部署者必須另行確認適用的授權、第三方條款及司法管轄區要求。

## 1. 部署結果與非目標

完成後應得到：

- 一個同時處理 Worker API 與 Vite Static Assets 的 Cloudflare Worker；
- 一個全新 D1 database；
- 一個不公開的 R2 bucket；
- 一個 generation Queue 及一個 dead-letter Queue；
- 一個 workspace-scoped Durable Object binding；
- 一個只容許獲批准身份進入的 Cloudflare Access application；
- 預設停用外部 AI、公開註冊、付款及新 generation 的 fail-closed 環境。

這份指南不會：

- 匯入正式使用者、商品、campaign、brief、檔案或資料庫內容；
- 提供原服務的 resource mapping、URL、帳戶或 Access policy；
- 開啟公開自助註冊、checkout、payment 或 unrestricted prompt generation；
- 自動批准 AI provider、資料跨境、成本、保留政策或商業使用權；
- 授予 repository、示範素材、品牌或第三方服務的法律使用權。

## 2. 前置條件

準備以下項目：

- 你有權使用的 repository checkout；
- Node.js 22+、npm 及 Git；
- 你自己的 Cloudflare account，並可使用 Workers、D1、R2、Queues、Durable Objects 及 Zero Trust Access；
- 一個由你控制、經 Cloudflare proxy 的 HTTPS hostname；
- 能建立資源及部署 Worker 的最小權限身份；
- 對資料位置、私隱、模型／provider 條款、內容權利與預算的獨立核對；
- production 以外的 staging／test 環境，用來先完成 migration 與路徑驗收。

Cloudflare 方案、用量、地區及限制會變動。建立資源前先查看官方 pricing／limits，並按你的司法管轄區及資料政策選擇 location 或 jurisdiction。

## 3. 公開與受保護資料邊界

| 類別 | 可追蹤 | 不可追蹤／公開 |
| --- | --- | --- |
| Wrangler | `wrangler.jsonc` placeholder、generic bindings | `wrangler.local.jsonc`、generated CI config、實際 resource mapping |
| Secrets | 空白名稱示例、使用方法 | API key、token、cookie、JWT、Access audience、team domain |
| 資料 | 合成 fixture、資料處理原則 | 真實 row、完整 schema、dump、query result、object key、queue message、provider payload |
| 營運 | 通用驗收步驟 | 帳戶、deployment URL、dashboard inventory、受邀電郵、內部 incident data |
| 文件／媒體 | 公開產品說明、合成截圖 | 客戶素材、真實 brief、私人路徑、含 identifier 的 dashboard 截圖 |

受保護值不要經 shell history、命令參數、剪貼簿分享、螢幕錄影或 CI echo 傳遞。CLI 輸出可能含 database ID、account 資料或 deployment URL；只在受控終端查看，不要貼到公開討論。

## 4. 安裝與本機驗證

在 repository root 執行：

```bash
npm ci
npm run check
npm test
npm run build
npm run cf:dry-run
npm audit --omit=dev
npm run release:check
```

這一步使用 public placeholder config 及隔離測試 bindings，不需要正式 Cloudflare mapping 或 AI key。任何檢查失敗都應先修正；不要以正式 credential 或 production data 繞過測試。

## 5. 登入自己的 Cloudflare account

優先把 Wrangler OAuth credential 存進系統 keyring：

```bash
npx wrangler login --use-keyring
```

可用以下專案 script 在本機確認登入狀態：

```bash
npm run cf:whoami
```

`whoami` 只供你在本機核對正確 account。不要把輸出保存成 artifact、附在 issue／PR，或複製進文件。如果使用 API token，應採最小權限並放在受保護 secret manager，不可寫入 `.env`、Wrangler tracked vars 或 GitHub 公開設定。

## 6. 建立獨立 Cloudflare 資源

以下名稱只是合成示例。請在執行前改成你自己的私有、環境專用名稱，而且不要把實際名稱提交回 repository。

```bash
npx wrangler d1 create example-project-db
npx wrangler r2 bucket create example-project-media
npx wrangler queues create example-project-generation
npx wrangler queues create example-project-generation-dlq
```

注意：

- 保存 D1 command 返回的 database name 及 identifier，只供下一步的 ignored config 使用；
- R2 bucket 必須保持 private，不要開啟 public bucket URL；
- generation Queue 與 dead-letter Queue 必須是兩個不同資源；
- Durable Object namespace 由 Worker 的 binding／migration declaration 在部署時處理，不需要手動建立；
- Cron 與 Static Assets 亦由私有 Wrangler config 隨 Worker 部署；
- 為 staging 與 production 建立不同資源，不要讓測試指向 production。

## 7. 建立受保護 Wrangler config

從 public template 建立被 Git 忽略的本機設定：

```bash
cp wrangler.jsonc wrangler.local.jsonc
chmod 600 wrangler.local.jsonc
git check-ignore -v wrangler.local.jsonc
```

最後一個命令應顯示 `.gitignore` 規則。若沒有，停止，不要繼續填入任何受保護值。

只在 `wrangler.local.jsonc` 完成下列映射：

| 設定位置 | 內容 |
| --- | --- |
| Worker `name` | 你自己的獨立 Worker 名稱 |
| D1 `database_name`、`database_id` | 第 6 步建立的 database |
| R2 `bucket_name` | 第 6 步建立的 private bucket |
| Queue producer／consumer name | 第 6 步建立的 generation Queue |
| `dead_letter_queue` | 第 6 步建立的 dead-letter Queue |
| `APP_ORIGIN` | 你控制的 exact HTTPS origin，不含 path |
| `ACCESS_TEAM_DOMAIN` | 你自己的 exact Cloudflare Access team HTTPS origin |
| `ACCESS_AUD` | 你自己的 self-hosted application audience |

不要改動程式依賴的通用 bindings：`DB`、`MEDIA_BUCKET`、`GENERATION_QUEUE`、`CAMPAIGN_AGENT`、`ASSETS`。

初次部署保持：

```text
AUTH_MODE=access
ACCESS_AUTO_PROVISION=disabled
REGISTRATION_MODE=closed
GENERATION_MODE=disabled
AGENT_MODE=deterministic
ASSISTED_PROVIDER=disabled
ASSISTED_DATA_POLICY=disabled
ASSISTED_EVALUATION=disabled
ASSISTED_BUDGET_MODE=disabled
```

不要把 secret value 放進 `vars`。前端可讀取所有 `VITE_*` build variable，因此 `VITE_*` 永遠不可用來保存 credential。

可另外用私有 config 做一次不部署的解析／bundle 檢查；輸出仍應留在受控終端：

```bash
npx wrangler deploy --dry-run --config wrangler.local.jsonc
```

## 8. 設定 hostname 與 Cloudflare Access

在自己的 Cloudflare account 為目標 hostname 建立 Workers Custom Domain 或受控 route，再建立 Zero Trust self-hosted application。公開根路徑 `/` 可保持產品介紹頁；以下三個目標必須受同一受邀 Allow policy 保護：

```text
/app
/app/*
/api/*
```

`/app/*` 不會涵蓋父路徑 `/app`，所以兩者都要明確保護。若需要匿名 health check，只可建立更精確的單一路徑例外，並先確認 response 不含身份、資源或營運資料。

Access policy 應符合：

- `Allow` 只包含明確受邀電郵或受管理 identity group；
- 不使用 `Everyone`，不以 broad `Bypass` 代替驗證；
- team domain 及 application audience 只寫入 ignored／encrypted deployment config；
- request 到達 Worker 後仍驗證 `Cf-Access-Jwt-Assertion` 的簽章、issuer、audience、expiry 及 identity；
- Worker 驗證成功後仍要有 active D1 workspace membership；
- 匿名 request 必須在 edge 或 Worker fail closed，不能只隱藏前端按鈕。

完整設定原則及官方連結見 [ACCESS_SETUP.md](ACCESS_SETUP.md)。

## 9. 套用 D1 migrations

先人工核對 private config 指向的 account、database name 及 environment。再列出及套用尚未執行的 migrations：

```bash
npx wrangler d1 migrations list DB --remote --config wrangler.local.jsonc
npm run cf:migrate
```

Migration 是受保護的 state change：

- 先在 staging 執行；
- 閱讀所有待套用 migration，而不是只看檔名；
- 確認備份／Time Travel 策略與復原責任；
- 不要把 migration output、database ID 或 SQL query result 貼到公開 log；
- 不要在 CI 自動對未知 database 執行 migration；
- 程式 rollback 不代表 schema rollback，不能以刪除 database 作復原方法。

本公開文件不列出資料表、欄位、索引、row 或實際資料組織；唯一 schema source 是已審核的 repository migrations。

## 10. 部署 Worker

完成 build、Access、private mapping 及 migration 核對後執行：

```bash
npm run cf:deploy
```

這個 script 會重新 build，然後使用 `wrangler.local.jsonc` 部署 Worker 與 Static Assets。部署 output 可能含受保護 URL／identifier，不要上傳或貼到公開位置。

如果需要先建立 Worker 再綁定 custom domain，可先以相同的 fail-closed modes 部署，之後在 Cloudflare 受保護設定加入 hostname，再重新核對 `APP_ORIGIN`、Access application 及 audience。正式驗收只對你的最終 HTTPS hostname 進行，不以 preview URL 代替。

## 11. 首次 owner 建立

空白 D1 沒有任何 workspace membership；這是預期的 fail-closed 狀態。不要為了進入 workspace 而開啟公開 registration 或直接在公開文件貼 SQL。

可使用一次性 Access bootstrap：

1. 先把 Access Allow policy 收窄至一個獲批准的 bootstrap identity；
2. 保持 `GENERATION_MODE=disabled` 及所有 assisted gates disabled；
3. 在 private config 暫時把 `ACCESS_AUTO_PROVISION` 設為 `enabled`；
4. 部署後只讓該 identity 登入一次，確認建立的是獨立 owner workspace；
5. 立即把 `ACCESS_AUTO_PROVISION` 改回 `disabled` 並再次部署；
6. 確認該 owner 可再次登入，而另一個符合 IdP 但未受邀的 identity 仍收到拒絕；
7. 保持 Access Allow policy 收窄，不要以自動 provision 代替日常邀請管理。

若無法在一次受控維護時段內完成啟用、登入、停用及驗證，停止 bootstrap 並先回復 `disabled`。

## 12. 部署後驗收

使用合成資料完成以下檢查。不要在截圖、console、network export 或 bug report 中留下 cookie、JWT、電郵、object key、brief 或 resource identifier。

| 檢查 | 預期結果 |
| --- | --- |
| 匿名 `/` | 公開主頁可讀，沒有真實 workspace／客戶資料 |
| 匿名 `/app` | 由 Access 攔截；不能直接取得私人 SPA shell |
| 匿名 `/app/campaign-packs` | 與 `/app` 一樣受保護，不能因 SPA fallback 而匿名 200 |
| 匿名受保護 API | Access 或 Worker 拒絕，不返回資料庫／資源細節 |
| 已受邀 `/api/session` | JWT 與 active membership 都通過後才成功 |
| 私人 R2 內容 | 只經授權 Worker route 返回，帶 private／no-store 等 headers |
| Generation | 初次部署保持 disabled；不能排隊或扣用量 |
| Static assets | 公開 hashed assets 可讀，私人 workspace shell 保持 Worker-first |
| Logging | 沒有 prompt、response、brief、商品圖、身份、object key 或 mapping |

完成後再執行：

```bash
git status -sb
git diff --check
npm run release:check
```

確認 `wrangler.local.jsonc`、`.dev.vars`、generated config、log、dump、screenshot 及 build artifact 沒有被 staged。這些檢查通過不代表 production 已驗證；仍須保存由你自行管理的 reviewed SHA、migration version、deployment version 及私密驗收記錄。

## 13. 更新、回復與環境分離

更新流程：

1. 在乾淨分支檢視上游 diff 及依賴變更；
2. 在沒有 production mapping 的環境完成 check、test、build、audit、dry-run 及 egress scan；
3. 閱讀新增 migrations，先套用至 staging；
4. 使用 staging 的獨立 D1、R2、Queue、Access application 及 hostname 完成驗收；
5. 核對 production target，再套用 migration 及部署同一 reviewed commit；
6. 重做匿名、Access、membership、私人檔案及 kill-switch 驗收。

回復時優先使用 Cloudflare 的版本／deployment rollback 能力，但先確認該 Worker version 與目前 D1 schema 相容。不要刪除 Worker、D1、R2、Queue 或 Durable Object 作為一般 rollback；資源刪除可能不可逆，且不在本指南的授權範圍。

## 14. 可選 AI adapter

自部署不需要 AI key。預設 deterministic compositor 不聯絡外部 provider。

Repository 目前包含但預設停用：

- `gpt-5.6-terra`：經 OpenAI Responses API 提供受限規劃／文案結構；
- `gpt-image-2`：經 OpenAI Image API 產生背景候選。

啟用 assisted 前，至少完成：

- 使用合成 fixtures 的 schema、保真、拒絕、latency 與成本評估；
- 明確的資料分類、資料跨境、保留、logging、DPA／條款及刪除核對；
- 每個 workspace 的並發、重試、每日輸出及預算上限；
- 人工批准及 deterministic fallback；
- 不把真實 prompt、response 或圖片 payload 放進 Worker／AI Gateway logs；
- provider credential rotation、撤銷及 incident response。

Credential 只在 Worker 已建立、目標 config 已核對後，以互動 prompt 加入；不要把 value 放在 command line：

```bash
npx wrangler secret put OPENAI_API_KEY --config wrangler.local.jsonc
```

Wrangler secret 更新會建立並部署新的 Worker version，應在維護時段執行並重新驗收。只有 `GENERATION_MODE`、provider allowlist、資料政策、固定評估、預算及 secret 全部批准時 assisted adapter 才可執行。詳細 gate 見 [AI_EVALUATION.md](AI_EVALUATION.md)。

## 15. 常見失敗

| 現象 | 優先檢查 |
| --- | --- |
| `/app` 匿名可直接讀取 | Access 是否同時保護 `/app` 與 `/app/*`；Static Assets 是否對兩者 Worker-first |
| Access 登入後仍 401 | Team domain、audience、JWT issuer／expiry 及 request header |
| Access 登入後 403 | Auto-provision 是否已停用且 identity 尚無 active membership；不要開 broad policy 繞過 |
| D1 migration 找不到目標 | Private config 是否有正確 database name／ID 及 `DB` binding |
| Queue deployment 失敗 | Producer、consumer 與 dead-letter Queue 是否已建立且名稱一致 |
| Private asset 404 | 先核對 identity、workspace membership 及 object ownership；不要改成 public bucket |
| Generation 被拒絕 | 新部署預期保持 disabled；不要以加入 key 單獨繞過多重 gate |
| Release scan 失敗 | 只查看 path 與類別，移除／rotate 受影響資料；不要把疑似 secret 貼到 issue |

如問題需要分享證據，只提供最小合成 reproduction，並遮蔽 hostname、account／database／object identifier、電郵、cookie、JWT、secret、prompt、response 及商業資料。

## 16. 官方參考

- [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
- [Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/)
- [D1 getting started](https://developers.cloudflare.com/d1/get-started/) 及 [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [R2 bucket creation](https://developers.cloudflare.com/r2/buckets/create-buckets/)
- [Queues getting started](https://developers.cloudflare.com/queues/get-started/) 及 [Dead Letter Queues](https://developers.cloudflare.com/queues/configuration/dead-letter-queues/)
- [Durable Objects](https://developers.cloudflare.com/durable-objects/)
- [Access application paths](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/)
- [Validate Access JWTs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [OpenAI `gpt-5.6-terra`](https://developers.openai.com/api/docs/models/gpt-5.6-terra) 及 [`gpt-image-2`](https://developers.openai.com/api/docs/models/gpt-image-2)

實際 limits、pricing、CLI flags、model status 及服務條款以部署當日的官方文件為準。
