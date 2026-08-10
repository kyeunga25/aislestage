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
- Access subject hash 及已驗證 email 的初始 D1 查詢均屬可用性邊界；任何讀取失敗回傳 no-store `503 unavailable`，不輸出資料庫細節，亦不把暫時儲存故障誤判為 membership denial；
- pre-onboarded 帳號首次綁定 Access subject 的 UPDATE 回報失敗時，Worker 會以同一 user ID、標準化 email、Access 顯示名稱、subject hash、`auth_mode=access` 及 active 狀態做 exact post-read；完整提交才繼續 membership 查詢，明確未提交或不可讀則以 Access `unavailable` fail closed 並保留未綁定帳號供重試；
- 只有明確設定 `ACCESS_AUTO_PROVISION=enabled` 才會以原子 batch 建立 Access user、workspace、owner membership 與 allowance。Batch 回報失敗時，只有 subject hash／標準化 email 對應 exact active Access user 才可繼續；missing 或 reconciliation 不可讀回 `503 unavailable`，不會錯標為 membership denial。最終 membership 讀取失敗亦使用同一 unavailable 邊界；
- password endpoint 在 Access 模式停用，避免雙重登入或繞過 edge identity；
- 密碼以 PBKDF2 衍生 hash；session token 只保存 SHA-256 hash；
- session cookie 為 HttpOnly、SameSite=Lax，非本機環境加上 Secure；
- session INSERT 回報失敗時，Worker 只以本次高熵 token 的 SHA-256 hash 重新讀取，並要求 user ID 與完整 expiry 完全相同；已提交的 exact row 仍須成功載入 active user／workspace 才發出同一 cookie。缺失或衝突狀態返回不含 token／hash 的雙語 `503`；reconciliation 或 authorization reload 不可讀時亦不發 cookie，並最佳努力刪除該唯一未交付 session row，但不會盲目刪除可讀的衝突 row；
- password session 的 session row、active user 或 workspace membership 讀取失敗時，受保護 API 回雙語 no-store `503 unavailable`；`/api/session` 同時標示 `authenticated: false`，但保留 browser cookie 供安全重試，不會把暫時 D1 故障誤作登出或過期；
- browser bootstrap loader 只接受 exact `200 application/json` authenticated session envelope：active user、active workspace、受支援 role、bounded 文字及非負 safe-integer allowance；`/api/health` 亦須符合同一 transport 條件、restricted release 的 exact schema，以及 auth／registration 和 generation enabled／mode 的跨欄位關係。Session 非成功回應不會解析 body，只允許 bounded `x-aislestage-access-failure` header 選擇固定 Access failure 狀態；malformed 或矛盾 success payload 只會進入固定雙語 unavailable 狀態，不改變 client authorization／feature controls；
- password auth client 在 6 KiB UTF-8 body 上限前先按 Worker 規則正規化及限制欄位；login 只送 email／password，不會夾帶表單內仍保留的姓名、workspace 或 invite code，register 亦只在 invite mode 傳送 invite code。Login 只接受 exact `200 application/json`，register 只接受 exact `201 application/json`，然後共用 active-session runtime schema；非成功 response 的任意 `error` 文字不會直接反映到表單；
- `last_seen_at` 只屬非權威 session telemetry：active user、未過期 session 及 active workspace membership 全部讀取成功後才嘗試更新；UPDATE 失敗只記錄固定事件名，不會推翻已完成的 authorization，expiry 亦不會因此延長；
- logout DELETE 回報失敗時，只有同一 token hash 的 D1 row 已確定不存在才返回成功及 expired cookie；row 仍存在或 reconciliation 不可讀時返回雙語 `503` 並保留 browser cookie 作重試錨點。Password client 只接受 exact `200 application/json { "ok": true }` 才清空 workspace state，失敗會返回 workspace 畫面顯示固定雙語訊息並保留重試能力；Access client 只使用固定同源 `/cdn-cgi/access/logout`，不採信 response redirect；
- password／invite 模式以一個 D1 batch 建立 user、workspace、owner membership、初始 output allowance，並在適用時消耗一次性 invite。若 batch 已提交但回應失敗，Worker 只以本次 server-generated user／workspace IDs 核對 exact email、名稱、password hash／salt、帳戶模式、workspace 狀態、owner membership、初始 allowance 及 invite linkage；完整相符才記錄一次成功並建立 session，明確未提交維持既有 conflict，衝突或不可讀狀態不會把其他同 email 帳號誤認為本次成功；
- 所有 state-changing API 會核對 same-origin／fetch metadata；
- JSON／multipart 寫入會先精確核對大小寫不敏感的 base media type，再進入 bounded body parser；標準 charset／boundary 參數可用，substring lookalike 會取消未讀 stream，並在 password verification 或 endpoint mutation 前返回 `415`；受保護 route 仍會先完成必要的 session／membership 核對；
- active user 必須同時擁有 active workspace membership；
- session 授權完成後，`/api/workspaces` 的第二次 workspace 清單查詢若不可讀，回雙語 no-store `503 unavailable` 並保留既有 session；不輸出 D1 細節，亦不回傳不完整清單；
- `/api/generations` 先重核 requested workspace 與 session current workspace 一致，再讀 active membership scope 及最多 20 個輸出；scope／清單 D1 查詢不可讀時回雙語 no-store `503 unavailable`，不以空清單掩蓋，跨 workspace request 仍為 `404`；
- browser generation loader 在 JSON parse 前要求 exact `200 application/json`，並只接受 exact `{ generations }` outer envelope；normalizer 再只把最多 20 項、ID 唯一、欄位完整的 array 視為 authoritative snapshot，核對 workflow／比例／狀態、review／provenance revision 關係，以及與 generation ID 精確相符的同網域 preview／download route。清單 GET 與 Campaign Pack success response 共用內層契約；網絡失敗、非 canonical success status、額外 outer field、外部 URL 或 malformed payload 會保留現有 session／輸出並顯示固定雙語提示，不把後端故障渲染成真正空白 workspace；
- 私人 hydration JSON 在 parse 前以共用 reader 計算實際 decoded stream bytes：health 4 KiB、session 16 KiB、generation list 128 KiB、Agent state 256 KiB。`Content-Length` 只作早期拒絕，不是唯一保護；宣稱較小但實際超限的 body 仍會被取消，不套用部分 snapshot；
- session、health、generation list 及 Agent state 的可安全重試 GET 共用 15 秒 AbortController deadline；到期會進入同一固定雙語 unavailable 狀態、釋放 loading UI，並保留既有 workspace snapshot。Mutation 的 commit uncertainty 仍由各 endpoint reconciliation／retry 契約處理；
- 私人 mutation acknowledgement 亦在 schema 驗證前共用 bounded reader：logout 1 KiB、product upload 4 KiB、password auth／output review 16 KiB、Campaign Pack 64 KiB、Agent action 256 KiB。超限 success body 不能確認登入、登出、上載、計劃、pack 或審核決定；
- 無權資產與輸出一律返回 not found，避免跨 workspace 枚舉；
- 登入／註冊短期限制只保存電郵與來源 IP 的單向 key；每個 auth event 另有 server-generated ID，INSERT 回應失敗時必須由該 ID 讀回完全相同的 email hash、IP hash 及 event type 才可繼續。同一主鍵與 exact fields 容許在 row 缺失或首輪 reconciliation 暫時不可讀時做一次有界重寫；首次其實已提交會由唯一鍵及 post-read 恢復，不會重複計數，衝突 row 亦不會覆寫。Event 最終未確認或 rate-limit count 暫時不可讀時，password auth route 以專用錯誤邊界返回雙語 no-store `503`；成功密碼不會取得 session，其他程式錯誤亦不會被這個邊界吞掉；
- 定期 trigger 清理過期 session、7 日前的登入嘗試、已過期 pending／revoked invite hash，以及 30 日前已使用 invite 的 hash／account linkage。

