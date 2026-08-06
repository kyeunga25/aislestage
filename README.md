# AisleStage — AI 電商素材工作台

AisleStage 是 contact-first、邀請制的 AI 電商素材工作台。它把一張有權使用的商品圖片、已核實的繁中／英文商業資料，以及人工批准，整理成一套 1:1、4:5、9:16 Campaign Pack。

AisleStage is a contact-first, invite-only ecommerce asset workspace. It turns an approved product image, verified Traditional Chinese and English commercial copy, and explicit human approval into a coordinated three-format Campaign Pack.

> **部署方式 / Deployment**：本專案以一個 **Cloudflare Worker** 部署。Worker 提供 API、Queue、Scheduled handler 及存取控制；Vite 建置的 React SPA 則以 **Workers Static Assets** 隨同一版本一併部署。它不是只部署前端的 Cloudflare Pages 專案。

公開主頁位於 `/`，私人工作區位於 `/app`。正式環境先以 Cloudflare Access 驗證身份，Worker 再驗證簽章及 workspace membership。公開流程不提供自助註冊、公開生成或付款。

目前預設以確定性 SVG 合成保留商品原圖及準確文字。Campaign Agent 只檢查資料、規劃固定輸出並等待人工批准，不會自行新增產品宣稱、發佈廣告或跳過批准。

## 技術棧 / Technology stack

| 層面 | 使用技術 | 用途 |
| --- | --- | --- |
| 前端 | React 19、TypeScript 7、Vite 8 | 雙語 SPA、建置與靜態資產 |
| Edge runtime | Cloudflare Workers、Workers Static Assets、Wrangler 4 | API、SPA、Queue consumer、Cron 與部署 |
| 身份與授權 | Cloudflare Access、`jose` | Edge identity、JWT 驗證及 workspace 授權 |
| 受保護資料 | Cloudflare D1 | 應用資料；實際內容及內部組織不在公開概覽記錄 |
| 私人檔案 | Cloudflare R2 | 只經授權 Worker route 讀取的來源及輸出檔案 |
| 非同步處理 | Cloudflare Queues | Campaign Pack 輸出、重試及 dead-letter 隔離 |
| 有狀態 Agent | Cloudflare Agents SDK、Durable Objects | Workspace-scoped 計劃與批准狀態 |
| 測試 | Vitest、Cloudflare Vitest integration | 隔離的 Worker、D1、R2、Queue 與 Durable Object 測試 |
| 可選 AI | OpenAI Responses API、Image API | 受閘門控制的 assisted adapter；預設停用 |

版本以 [`package.json`](package.json) 與 lockfile 為準。Cloudflare 方案、限制、模型可用性及價格會變動，部署前應重新核對官方文件。

## 已完成能力

- Session、帳號狀態及 workspace 授權；
- 公開雙語產品主頁與獨立 `/app` 工作區；
- Cloudflare Access JWT 驗證及受控 workspace membership；
- 私人 R2 商品圖上傳、格式／大小檢查及授權預覽；
- Workspace-scoped Campaign Agent 與人工批准 revision；
- 原子、具冪等鍵的三比例 Campaign Pack 建立；
- Queue 重送安全、失敗回復及輸出額度核算；
- 私人 SVG 輸出、下載及繁中／英文文案；
- 本機合成 demo 與隔離 Workers integration tests。

詳細產品、資料及執行合約見 [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md) 與 [`docs/ENGINEERING.md`](docs/ENGINEERING.md)。公開文件只描述必要的技術界面，不記錄真實帳戶、資源拓撲、資料表內容、營運資料或內部部署映射。

## 本機開發

需要 Node.js 22 或更新版本。

```bash
npm ci
npm run dev
```

開發介面使用合成 demo 資料；整合測試使用隔離 bindings，不連接正式資源或付費 provider。

完整檢查：

```bash
git diff --check
npm run check
npm test
npm run build
npm run cf:dry-run
npm audit --omit=dev
npm run release:check
```

`npm run check` 亦會核對由 `wrangler types` 產生的 `worker-env.d.ts`，避免 bindings 與程式型別漂移。

## 自部署快速步驟 / Self-hosting quick start

自部署會在你的 Cloudflare 帳戶建立一套全新的 Worker、D1、R2、Queues、Durable Object 及 Access 設定；它不會連接 AisleStage 的任何既有環境或資料。開始前請確認你有權使用 repository、示範素材、網域與相關服務。Repository 可公開讀取不代表已取得軟件、媒體、品牌或商標授權；本指南只提供技術步驟。

1. Fork／clone repository，在 Node.js 22+ 執行 `npm ci`。
2. 執行 `npm run check`、`npm test`、`npm run build`、`npm run cf:dry-run` 及 `npm run release:check`。
3. 使用 `npx wrangler login --use-keyring` 登入你自己的 Cloudflare 帳戶；不要把 `whoami` 或 dashboard 輸出貼到公開 issue／CI log。
4. 在自己的帳戶建立一個 D1 database、一個 private R2 bucket、一個 generation Queue 及一個 dead-letter Queue。
5. 把公開 placeholder 模板複製成被 Git 忽略的 `wrangler.local.jsonc`，限制檔案權限，並只在該檔填入自己的資源映射與 Access 設定。
6. 建立 Cloudflare Access self-hosted application，明確保護 `/app`、`/app/*` 與 `/api/*`。Allow policy 只加入獲批准身份，不可使用 `Everyone`。
7. 先核對目標，再執行 `npm run cf:migrate`；之後執行 `npm run cf:deploy`。新環境保持 `GENERATION_MODE=disabled` 及 `ASSISTED_PROVIDER=disabled`。
8. 匿名及已授權地檢查根路由、`/app`、深層 workspace route、session、私人檔案 headers 與 generation kill switch。

