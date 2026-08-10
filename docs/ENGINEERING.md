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

目前 adapter 的 credential 是 Worker-side secret。只有 `GENERATION_MODE=assisted`、provider allowlist、資料政策、固定評估、預算及 secret 六項全部通過時才會使用。文字 request 固定 output token 上限；success response 以實際串流位元組及 chunk 數限制讀取，不只信任 `Content-Length`。本機 validator 會再核對 JSON MIME／UTF-8、exact schema、欄位長度、base64 大小及 PNG signature；拒絕、缺漏、超限、過度碎片或無效 response 均 fail closed。未使用的 error body 會立即取消。每個 provider request 連同完整 body 讀取共用 30 秒 deadline；逾時中止後會映射為可重試的 408，Queue 以 60 秒延遲最多重試三次，終止時以冪等 ledger 釋放一次 reservation。

## Authentication and workspace boundary

- 公開 `/` 與私人 `/app` 分開；正式 Access policy 亦保護受保護 API；
- Static Assets 對 `/app` 及 `/app/*` 採 Worker-first；Access 模式先完成 JWT 與 active D1 membership 驗證，才經 `ASSETS` binding 返回 no-store 的 SPA shell；
- Worker 以 remote JWKS 驗證 RS256、issuer、audience、有效期、subject 與電郵；
- Access subject 只保存單向 hash，身份與帳戶不符時 fail closed；
- pre-onboarded 帳號首次綁定 Access subject 的 UPDATE 回報失敗時，Worker 會以同一 user ID、標準化 email、Access 顯示名稱、subject hash、`auth_mode=access` 及 active 狀態做 exact post-read；完整提交才繼續 membership 查詢，明確未提交或不可讀則以 Access `unavailable` fail closed 並保留未綁定帳號供重試；
- password endpoint 在 Access 模式停用，避免雙重登入或繞過 edge identity；
- 密碼以 PBKDF2 衍生 hash；session token 只保存 SHA-256 hash；
- session cookie 為 HttpOnly、SameSite=Lax，非本機環境加上 Secure；
- session INSERT 回報失敗時，Worker 只以本次高熵 token 的 SHA-256 hash 重新讀取，並要求 user ID 與完整 expiry 完全相同；已提交的 exact row 可繼續載入 active user／workspace 並發出同一 cookie，缺失、衝突或不可讀狀態只返回不含 token／hash 的通用 `503`；
- `last_seen_at` 只屬非權威 session telemetry：active user、未過期 session 及 active workspace membership 全部讀取成功後才嘗試更新；UPDATE 失敗只記錄固定事件名，不會推翻已完成的 authorization，expiry 亦不會因此延長；
- logout DELETE 回報失敗時，只有同一 token hash 的 D1 row 已確定不存在才返回成功及 expired cookie；row 仍存在或 reconciliation 不可讀時返回雙語 `503` 並保留 browser cookie 作重試錨點，不會虛假宣稱 server session 已撤銷；
- password／invite 模式以一個 D1 batch 建立 user、workspace、owner membership、初始 output allowance，並在適用時消耗一次性 invite。若 batch 已提交但回應失敗，Worker 只以本次 server-generated user／workspace IDs 核對 exact email、名稱、password hash／salt、帳戶模式、workspace 狀態、owner membership、初始 allowance 及 invite linkage；完整相符才記錄一次成功並建立 session，明確未提交維持既有 conflict，衝突或不可讀狀態不會把其他同 email 帳號誤認為本次成功；
- 所有 state-changing API 會核對 same-origin／fetch metadata；
- JSON／multipart 寫入會先精確核對大小寫不敏感的 base media type，再進入 bounded body parser；標準 charset／boundary 參數可用，substring lookalike 會取消未讀 stream，並在 password verification 或 endpoint mutation 前返回 `415`；受保護 route 仍會先完成必要的 session／membership 核對；
- active user 必須同時擁有 active workspace membership；
- 無權資產與輸出一律返回 not found，避免跨 workspace 枚舉；
- 登入／註冊短期限制只保存電郵與來源 IP 的單向 key；每個 auth event 另有 server-generated ID，INSERT 回應失敗時必須由該 ID 讀回完全相同的 email hash、IP hash 及 event type 才可繼續，真正缺失或不可讀時維持 fail closed；
- 定期 trigger 清理過期 session、7 日前的登入嘗試、已過期 pending／revoked invite hash，以及 30 日前已使用 invite 的 hash／account linkage。

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

Campaign Brief 的可見輸入與 Worker 共用欄位上限及已知欄位集合。Plan route 先要求外層恰好為 `{ brief: object }`；缺失、null、array、primitive、額外外層欄位或 malformed JSON 以雙語 `400` 拒絕。通過 envelope 後再驗證 Brief、brand、product 只包含公開 contract 欄位，以及已提供欄位的型別、支援語言、清單項數及各項長度，才進行 sanitize、私人資產核對、可選 provider 呼叫或 Durable Object 寫入。未知欄位或會造成截短、清單丟失、語言回退的輸入均以不回顯內容的雙語 `422` 拒絕；既有 revision 不會被失敗的重新規劃覆蓋。brief object 內未提供的已知欄位仍由 Agent 標記為 `needs-input`。