## Campaign Agent lifecycle

```text
idle -> needs-input -> awaiting-approval -> approved
```

Campaign Agent route 把 Agent stub acquisition 與後續 RPC 全部放在同一可用性邊界；任何失敗只記錄固定 action event，並回雙語 no-store `503`。Browser GET、plan 及 approve 都要求 exact `200 application/json`；GET 另要求 exact `{ state }` envelope。GET、plan 與 approve 再共用欄位完整、枚舉合法、ID 唯一且符合既定文字／清單上限的 state normalizer。Plan success 必須綁定 canonical submitted brief 及 planning stage，approve success 必須確認 requested revision、approved timestamp 與 boolean replay marker。Action request 另有 40 KiB client cap；網絡、非成功、非 canonical success status、錯誤 media type、額外 outer field、任意 server error detail 或 malformed 回應不會被套用或轉成 `idle`，而會保留目前 Agent state 並顯示固定雙語提示。

前端修改任何商業欄位或商品圖時，現有計劃立即在 UI 失效。Worker 在建立 Campaign Pack 前仍會獨立檢查：

1. 目前 Agent state 是 `approved`；
2. revision 完全相同；
3. sanitized brief 與批准版本逐項相同；
4. 三個 workflow／比例均在批准計劃內；
5. 商品 asset 屬於目前 workspace。