完整命令、設定欄位、首次 owner 建立、驗收、更新與 AI 選配界線見 **[`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md)**。Cloudflare Access 的 path／JWT 細節見 [`docs/ACCESS_SETUP.md`](docs/ACCESS_SETUP.md)。

## Cloudflare 公開設定合約

程式依賴下列穩定、通用的 binding 名稱：

```text
DB
MEDIA_BUCKET
GENERATION_QUEUE
CAMPAIGN_AGENT
ASSETS
```

Tracked [`wrangler.jsonc`](wrangler.jsonc) 只可保存 placeholder、通用 binding 名稱及 fail-closed 預設值。它不是可直接連接正式環境的設定檔。

| 可進 Git | 必須留在受保護設定 |
| --- | --- |
| 通用 binding 名稱、placeholder、公開模式說明 | Account／database identifier、實際資源名稱及 deployment URL |
| 合成 fixture、公開測試、一般錯誤類別 | 真實使用者、商品、campaign、brief、營運及資料庫內容 |
| 空白 secret 名稱示例 | API key、Access audience、team domain、cookie、JWT 及邀請碼 |
| 官方文件 URL | Dashboard 截圖、CLI inventory、private object URL 及 provider payload |

正式值只可放在被忽略且限制權限的本機設定、Wrangler secret、Cloudflare Secrets Store 或同等受保護系統。不要把 secret 放進 `VITE_*` 變數、前端 bundle、`.env`、文件、commit、PR、issue、artifact 或 log。

預設安全模式為：

- `AUTH_MODE=access`；
- `ACCESS_AUTO_PROVISION=disabled`；
- `REGISTRATION_MODE=closed`；
- `GENERATION_MODE=disabled`；
- `AGENT_MODE=deterministic`；
- `ASSISTED_PROVIDER=disabled`。

確定性輸出不需要外部 AI key。任何 assisted 模式都必須先完成 provider、資料處理、固定評估、成本及 secret 五類批准；正式商品圖、準確文字、授權與伺服器端核算控制仍不可交由模型決定。

## 文件索引

- [自部署指南](docs/SELF_HOSTING.md)
- [統一產品規格](docs/PRODUCT_SPEC.md)
- [工程與部署](docs/ENGINEERING.md)
- [Beta access 合約](docs/BETA_ACCESS.md)
- [Cloudflare Access 設定](docs/ACCESS_SETUP.md)
- [發佈狀態](docs/RELEASE_STATUS.md)
- [AI 評估與成本閘門](docs/AI_EVALUATION.md)
- [Provider-neutral 付款邊界](docs/PAYMENT_BOUNDARY.md)
- [公開發佈外流閘門](docs/PUBLIC_RELEASE_GATE.md)
- [安全與私隱](SECURITY.md)

所有公開測試、截圖、commit、PR 及文件只可使用合成資料。執行 `npm run release:check` 只是其中一道閘門；發佈前仍需人工檢查 staged diff、commit／PR 文字及擬上傳 artifact。本次文件核對不代表任何實際部署狀態。

## 技術、AI 模型與參考資料 / Technology, AI models and references

以下是本 repository 實際使用或明確參考的公開技術資料；核對日期為 **2026-08-07**。

### 實際使用的技術

- [React](https://react.dev/)、[TypeScript](https://www.typescriptlang.org/docs/) 及 [Vite](https://vite.dev/guide/)：前端與建置；
- [Cloudflare Workers](https://developers.cloudflare.com/workers/)、[Static Assets](https://developers.cloudflare.com/workers/static-assets/) 及 [Wrangler](https://developers.cloudflare.com/workers/wrangler/commands/)：edge runtime、SPA 與部署；
- [Cloudflare D1](https://developers.cloudflare.com/d1/)、[R2](https://developers.cloudflare.com/r2/)、[Queues](https://developers.cloudflare.com/queues/) 及 [Durable Objects](https://developers.cloudflare.com/durable-objects/)：關聯資料、私人檔案、非同步工作及 workspace-scoped state；
- [Cloudflare Agents SDK](https://developers.cloudflare.com/agents/)：Campaign Agent 的 Durable Object 基礎；
- [Cloudflare Access application paths](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/) 及 [JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)：私人 route 與 origin 驗證；
- [`jose`](https://github.com/panva/jose)、[Vitest](https://vitest.dev/) 及 [Cloudflare Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/)：JWT 與隔離測試。

### AI 模型與 API 狀態

- **預設及自部署基線不使用 AI 模型**：`deterministic` compositor 直接組合已批准商品圖與文字；新部署保持 generation／assisted 功能停用。
- Repository 包含一個**可選但預設停用**的 OpenAI adapter：[`gpt-5.6-terra`](https://developers.openai.com/api/docs/models/gpt-5.6-terra) 經 [Responses API／Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) 提供受限規劃與文案結構；[`gpt-image-2`](https://developers.openai.com/api/docs/models/gpt-image-2) 經 [Image generation API](https://developers.openai.com/api/docs/guides/image-generation) 產生背景候選。
- [Workers AI model catalog](https://developers.cloudflare.com/workers-ai/models/) 及 [AI Gateway](https://developers.cloudflare.com/ai-gateway/) 只作評估與治理參考，**不是目前已接駁的 production provider**。
- 模型名稱、輸入資料、價格、可用地區及保留政策會變動。啟用前必須重新做合成資料評估、人工保真檢查、法律／資料處理核對及成本上限；不得把真實 prompt、response、商品圖、brief 或 key 寫入 repository 或 log。

本 repository 不包含客戶資料集、正式資料庫 dump、provider response corpus 或模型訓練資料。示例與測試只應使用合成內容；上述連結是實作與安全界線的主要公開參考，並不代表第三方服務背書或授權。