Approval route 使用同一 bounded JSON reader，並只接受恰好一個正整數 `revision`；不會把 string、boolean 或 `null` 轉成版本。Durable Object 先比較 revision，再以 `awaiting-approval -> approved` 寫入一次；同 revision 的併發或重送會返回原有 state 及 `approvedAt`，不新增第二個批准訊息，亦不觸發 output reservation。

## Atomic Campaign Pack

`POST /api/campaign-packs` 接受一個 client-generated idempotency key，以及 1–3 個已批准輸出。外層 JSON 必須恰好包含公開 contract 的八個欄位，每個 output 亦只能包含 `workflowId` 與 `aspectRatio`，而共用 Brief／brand／product 內層欄位同樣必須已知；未知欄位或 malformed envelope 會在批准狀態、allowance、D1 及 Queue 操作前以 `400` 拒絕。舊有單輸出 route 亦只接受完整 GenerationInput 鍵集合，不會把未知頂層或內層欄位寫入 `input_json`。正式 UI 固定提交 1:1、4:5、9:16 三個輸出。

D1 batch 會在同一交易內：

1. 確認足夠可用輸出數，且新增 reservation 不超過 workspace active-output 上限；
2. 建立一個 `campaign_packs` 記錄；
3. 為每個輸出建立 reservation ledger；
4. 建立三個 queued generation 記錄。

沒有足夠 allowance 時，整個 batch 不留下部分記錄。重送同一 workspace + idempotency key 時，Worker 會把新請求 sanitize 成 canonical GenerationInput identities，與既有 pack 的所有 `input_json` identities 排序比對；數量、revision、brief、asset、workflow 或比例任一不同均 `409`，只有完全相同才返回原 pack 且不再預留。相同 helper 亦處理 D1 唯一鍵競爭。若 D1 batch 已提交但回應傳輸失敗，Worker 會先核對 exact pack、三個 canonical queued rows、空白 output state 及每個輸出的唯一 reservation ledger；完整 commit 才發送 Queue 並返回 `202`，明確未提交才回退至 idempotency replay，衝突則以無識別資料事件及通用 `503` fail closed。若 reconciliation 本身暫時不可讀，Worker 仍發送只含本次 server-generated IDs 的 bounded Queue batch，避免可能已提交的 pack 永久滯留，但不宣稱成功；未對應 D1 row 的孤兒 delivery 無法取得 generation claim，只會安全 ack。Queue batch 入列失敗時，三個輸出全部標示失敗並各自退回；重複 delivery 由 generation claim 與 unique ledger event 保持冪等。

單輸出相容 route 亦把 reservation、generation row 及 Queue send 視為分段狀態機。Reservation batch 拋錯時會以 workspace + server-generated generation ID 核對唯一 ledger event；已提交 reservation 才繼續。Generation INSERT 拋錯時會核對完整 queued row、canonical `input_json`、成本、revision 及空白 output state；已提交才送 Queue，明確沒有 row 才釋放 reservation。Reconciliation 不可讀或發生欄位衝突時只返回通用 `503` 及無識別資料事件，不做可能造成 queued row／allowance 分離的盲目補償。

## Human output review

Queue 完成只會結算 technical output allowance，並把輸出設為私人 `draft`；它不會自動開放正式下載。授權成員可經 inline preview 核對輸出，只有 `owner` 或 `admin` 可向 workspace-scoped review route 提交 `approve` 或 `reject`，並同時提交預期的批准 revision。

審核更新只接受小型、嚴格結構的 JSON。D1 以 `draft` 條件更新確保 approve／reject 競爭時只有首個決定生效；相同決定重送會返回既有結果，相反決定返回 conflict。API 只返回通用 composition version、generation mode 與批准 revision，不返回 R2 key、來源 asset ID、正文 digest 或 reviewer identity。只有 `approved` 記錄才取得獨立 download URL；preview 與 download 都再次核對 active workspace ownership。Queue 對完整 UTF-8 SVG 計算 SHA-256，由 R2 `put` 驗收並把同一 canonical digest 寫入 D1。若 completion／settlement batch 拋錯，Worker 會重新核對 completed row、R2 checksum／provenance、draft review state 及唯一 settlement ledger；完整 commit 會保留 object 並 ack，明確未 commit 才刪 object 及進入 bounded retry。不可判定或衝突時不盲目刪除可能已被 D1 引用的私人 output，只寫入不含識別資料的事件。approve 先以 R2 `head` 核對 checksum／metadata；preview／download 亦要求 D1 content type 為正式 `image/svg+xml`，並與 R2 SHA-256、HTTP metadata、workflow、批准 revision、composition version 及 generation mode 完全一致。不一致時不寫入核准決定；已核准後才失配亦會取消 object stream 並返回 no-store conflict JSON。

## Product fidelity