Campaign Brief 的可見輸入與 Worker 共用欄位上限及已知欄位集合。Plan route 先要求外層恰好為 `{ brief: object }`；缺失、null、array、primitive、額外外層欄位或 malformed JSON 以雙語 `400` 拒絕。通過 envelope 後再驗證 Brief、brand、product 只包含公開 contract 欄位，以及已提供欄位的型別、支援語言、清單項數及各項長度，才進行 sanitize、私人資產核對、可選 provider 呼叫或 Durable Object 寫入。未知欄位或會造成截短、清單丟失、語言回退的輸入均以不回顯內容的雙語 `422` 拒絕；既有 revision 不會被失敗的重新規劃覆蓋。brief object 內未提供的已知欄位仍由 Agent 標記為 `needs-input`。

Approval route 使用同一 bounded JSON reader，並只接受恰好一個正整數 `revision`；不會把 string、boolean 或 `null` 轉成版本。Durable Object 先比較 revision，再以 `awaiting-approval -> approved` 寫入一次；同 revision 的併發或重送會返回原有 state 及 `approvedAt`，不新增第二個批准訊息，亦不觸發 output reservation。

Campaign Pack 與單輸出相容 route 在任何 allowance、generation row 或 Queue mutation 前，必須重新讀取 active workspace scope 與商品 asset ownership。任一 D1 preflight 暫時不可讀時回固定雙語 no-store `503 unavailable`；不會把故障誤作 workspace／asset 不存在，亦不會留下 pack、generation、ledger、reservation 或 Queue message。

## Atomic Campaign Pack

`POST /api/campaign-packs` 接受一個 client-generated idempotency key，以及 1–3 個已批准輸出。外層 JSON 必須恰好包含公開 contract 的八個欄位，每個 output 亦只能包含 `workflowId` 與 `aspectRatio`，而共用 Brief／brand／product 內層欄位同樣必須已知；未知欄位或 malformed envelope 會在批准狀態、allowance、D1 及 Queue 操作前以 `400` 拒絕。舊有單輸出 route 亦只接受完整 GenerationInput 鍵集合，不會把未知頂層或內層欄位寫入 `input_json`。正式 UI 固定提交 1:1、4:5、9:16 三個輸出。

正式 UI 的 Campaign Pack client 在 32 KiB UTF-8 cap 前重建 canonical eight-field body，要求一個 source asset、正整數 revision 及三組唯一且受 workflow 支援的比例。新建只接受 exact `202`／`reservedOutputs` envelope，重播只接受 exact `200`／`replayed: true` envelope；兩者都以共享 generation normalizer 及 UUID、pack ID、generation count、approved revision、requested output-set binding 驗證，non-success body 不會解析或反映。

D1 batch 會在同一交易內：

1. 確認足夠可用輸出數，且新增 reservation 不超過 workspace active-output 上限；
2. 建立一個 `campaign_packs` 記錄；
3. 為每個輸出建立 reservation ledger；
4. 建立三個 queued generation 記錄。

沒有足夠 allowance 時，整個 batch 不留下部分記錄。重送同一 workspace + idempotency key 時，Worker 會把新請求 sanitize 成 canonical GenerationInput identities，與既有 pack 的所有 `input_json` identities 排序比對；數量、revision、brief、asset、workflow 或比例任一不同均 `409`，只有完全相同才返回原 pack 且不再預留。相同 helper 亦處理 D1 唯一鍵競爭。若 D1 batch 已提交但回應傳輸失敗，Worker 會先核對 exact pack、三個 canonical queued rows、空白 output state 及每個輸出的唯一 reservation ledger；完整 commit 才發送 Queue 並返回 `202`，明確未提交才回退至 idempotency replay，衝突則以無識別資料事件及通用 `503` fail closed。若 reconciliation 本身暫時不可讀，Worker 仍發送只含本次 server-generated IDs 的 bounded Queue batch，避免可能已提交的 pack 永久滯留，但不宣稱成功；未對應 D1 row 的孤兒 delivery 無法取得 generation claim，只會安全 ack。Queue batch 入列失敗時，三個輸出全部標示失敗並各自退回；重複 delivery 由 generation claim 與 unique ledger event 保持冪等。

Pack 已提交且 Queue send 成功後，最終 generation snapshot 讀取若暫時不可用，Worker 回固定雙語 no-store `503`，不釋放 reservation、不重送 Queue，亦不猜測 response payload。Client 保留同一 idempotency key；重試會從已提交 canonical identities 讀回原 pack 與原 generation IDs。

