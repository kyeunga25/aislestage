# AisleStage — AI 電商素材工作台

AisleStage 把一張有權使用的商品圖片、已核實的繁中／英文商業資料，以及人工批准，整理成一套 1:1、4:5、9:16 Campaign Pack。

AisleStage turns an approved product image, verified Traditional Chinese and English commercial copy, and explicit human approval into a coordinated three-format Campaign Pack.

目前版本以確定性 SVG 合成保留商品原圖及準確文字。Campaign Agent 只會檢查資料和規劃固定輸出，不會自行新增產品宣稱、發佈廣告或跳過批准。

公開主頁位於 `/`，介紹產品、流程及私隱邊界；私人工作區位於 `/app`。正式登入以 Cloudflare Access 作邊緣身份驗證，Worker 仍會驗證簽章並核對 D1 workspace membership。

## 已完成能力

- Session、帳號狀態及 workspace 授權；
- 公開雙語產品主頁與獨立 `/app` 工作區路由；
- Cloudflare Access JWT 驗證、subject hash 綁定及受控 beta workspace 建立；
- 電郵綁定的一次性邀請註冊；
- 私人 R2 商品圖上傳、格式／大小檢查及授權預覽；
- 每個 workspace 一個 SQLite-backed Campaign Agent；
- 批准 revision 與提交 brief 完整比對；
- 一次、原子、具冪等鍵的三比例 Campaign Pack 建立；
- Queue 重送安全、失敗退回可用輸出數；
- 私人 SVG 輸出、下載及繁中／英文文案；
- 桌面及手機介面、真實素材包／商品／品牌／素材視圖；
- 本機 demo 與隔離 Workers integration tests。

## 架構

- React 19、Vite 8、TypeScript 7；
- Cloudflare Worker API + Static Assets；
- Cloudflare Access：`/app*` 與受保護 API 的第一層身份及 policy gate；
- D1：帳號、workspace、邀請、素材 metadata、Campaign Pack 與輸出記錄；
- private R2：商品來源圖與衍生素材；
- Queues：非同步輸出與重試；
- Agents SDK Durable Object：workspace-scoped 規劃與批准狀態；
- Cron Trigger：過期 session 與短期驗證記錄清理。

Static Assets 只在 `/api/*` 先執行 Worker；其餘 SPA 檔案由資產層提供。確定性模式不需要付費模型呼叫。D1、R2、Queues、Durable Objects 與 Workers 的實際免費用量及限制以 Cloudflare 目前文件和帳戶方案為準：

- [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
- [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
- [R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- [Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/)
- [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)

## 本機開發

需要 Node.js 22 或更新版本。

```bash
npm ci
npm run dev
```

開發介面使用合成 demo 資料；整合測試使用隔離 D1、R2、Queue 及 Durable Object，不連接正式資源或付費 provider。

## 完整檢查

```bash
git diff --check
npm run check
npm test
npm run build
npm run cf:dry-run
npm audit --omit=dev
```

`npm run check` 亦會核對由 `wrangler types` 產生的 `worker-env.d.ts`，避免 bindings 與程式型別漂移。

## Cloudflare 設定

程式依賴以下穩定 binding 名稱：

```text
DB
MEDIA_BUCKET
GENERATION_QUEUE
CAMPAIGN_AGENT
ASSETS
```

追蹤的 `wrangler.jsonc` 只包含明確 placeholder，並保持 `AUTH_MODE=access`、`ACCESS_AUTO_PROVISION=disabled`、`REGISTRATION_MODE=closed`、`GENERATION_MODE=disabled`。正式映射只可放在被忽略且限制權限的 `wrangler.local.jsonc`；不可把帳戶識別碼、Access audience、team domain、D1 identifier、實際資源名稱、部署 URL 或 secret 寫入 Git。

正式環境使用：

- `AUTH_MODE=access`，以及受保護的 Access team domain 與 audience；
- Access policy 收窄至受邀身份後，才按需要設定 `ACCESS_AUTO_PROVISION=enabled`；
- `REGISTRATION_MODE=closed`，停用公開密碼註冊與登入；
- `GENERATION_MODE=deterministic`；
- `AGENT_MODE=deterministic`；
- 每個新邀請 workspace 六個可用輸出（兩套完整素材包）。

本機手動部署順序：

1. 核對被 Git 忽略的受保護資源映射；
2. `npm run check && npm test && npm run build`；
3. 執行 `npm run cf:dry-run`；
4. 對 `wrangler.local.jsonc` 指向的 `DB` 執行 `npm run cf:migrate`；
5. 執行 `npm run cf:deploy`，再檢查 `/api/health`、未授權路徑、登入頁及一套隔離 Campaign Pack。

GitHub Actions 只使用公開 placeholder 設定執行 check、test、audit、build 及 dry-run，不持有 Cloudflare 帳戶或資源映射。`main` push 的正式部署則由 `aislestage` Worker 內的 Cloudflare Workers Builds 連線處理：build command 是 `npm run check && npm test && npm run build`，deploy command 是 `npm run cf:deploy:build`，非正式分支 build 保持停用。

Workers Builds 只在 Cloudflare 受保護設定中保存專用 build token 與下列加密變數；repo、GitHub Actions、公開 log 及 artifact 都不可保存或輸出其值：

```text
CLOUDFLARE_D1_DATABASE_NAME
CLOUDFLARE_D1_DATABASE_ID
CLOUDFLARE_R2_BUCKET_NAME
CLOUDFLARE_QUEUE_NAME
CLOUDFLARE_DEAD_LETTER_QUEUE_NAME
CLOUDFLARE_APP_ORIGIN
CLOUDFLARE_ACCESS_TEAM_DOMAIN
CLOUDFLARE_ACCESS_AUD
CLOUDFLARE_ACCESS_AUTO_PROVISION
CLOUDFLARE_INITIAL_OUTPUT_ALLOWANCE
```

`WORKERS_CI=1` 是非敏感 build guard。部署前，`scripts/prepare-cloudflare-build.mjs` 會核對固定 Worker 名稱 `aislestage`、公開模板結構及受保護值格式，再寫出被 Git 忽略且權限限制為目前程序的 `wrangler.ci.generated.jsonc`。D1 migration 仍必須先由經授權的維護者獨立審核和套用；自動部署不會擅自執行 migration。

建立一次性邀請時，從本機環境提供收件電郵和受保護 D1 名稱；程式只把 hash 寫入 D1，邀請碼只顯示一次：

```bash
AISLESTAGE_INVITE_EMAIL='<recipient>' \
AISLESTAGE_INVITE_DATABASE='<database>' \
npm run cf:invite
```

provider secret 只可透過 Wrangler secret 或同等受保護設定加入。`assisted` 模式可生成背景，但商品原圖與商業文字仍由確定性合成層處理。正式支援下載格式是 SVG；PNG／JPEG 不在目前輸出合約內。

## 文件

- [統一產品規格](docs/PRODUCT_SPEC.md)
- [工程與部署](docs/ENGINEERING.md)
- [Beta access 合約](docs/BETA_ACCESS.md)
- [Cloudflare Access 設定](docs/ACCESS_SETUP.md)
- [發佈狀態](docs/RELEASE_STATUS.md)
- [安全與私隱](SECURITY.md)

所有公開測試、截圖、commit、PR 及文件只可使用合成資料；不得包含真實使用者資料、非公開背景、內部商業資料或部署識別資訊。