- 上傳只接受 PNG、JPEG、靜態 WebP，最大 4 MB、單邊 8192 px 及 32 MP；
- MIME type 與檔案 signature 必須相符；
- PNG parser 以 bounded chunk walk 核對 IHDR／IDAT／IEND 次序、critical chunk、CRC 與完整結尾；WebP parser 核對 RIFF declared size、chunk padding、靜態 VP8／VP8L bitstream header 及 image dimensions，不解壓或重新編碼私人圖片；
- JPEG／PNG／WebP 的 EXIF、XMP 或文字 metadata 會被拒絕；PNG chunk、JPEG structural marker 與 WebP chunk 掃描均有固定 traversal-count 上限，原始檔名會改為 generic 名稱；
- R2 object key 只由 server 生成；
- 來源圖上傳向 R2 提供 SHA-256，寫入回傳 checksum 與 D1 canonical digest 必須一致；
- R2 驗收後若 D1 insert 拋錯，Worker 會以 server-generated asset ID 重新讀取 workspace-scoped 記錄：完整 canonical row 已提交時返回同一 `201` 並保留 object，明確沒有 row 時才補償刪除 R2；reconciliation 本身不可用時返回不含識別資料的 `503`，不做可能破壞已提交記錄的盲目刪除；
- Agent plan 在 Durable Object mutation／provider work 前核對來源圖的 workspace ownership 與 D1／R2 digest、大小、MIME、asset kind、workspace metadata；preview、Agent 批准及 Queue 取圖亦再次核對。找不到或失配不改寫既有 Agent revision，並在任何 provider work 前 fail closed；
- 確定性 compositor 把已批准原圖位元組嵌入 SVG，不重新繪製商品；
- 品牌、商品名、價格、優惠、賣點、規格與 CTA 經 XML escaping 後排版；
- Agent 與確定性 compositor 共用文字 normalization、1:1／4:5／9:16 換行參數及合併明細行數 validator；無空格 SKU／型號 token 會按視覺單位安全拆行並保留原字元；超出任一固定安全區的文字會先停在 `needs-input` 並顯示雙語修正原因，批准及排隊前仍會再次拒絕；
- private SVG route 加入 restrictive CSP、private cache、no-sniff 及 no-referrer headers。
- preview／download 不採信單一 R2 header；D1 與 R2 SHA-256／format／provenance metadata 必須一致才會串流私人 body。
- preview 使用 inline response；只有已核准輸出可使用 no-store attachment response 正式下載。
- DELETE routes 只處理一個經授權的明確 asset／generation ID；處理中的 Queue output 不可刪除。商品圖先完成私人 R2 delete，才由 workspace-scoped Agent 以 asset identity 原子判斷並重設引用同一來源圖的 plan，最後刪除 D1 asset 記錄；若 R2 delete call 拒絕，Worker 不會繼續改動 D1 或 Agent revision，讓使用者可由保留的 D1 retry anchor 安全重試。前端成功後重新讀取 authoritative Agent state，讀取失敗則保留安全降級狀態並清楚提示。

為降低 browser／Worker 解碼記憶體、Worker CPU 及輸出體積，來源圖上限為 4 MB、單邊 8192 px 及 32 MP；尺寸直接從已驗證的 PNG IHDR、JPEG frame 或 WebP VP8X／VP8／VP8L header 讀取，不先解碼圖片。base64 轉換使用 `node:buffer` 的 runtime implementation。

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

- registration ambiguous-commit reconciliation、invite、session、rate limit 與 account lifecycle；
- workspace isolation、private uploads、PNG／WebP malformed container rejection 及 response headers；
- Agent revision 與 exact brief matching；
- Campaign Pack atomicity、idempotency、D1 ambiguous-commit reconciliation 及 Queue failure rollback；
- workspace active-output cap 及 assisted multi-gate fail-closed policy；
- duplicate Queue delivery、retry recovery、settlement 與 release；
- deterministic SVG 不呼叫外部 provider；
- D1／R2 source asset 及 output byte、SHA-256、MIME 及 provenance metadata tampering fail-closed；
- synthetic assisted quality／latency／budget evaluation；
- structured provider output parsing、misleading／oversized／fragmented response 及 bounded PNG validation。

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

Repository 不公開 maintainer-specific Worker 名稱、account mapping、build token、部署 hostname、protected variable inventory 或 dashboard 設定。若營運者使用 Cloudflare Workers Builds 或其他 CI/CD，所有 mapping 必須只存在於受保護平台設定；generated config 必須被 Git 忽略、限制檔案權限，而且不可作為 artifact 上傳。

公開 log、artifact、PR 或文件不得輸出本機或自動部署設定內容。GitHub Actions 保持純驗證，不取得 Cloudflare credential；任何 deployment dashboard、token、資源路徑與 build 詳情也不可複製到公開 repository。D1 migration 不屬於一般 push 自動部署，仍需先由獲授權維護者核對目標再執行。

任何部署都必須先把 D1 migration 套用到經核對的目標環境，再部署相容 Worker。部署後至少檢查公開主頁、Access 對 `/app` 及 deep route 的攔截、origin JWT 驗證、D1 membership、登出、私人資產 headers、generation kill switch 及 Queue 狀態。完整自部署流程見 [SELF_HOSTING.md](SELF_HOSTING.md)，path／policy 合約見 [ACCESS_SETUP.md](ACCESS_SETUP.md)。