單輸出相容 route 亦把 reservation、generation row 及 Queue send 視為分段狀態機。Reservation batch 拋錯時會以 workspace + server-generated generation ID 核對唯一 ledger event；已提交 reservation 才繼續。Generation INSERT 拋錯時會核對完整 queued row、canonical `input_json`、成本、revision 及空白 output state；已提交才送 Queue，明確沒有 row 才釋放 reservation。Reconciliation 不可讀或發生欄位衝突時只返回通用 `503` 及無識別資料事件，不做可能造成 queued row／allowance 分離的盲目補償。

Queue consumer 的首個 D1 claim UPDATE 若回應不確定，在設定的三次重試窗口內不會開始 provider／R2 work，也不會把仍為 queued 或同 attempt processing 的 generation 標示失敗或釋放 reservation。Worker 只讀取 status／processing attempt 作保守分流：可處理或暫時不可讀的狀態延遲至下一 attempt；已完成、已失敗、已拒絕、缺失或已由較新 attempt 接管的狀態只會安全 ack，不被舊訊息覆寫。Claim 確認後，canonical row、每次批准／來源圖重核、completion UPDATE、retry reset 及 terminal release 全部要求相同 processing attempt。較新 attempt 接管後，舊 attempt 不能完成、重排或終止它；若接管恰好發生在 R2 put 後，completion 的零變更會觸發單一 object 清理而不改動 reservation。

## Human output review

Queue 完成只會結算 technical output allowance，並把輸出設為私人 `draft`；它不會自動開放正式下載。授權成員可經 inline preview 核對輸出，只有 `owner` 或 `admin` 可向 workspace-scoped review route 提交 `approve` 或 `reject`，並同時提交預期的批准 revision。

私人 preview 與已批准 download 的 workspace-scoped D1 generation metadata 或 R2 output object 暫時不可讀時，Worker 回雙語 no-store `503 unavailable`，不返回 SVG body，固定 log 不包含 generation、workspace 或 object 識別資料。真正不存在／跨 workspace 仍為 `404`，canonical integrity 失配仍為 `409`。

審核更新只接受小型、嚴格結構的 JSON。初始 workspace-scoped generation row 或 approve 所需 R2 `head` 暫時不可讀時，Worker 在任何 UPDATE 前回雙語 no-store `503`，保持 `draft` 與空白 reviewed timestamp；固定 log 不含識別資料。D1 以 `draft` 條件更新確保 approve／reject 競爭時只有首個決定生效；相同決定重送會返回既有結果，相反決定返回 conflict。若 review UPDATE 已提交但回應失敗，Worker 會按 workspace／generation ID 核對 completed 狀態、目標 decision、expected revision 及非空 reviewed timestamp；完整相符才以 replay 回覆，仍為 draft 則保留重試錨點並返回雙語 `503`，相反決定仍不可覆寫。UPDATE 成功但最終 authoritative generation reload 不可讀時亦回同一 `503`，不猜測 payload；相同 decision 重送會讀到已提交的不可變狀態並以 replay 恢復。Review client 在送出前以共享 generation normalizer 核對 completed draft，body 只含 decision 與 expected revision；回應亦必須是 exact `200 application/json` envelope，且 generation／Campaign Pack identity、workflow、ratio、content metadata、created time、image URL 與 provenance 不可改變，只有目標 review state、reviewed time 及相應 download URL 可變。API 只返回通用 composition version、generation mode 與批准 revision，不返回 R2 key、來源 asset ID、正文 digest 或 reviewer identity。只有 `approved` 記錄才取得獨立 download URL；preview 與 download 都再次核對 active workspace ownership。Queue 對完整 UTF-8 SVG 計算 SHA-256，由 R2 `put` 驗收並把同一 canonical digest 寫入 D1。若 completion／settlement batch 拋錯，Worker 會重新核對 completed row、R2 checksum／provenance、draft review state 及唯一 settlement ledger；完整 commit 會保留 object 並 ack，明確未 commit 才刪 object 及進入 bounded retry。不可判定或衝突時不盲目刪除可能已被 D1 引用的私人 output，只寫入不含識別資料的事件。approve 先以 R2 `head` 核對 checksum／metadata；preview／download 亦要求 D1 content type 為正式 `image/svg+xml`，並與 R2 SHA-256、HTTP metadata、workflow、批准 revision、composition version 及 generation mode 完全一致。不一致時不寫入核准決定；已核准後才失配亦會取消 object stream 並返回 no-store conflict JSON。

## Product fidelity

- 上傳只接受 PNG、JPEG、靜態 WebP，最大 4 MB、單邊 8192 px 及 32 MP；
- MIME type 與檔案 signature 必須相符；
- PNG parser 以 bounded chunk walk 核對 IHDR／IDAT／IEND 次序、critical chunk、CRC 與完整結尾；WebP parser 核對 RIFF declared size、chunk padding、靜態 VP8／VP8L bitstream header 及 image dimensions，不解壓或重新編碼私人圖片；
- JPEG／PNG／WebP 的 EXIF、XMP 或文字 metadata 會被拒絕；PNG chunk、JPEG structural marker 與 WebP chunk 掃描均有固定 traversal-count 上限，原始檔名會改為 generic 名稱；
- upload client 在 multipart 邊界已把本機檔名改成 MIME-derived generic 名稱；只接受 exact `201 application/json` asset envelope，並把 UUID、canonical 名稱、MIME、size 及 exact same-origin preview path 綁定至本次 File。外部／不相符 URL、額外欄位及任意 server error detail 均不會進入 workspace state；
- R2 object key 只由 server 生成；
- 私人商品圖 GET 先做 workspace-scoped D1 metadata 查詢，再讀取私人 R2 object；真正不存在或跨 workspace 保持 `404`，D1 或 R2 暫時不可讀則回雙語 no-store `503 unavailable`，固定 log 不包含 object key、workspace ID 或原始錯誤；
- 來源圖上傳向 R2 提供 SHA-256，寫入回傳 checksum 與 D1 canonical digest 必須一致；
- R2 驗收後若 D1 insert 拋錯，Worker 會以 server-generated asset ID 重新讀取 workspace-scoped 記錄：完整 canonical row 已提交時返回同一 `201` 並保留 object，明確沒有 row 時才補償刪除 R2；reconciliation 本身不可用時返回不含識別資料的 `503`，不做可能破壞已提交記錄的盲目刪除；
- Agent plan 在 Durable Object mutation／provider work 前核對來源圖的 workspace ownership 與 D1／R2 digest、大小、MIME、asset kind、workspace metadata；preview、Agent 批准及 Queue 取圖亦再次核對。找不到或失配不改寫既有 Agent revision，並在任何 provider work 前 fail closed；
- 確定性 compositor 把已批准原圖位元組嵌入 SVG，不重新繪製商品；
- 品牌、商品名、價格、優惠、賣點、規格與 CTA 經 XML escaping 後排版；
- Agent 與確定性 compositor 共用文字 normalization、1:1／4:5／9:16 換行參數及合併明細行數 validator；無空格 SKU／型號 token 會按視覺單位安全拆行並保留原字元；超出任一固定安全區的文字會先停在 `needs-input` 並顯示雙語修正原因，批准及排隊前仍會再次拒絕；
- private SVG route 加入 restrictive CSP、private cache、no-sniff 及 no-referrer headers。
- preview／download 不採信單一 R2 header；D1 與 R2 SHA-256／format／provenance metadata 必須一致才會串流私人 body。
- preview 使用 inline response；只有已核准輸出可使用 no-store attachment response 正式下載。
- DELETE routes 只處理一個經授權的明確 asset／generation ID；browser client 同樣限制一個 bounded safe ID、一條 same-origin route 及空 body，只接受 `204` 或 workspace-scoped `404` absence，且不解析 error payload。這個明確冪等契約使用 15 秒 AbortController deadline：逾時保留本機項目並顯示固定雙語錯誤，再次提交同一 DELETE 可由 `204`／`404` 安全收斂。處理中的 Queue output 不可刪除。任何 R2、Agent 或 D1 mutation 前，必須先成功讀取 workspace-scoped D1 preflight metadata；讀取不可用時回固定雙語 no-store `503`，並完整保留 row、object 與 Agent revision。商品圖先完成私人 R2 delete，才由 workspace-scoped Agent 以 asset identity 原子判斷並重設引用同一來源圖的 plan，最後刪除 D1 asset 記錄；若 R2 delete call 拒絕，Worker 不會繼續改動 D1 或 Agent revision，讓使用者可由保留的 D1 retry anchor 安全重試。商品圖或已完成輸出的最終 D1 DELETE 若回應不確定，只有同 workspace／同 record type 的 row 已確認不存在才回覆冪等 `204`；row 仍在或核對不可用則以雙語 `503` fail closed。若商品圖 row 仍在，已完成的 R2／Agent 清理保持安全，使用者可沿同一 D1 anchor 再次刪除。前端成功後重新讀取 authoritative Agent state，讀取失敗則保留安全降級狀態並清楚提示。

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
