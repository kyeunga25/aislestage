# AisleStage 統一產品規格 / Unified Product Specification

版本：v0.6 — Restricted Release Foundation

本文件是產品定位、介面、Agent、資料及輸出行為的單一公開依據。

## 1. 產品定義

AisleStage 是 contact-first、邀請制的 AI 電商素材工作台。它把一張有權使用的商品圖片，以及一份已核實的繁中／英文商業 brief，整理成一套協調一致的 Campaign Pack。

每套輸出固定包括：

- 1:1 商品主圖；
- 4:5 社交廣告；
- 9:16 限時動態；
- 可複製的繁體中文及英文文案；
- 可核對的商品名稱、價格、優惠、賣點與 CTA。

產品不是自由 prompt 圖片工具，也不是通用設計編輯器。Agent 不可以新增未提供的產品宣稱、替使用者批准、發佈廣告或繞過 workspace 授權。

公開主頁只解釋產品、合作流程與私隱邊界，不讀取私人 session，也不提供公開註冊、公開生成或 checkout。只有已通過營運確認及 Access policy 的受邀身份才可進入 `/app`；正式 Access 模式下，Worker 在返回工作區 shell 前仍會核對簽章與 active D1 membership。無論 Static Assets 回應是否附帶標頭，Worker 都會固定套用 no-store、同源資源政策、CSP anti-framing／base／form 邊界、`X-Frame-Options: DENY`、no-referrer、no-sniff 及停用敏感 browser permissions。

## 2. 核心工作流

1. 使用者登入 active workspace。
2. 填寫繁中與英文商品資料、價格、優惠、賣點及 CTA。
3. 上傳 PNG、JPEG 或靜態 WebP 商品原圖。
4. Agent 檢查必填資料、來源圖及三個渠道輸出。
5. Agent 停在 `awaiting-approval`。
6. 使用者核對並批准目前 revision；修改任何資料會立即令前端計劃失效。
7. Worker 再次比對批准 state、revision、完整 brief、asset、workflow 及比例。
8. 一個具冪等鍵的請求原子建立三個 Queue jobs。
9. 完成的私人 SVG 先以 `draft` 狀態經授權、`private, no-store` 路徑預覽。
10. `owner` 或 `admin` 逐一核對輸出版本與 provenance，作出一次性 `approved` 或 `rejected` 決定。
11. 只有 `approved` 輸出可經獨立受控路徑下載；`rejected` 草稿保留預覽及重新建立路徑，但不可交付。

## 3. 帳號與 access

- 正式環境使用邀請註冊，不提供匿名自助註冊；
- 一次性邀請同時綁定標準化電郵，D1 只保存 token hash 與組合 hash；
- Access subject hash 及已驗證 email 的初始帳號查詢不可讀時返回 no-store `503 unavailable`；不得洩漏資料庫錯誤，亦不得把暫時可用性問題當成未獲邀或無 membership；
- pre-onboarded 帳號的首次 Access subject 綁定只保存 subject hash；UPDATE 回應不確定時必須由同一 user、email、顯示名稱、hash、Access auth mode 及 active 狀態完整證實，未提交時返回暫時不可用並保留安全重試路徑；
- 明確啟用的 Access auto-provision 以一個 D1 batch 建立 user、workspace、owner membership 與 allowance；batch 回應不確定時只接受 subject hash／email 的 exact active Access user，missing 或不可讀狀態返回 `503 unavailable` 而不是誤報未獲邀；
- invite registration 以單一 D1 batch 建立帳號、workspace、owner membership、初始 allowance 並消耗邀請；若 D1 回報不確定，只在本次 server-generated user／workspace IDs、canonical password account fields、membership、allowance 及 invite linkage 全部相符時恢復成功並發出 session，不能只憑相同 email 已存在而宣稱成功；
- 建立 session 的 D1 回應若不確定，只在本次隨機 token hash 對應同一 user、exact expiry，且 active user／workspace authorization 重讀成功時才發出原 token cookie；任何其他狀態均返回雙語 `503` 而不返回 cookie 或 token 識別資料，reconciliation／authorization 不可讀時並最佳努力移除未交付 session row；
- password session 的 session／active user／workspace membership 不可讀時返回雙語 no-store `503 unavailable` 並保留 cookie 作重試錨點；只有已確認無效、過期或無 active workspace 的 session 才回未登入及清 cookie；
- 工作區 bootstrap 只接受 exact `200 application/json`，且包含 active user、active workspace、合法角色、bounded identity 文字與非負整數額度的完整 session envelope；health success 亦須符合同一 transport 條件、restricted release 及 registration／generation 跨欄位關係。Session 非成功回應不解析 body，只使用 bounded `x-aislestage-access-failure` header 分類固定 Access 錯誤；malformed 或矛盾資料 fail closed，不可打開註冊、生成或審核 UI；
- password 登入只提交 email／password；切換過的註冊姓名、workspace 名稱及 invite code 不會被一併送出。註冊只在 invite mode 傳送邀請碼，所有欄位均有 UI／runtime／UTF-8 總量界限；login 要求 exact `200 application/json`，register 要求 exact `201 application/json`，成功回應仍須通過 active session schema 及提交身份綁定。每個動作只有一次 30 秒 POST attempt；transport／response stream／deadline／`408`／`5xx` 不重送敏感 body，而以 bounded session GET 僅接受同 email，註冊再要求同姓名、workspace 名稱及 owner role。其他狀態、oversized／malformed success 及 identity mismatch 不對帳，失敗只顯示固定雙語訊息；處理期間 tabs、所有 credential 欄位及重複提交保持鎖定；
- session `last_seen_at` 是不延長 expiry 的 best-effort telemetry；它只在 user、expiry 與 active workspace authorization 完成後更新，寫入失敗不會拒絕已核實的 session；
- logout 的 session DELETE 回應不確定時，只在同一 token hash 已不存在時清除 browser cookie；password browser client 的無 body request 連完整 response 讀取每次有 15 秒 deadline，transport／response stream 中斷／deadline、HTTP `408` 或 `5xx` 最多以仍保留的同一 cookie 自動重試一次，validation／authorization／non-canonical success 不重送。只有 exact `200 application/json { "ok": true }` 才清空私人 workspace state；兩次失敗保持可見登入狀態、顯示固定雙語錯誤、解除登出按鈕並可由使用者重試。Access 模式直接前往固定同源 `/cdn-cgi/access/logout`，不接受 response-controlled redirect；
- 登入／註冊 abuse event 只保存單向 email／IP keys；寫入回應不確定時只接受本次 event ID 之 exact hashed fields 與 event type。同一 event identity 可在 missing／首輪不可讀狀態做一次有界重試；唯一鍵與再次 post-read 確保已提交 event 不重複，衝突不覆寫。最終未確認或 rate-limit 狀態不可讀時返回雙語 `503`，不建立登入 session，亦不繼續帳號／密碼流程；
- 帳號狀態為 `active`、`suspended` 或 `deactivated`；
- workspace 狀態為 `active`、`suspended` 或 `closed`；
- membership 角色為 `owner`、`admin` 或 `member`；
- 所有受保護操作都採 server-side workspace scope；正式輸出審核另要求 `owner` 或 `admin`；
- 工作區活動記錄只供目前 workspace 的 `owner`／`admin` 讀取，`member` 固定拒絕。每次最多返回最近 50 項，只包含安全事件 ID、操作類型、UTC 時間及可選的已知操作者名稱；不返回 subject ID、商品／輸出內容、原始檔名、Campaign Brief 或底層錯誤；
- 工作區用量供目前 active membership 讀取；API 只返回 authoritative available／reserved output allowance、完成／退回總數，以及最多 50 項 `reservation`／`settlement`／`release` 類型、固定單位與 UTC 時間。不返回 workspace、user、generation、ledger、provider identity、note、失敗原因、付款資料或底層錯誤；任何 allowance、summary、event amount 或時間失配會整個 snapshot fail closed；
- 已授權的 `/api/workspaces` 清單查詢不可讀時返回雙語 no-store `503 unavailable`，保留 session 並拒絕輸出不完整 workspace 資料；
- 私人 `/api/generations` 先重核 current workspace 與 active membership，再讀最多 20 個輸出；scope 或清單不可讀時返回雙語 no-store `503 unavailable`，不輸出部分／空白假結果，跨 workspace 維持 `404`；
- 工作區前端只有收到最多 20 項、ID 唯一、完整且通過 runtime schema 的 `generations` array 才替換目前輸出；workflow、比例、狀態、review／provenance revision 及同網域 preview／download route 必須一致。清單 GET 與 Campaign Pack success response 共用此契約；網絡錯誤、`503`、外部 URL 或 malformed payload 均保留登入狀態與現有結果並顯示雙語提示，只有明確空 array 才顯示真正空清單；
- 活動記錄不屬於初始 bootstrap；只有 owner／admin 進入或重新整理「活動記錄」時才發出一條 15 秒、64 KiB 有界 GET。前端只接受 exact `200 application/json`、exact `{ activity }` envelope、合法事件類型、唯一 ID 及嚴格 UTC 時間；故障或 malformed 回應保留上一次可信快照並顯示固定雙語提示；
- 用量 dashboard 同樣不屬於初始 bootstrap；只有 active member 進入或重新整理「用量」時才發出一條 15 秒、64 KiB 有界 GET。Browser 只接受 exact allowance／summary／events envelope、非負整數統計、固定事件 amount 及嚴格 UTC 時間；故障或 malformed 回應保留上一次可信 snapshot，成功則同步頂部 available／reserved 顯示；
- 私人品牌庫只列出目前 workspace 最近 20 個具 canonical digest 及正整數批准 revision 的品牌快照；每項只返回 UUID、七個已核准品牌欄位、批准 revision 及 UTC 建立時間，不返回 workspace／user identity、digest 或 Agent 其他 brief。Browser 只在進入或重新整理品牌庫時，以 15 秒、64 KiB 有界 GET 載入 exact `{ brandPacks }` envelope；malformed、重複 ID 或暫時故障保留上一次可信清單；
- 品牌快照 POST 只接受 exact `{ approvedRevision }`，Worker 必須重新讀取目前 workspace 的 Agent state，並只保存與該 revision 完全相符的 `approved` canonical brand。相同品牌欄位由 digest-backed unique identity 去重；首次確認建立返回 `201`，相同內容或不確定寫入後的 reconciliation 返回 exact `200` replay。Browser 對 transport／stream／deadline／`408`／`5xx` 最多以同一 revision 重試一次，其他狀態及 non-canonical success 不重送；
- 使用者可把單一品牌快照套用回工作台，這只帶回品牌欄位並立即令本機 Agent 批准及 Campaign Pack idempotency key 失效，必須配合目前商品及來源圖重新規劃。單筆 DELETE 維持 workspace-scoped `404`、`204` 及不確定結果 reconciliation；刪除品牌庫記錄不會改寫目前 Campaign Brief；
- 新邀請 workspace 取得六個技術性可用輸出，足以建立兩套 Campaign Pack。

詳情見 [`BETA_ACCESS.md`](BETA_ACCESS.md)。

## 4. Dashboard 資訊架構

- 左側：工作台、Campaign Packs、商品庫、品牌庫、素材庫、用量；owner／admin 另可進入活動記錄；
- 頂部：可用輸出數、目前 workspace、使用者及登出；
- 四步：商品資料、商品圖片、Agent 規劃、確認輸出；
- 三欄：雙語商業資料、私人商品圖、Campaign Agent；
- 成果區：三比例私人草稿、雙語文案、provenance、逐一審核、受控下載及重新建立；
- 使用指引：完整三步流程與私隱提示。

所有導覽都有實際 workspace view。沒有通知、workspace 切換或帳號選單功能時，不顯示假按鈕。示範預覽、排隊中、草稿待審核、已核准、需要修改及失敗狀態必須清楚區分。

### 視覺系統

- 背景 `#ffffff`；
- 主色 `#155eef`；
- 完成狀態 `#1aa876`；
- 文字 `#172033`；
- 邊界 `#e2e7ef`；
- 主要圓角 5–9 px；
- 系統字體配合 Noto Sans TC fallback；
- 動態只用於載入與狀態，並尊重 `prefers-reduced-motion`。

已接受的 desktop 視覺依據：`docs/design/aislestage-agent-workspace-concept.png`。

## 5. Agent 合約

每個 workspace 對應一個 Cloudflare Agents SDK Durable Object：

```text
idle -> needs-input -> awaiting-approval -> approved
```

Agent stub 建立或 state RPC 暫時失敗時，Worker 返回固定雙語 no-store `503`，不洩漏 Durable Object 細節。工作區 GET、plan 及 approve 都要求 exact `200 application/json`；GET 另要求 exact one-field state envelope，GET／plan／approve 再只套用完整、bounded 且 check／plan／message ID 唯一的 Agent state。Plan 回應須對應同一 canonical brief、planning stage，且 revision 高於送出時版本；approve 回應須確認要求的 revision、approved timestamp 及 replay 狀態。Plan 的單次 attempt 連完整 response 有 40 秒 deadline；因 plan 會推進 revision，transport／response stream 中斷／deadline、`408` 或 `5xx` 後不會再送第二次 mutation，只以 bounded GET 接受同 brief 且 revision 已前進的 authoritative state。Approve 每次 attempt 有 15 秒 deadline，並只會就上述暫時故障以相同 revision 重試一次。Validation／authorization／conflict、非 canonical success、錯誤 media type、額外外層欄位、任意 server error detail 或 malformed payload 不會重送或對帳，並保留目前計劃。Agent 動作完成前，畫面會鎖定 brief、來源圖、重複 planning／approval 及 Campaign Pack 建立，避免提交內容在途中改變。

- instance name 由 Worker 使用 session workspace ID 決定；
- browser 不可以直接讀寫 Durable Object storage；
- 只有 server callable method 可以改變 state；
- deterministic mode 使用固定規則；
- assisted mode 只可改寫 plan summary 與三個固定理由；
- provider 失敗時不批准、不排隊、不扣用量；
- browser 可見商業欄位與 Worker 共用同一組字元上限；Worker 會在資產查詢、可選 provider 呼叫及 Durable Object 寫入前驗證已提供欄位的型別、語言、清單項數與長度，避免靜默截短、丟棄或改寫商業資料；
- plan envelope 必須恰好包含一個非 null 的 brief object；缺失、null、array、primitive、額外外層欄位或 malformed JSON 不可用空 brief 覆蓋目前 revision；brief object 內缺少商業欄位仍會進入 `needs-input`；
- 不合規 brief 以不回顯原值的繁中／英文 `422` 拒絕，並保留目前有效 revision；缺少欄位則繼續使用 `needs-input` 流程；
- Agent 與確定性 compositor 共用文字 normalization、三比例換行參數及合併明細行數預算；無空格 SKU／型號按相同視覺單位安全拆行而不改動字元；超出安全區的商品名稱、價格、優惠、CTA、賣點或規格會提供雙語修正原因並停在 `needs-input`，更正及重新規劃後才可批准；
- approval body 必須恰好包含一個正整數 revision，不接受字串、boolean、額外欄位或數值轉換；同 revision 的併發／重送批准返回同一 `approvedAt` 與單一批准訊息，不重複改寫狀態或預留輸出；
- 每次重新規劃產生新的 revision。

## 6. 私人資產

- 只接受 PNG、JPEG、靜態 WebP；
- 最大 4 MB、單邊 8192 px，總像素不超過 32 MP；
- browser 與 Worker 都檢查基本類型／大小，Worker 再檢查 signature；PNG 必須具有效 critical chunk 次序、CRC、IDAT、IEND、indexed-color palette 容量，以及按 color type 對應長度、palette、唯一性與次序都合法的 `tRNS`；private PNG chunk 及未識別 WebP chunk 會被視為不可保留的自訂 payload；WebP 必須具一致 RIFF 長度、padding 及靜態 VP8／VP8L image chunk；
- 含 EXIF、XMP 或文字 metadata 的來源圖會被拒絕，原始檔名不會保存；
- browser 建立 multipart request 時已按 MIME 換成 generic 檔名，不傳送本機原始檔名；成功後只接受精確的 `201 application/json` asset envelope，UUID、canonical 名稱、MIME、位元組數及同源 preview path 必須與本次檔案一致，否則 fail closed，亦不向 workspace 顯示 server error detail；
- 私人來源圖庫 GET 只返回目前 workspace 最近 20 張具 digest 記錄的 PNG／JPEG／靜態 WebP；每項只包含 UUID、canonical generic 名稱、MIME、大小、同源 preview route 及 UTC 建立時間，不返回原始檔名、workspace／user、object identity 或 checksum。Browser 只在進入或重新整理商品庫時，以 15 秒、64 KiB 有界 GET 載入 exact `{ assets }` envelope；malformed 或暫時故障保留上一次可信清單；
- 使用者可從私人來源圖庫把單一已保存圖片選回工作台；這個 client 動作會清除本機 Campaign Pack idempotency key、令現有 Agent 批准失效並要求重新規劃。圖片實際 preview、Agent plan 及 Queue 仍各自重新核對 workspace 與 D1／R2 完整性；
- source object 存於 workspace-scoped private R2 key；
- 私人商品圖讀取先核對 workspace-scoped D1 metadata，再讀取 R2 object；成功 body 使用 `private, no-store` 及 `Cross-Origin-Resource-Policy: same-origin`，不能由同一 browser 在登出／換帳號後沿用，亦不可作為跨來源子資源嵌入。不存在或跨 workspace 維持 `404`，任一儲存層不可讀則回雙語 no-store `503 unavailable`，不輸出 object key、workspace ID 或底層錯誤；
- Worker 上傳時向 R2 提供 SHA-256，核對寫入回傳 checksum，並在 D1 保存同一 canonical digest；
- Browser 為每次商品圖上傳建立 UUID v4 idempotency key；Worker 在讀取 multipart 前驗證，並把它綁定 asset ID。同 workspace 以同 key 重送相同 MIME、size、digest 及 private object identity 會返回原 asset；不同內容 `409` fail closed，跨 workspace 不可 replay。不同 digest 使用分離的候選私人 object identity，並發衝突不會互相覆寫，敗方只清理未被 D1 row 引用的候選 object。每次 upload attempt 連 success body 讀取有 45 秒 deadline；transport／response stream 中斷／deadline、HTTP `408` 或 `5xx` 最多以同 key 自動重試一次，validation／authorization／conflict 或 malformed success 不重送；
- browser 只收到 asset ID 及授權 preview URL；
- 跨 workspace 返回 not found；
- Agent plan 在寫入 Durable Object 或呼叫可選 provider 前，先核對來源圖屬於目前 workspace 且 D1／R2 SHA-256、大小、MIME、asset kind 與 metadata 一致；preview、Agent 批准及 Queue 讀取亦會再次核對，任一不一致均不返回 object body、不改寫有效 revision、不批准亦不呼叫 provider；
- R2 驗收後若 D1 insert 回報失敗，Worker 會重新核對同 workspace、同 request-bound asset ID 的 canonical row；已提交且欄位完全一致則返回成功，明確未提交才清理剛建立的單一 R2 object。若 reconciliation 狀態不可讀，會 fail closed 而不盲目刪除可能已被 D1 引用的 object；
- 來源圖和輸出不得互相覆寫。
- 使用者可逐一刪除明確的商品圖或已完成輸出；browser client 每次只接受一個 bounded safe ID、呼叫一條同源 DELETE route 且不傳 body，只把 `204` 或 workspace-scoped `404` 當作已不存在。圖片刪除期間會鎖定上載、更換及再次刪除入口；私人輸出清單同一時間只容許一個刪除流程，並標示正在處理的項目。成功或失敗都會解除 UI 鎖，避免重複確認及競爭 DELETE。這個冪等操作有 15 秒 browser deadline；逾時保留本機項目及固定雙語錯誤，使用者可重試同一刪除並由 `204`／`404` 收斂。其他 2xx、處理中 conflict、授權或儲存故障均保留本機項目並顯示固定雙語訊息，不解析 server error detail。刪除前的 workspace-scoped D1 metadata 不可讀時回固定雙語 no-store `503`，不執行 R2、Agent 或 D1 mutation。商品圖只有在私人 R2 delete 完成後，才會在 Durable Object 內按 asset identity 重設目前實際引用它的計劃，再刪除 D1 記錄。若 R2 delete call 拒絕，後續的 D1 與 Agent mutation 不會執行；刪除同 workspace 的無關圖片亦不會清除現有 revision。商品圖及已完成輸出的最終 D1 DELETE 若回應不確定，會以 workspace-scoped row absence reconciliation 分辨已提交與仍可重試狀態，不會把保留的 retry anchor 誤報為成功。

## 7. Campaign Pack 與保真

正式 UI 固定提交三個已批准輸出。Browser client 會由一份無損 canonical brief、一個 source asset 及三組唯一且受支援的 workflow／ratio 重建八欄 request，套用 32 KiB UTF-8 cap；成功只接受 exact `202` creation 或 `200` idempotent replay envelope，再以共享 generation normalizer 綁定 UUID、pack identity、輸出數量、批准 revision 及完整 output set，額外欄位或任意 server error detail 不進入 workspace。每次 attempt 連完整 64 KiB response 有 30 秒 deadline；transport／response stream 中斷／deadline、HTTP `408` 或 `5xx` 最多以同一 canonical body 及 idempotency key 自動重試一次，validation／authorization／allowance 或 approval conflict／non-canonical success 不重送。Request 及 bounded polling 期間會鎖定 approved brief、source image mutation、Agent 重規劃及重複建立入口，成功或失敗後才解除。Campaign Pack API 只接受 contract 指定的八個外層欄位，每個 output 只接受 `workflowId` 與 `aspectRatio`，Brief／brand／product 亦只接受已知欄位；未知欄位或 malformed envelope 會在任何批准查詢、額度預留或資料寫入前以 `400` 拒絕。單輸出相容 route 套用相同內層 schema 及完整 GenerationInput 外層鍵集合。D1 會在同一 batch 建立 pack、三個 reservation 及三個 generation records；不足三個可用輸出時不留下部分 pack。若 batch 已提交但 D1 回應失敗，Worker 會在 Queue 發送前以 exact pack、canonical queued rows、未產生 output 的初始狀態及唯一 reservation ledgers 對帳；完整相符才視為建立成功，明確不存在才查找同 idempotency key 的併發結果，衝突則 fail closed。若對帳暫時不可讀，仍會發送只含本次 server-generated IDs 的 bounded Queue batch 以避免已提交工作滯留，但向 client 返回通用 `503`；沒有對應 D1 row 的 Queue delivery 不會取得處理權。重送相同 idempotency key 只有在 canonical generation identities（revision、brief、asset、workflow 及比例）完全相同時才返回原有 pack；同 key 搭配不同請求會 `409`，不改寫既有 pack 或額度。

若 pack commit 與 Queue send 已成功，但最終 generation snapshot 暫時不可讀，API 返回固定雙語 no-store `503`，保留 queued rows 與 reservation 且不重送 Queue。正式 UI 保留原 idempotency key；相同請求重試會以 canonical replay 返回原 pack／generation IDs。Replay 可能已 queued、processing、completed 或 failed，browser 必須先重新讀取 authoritative session allowance，不可再次一律扣減／reserve 三個輸出；terminal replay 會立即套用並完成額度刷新，不需多等一次 generation poll。

建立成功後的 browser poll 只綁定該 pack 的 exact 三個 generation IDs，最多執行 16 個固定 interval。暫時讀取失敗會保留最後可信快照；任何成功讀取都會重設連續失敗計數，第三次連續失敗才解除鎖並顯示「已排隊、狀態暫不可讀」的雙語恢復提示，同時盡量刷新 authoritative allowance。只有三個目標 ID 全部 terminal 才宣告完成；到達 bounded window 而仍在 queued／processing，會引導使用者稍後從 Campaign Packs 再讀取，不會把 Queue 中工作誤畫成建立失敗。進入 Campaign Packs／素材庫或明確按「重新載入」時會序列化執行一個 15 秒 bounded generation-list GET；審核／刪除期間停用，較舊 hydration／refresh 亦不能覆蓋較新 snapshot 或登出狀態。失敗保留現有 rows 並在 collection view 顯示固定雙語錯誤，公開 Demo 不發私人 request。

在上述 reservation 之前，Campaign Pack 與單輸出 route 均會重新確認 active workspace scope 及商品 asset ownership。Workspace／asset D1 preflight 不可讀時返回固定雙語 no-store `503 unavailable`，而不是 `400`／`404`；不建立 Campaign Pack、generation、ledger、reservation 或 Queue message。

單輸出相容 route 的 reservation batch 或 generation INSERT 若回報失敗，會以同一 server-generated generation ID 核對唯一 reservation ledger 及完整 canonical queued row。已提交狀態會繼續至 Queue send；明確沒有 generation row 才退回 reservation；未知或衝突狀態不會盲目釋放額度或留下一筆已知未入 Queue 的 queued row。

Queue claim UPDATE 回應不確定時，本次 delivery 不會執行 provider 或建立 R2 output。前三次 attempt 內，仍為 queued、同 attempt processing 或暫時無法讀取的狀態會保留 reservation 並延遲重試；terminal／missing／較新 attempt 狀態不會被舊訊息改寫。確認 claim 後，processing attempt 會貫穿 canonical 讀取、provider 前後重核、R2 前重核、completion、retry 及 terminal mutation；較舊 delivery 即使在 R2 put 後才發現接管，也只清理未被引用的 object。下一個較高 attempt 可恢復工作，最後仍只會 settlement 或 release 一次。

確定性程式負責：

- 原始商品位元組及幾何；
- 品牌、商品名、價格、優惠、賣點、規格及 CTA；
- XML escaping、文字安全區及固定比例；
- 1:1 1080×1080、4:5 1080×1350、9:16 1080×1920；
- 私人 SVG 保存與 restrictive response headers。

Queue 完成及 allowance settlement 不等於可交付。每個輸出會保存通用 composition version、generation mode、批准 revision 及正文 SHA-256；R2 在寫入時核對同一 checksum，初始審核狀態固定為 `draft`。Completion batch 回報失敗時會重新核對 D1 completed row、R2 canonical metadata 及 settlement ledger；已原子提交則保留 output 並 ack，明確未提交才清理 object 及 bounded retry，不可判定時不盲目刪除可能已有 D1 reference 的私人輸出。審核 decision 以條件更新保持併發安全；初始 D1 generation row 或批准所需 R2 metadata 不可讀時在任何 UPDATE 前回雙語 no-store `503` 並保持 draft。同一決定可安全重送，相反決定不可覆蓋已完成的審核；review UPDATE 回應不確定時，只有同 workspace／generation、completed 狀態、目標 decision、expected revision 及 reviewed timestamp 完整相符才恢復為 replay，仍為 draft 則返回 `503` 並保持不可下載。UPDATE 已成功而最終 generation reload 不可讀時同樣返回可重試 `503`；重送相同 decision 會以 replay 恢復已提交結果。Browser 提交前會重新驗證目前 completed draft，只傳 decision 與 expected revision；同一時間只執行一個審核，每次 attempt 連完整 response 有 15 秒 deadline，transport／response stream 中斷／deadline、HTTP `408` 或 `5xx` 最多以同一 generation／decision／revision 自動重試一次，authorization／validation／conflict／non-canonical success 不重送，兩次失敗保持原 draft 並解除 UI 鎖。成功回應須是 exact `200 application/json`，保持 generation／pack identity、workflow、比例、content metadata、created time、image route 及 provenance 不變，並精確確認目標 review state 與受控 download route，否則不更新畫面，亦不顯示任意 server error detail。每次 approve、preview 及 download 亦會核對 D1 的正式 SVG content type／SHA-256 與私人 R2 的 checksum／HTTP／provenance metadata；正文、workflow、批准 revision、composition version 或 generation mode 任一不一致都會 fail closed，不寫入核准決定或返回 object body。

Preview／已批准 download 的成功 SVG body 使用 `private, no-store` 及 `Cross-Origin-Resource-Policy: same-origin`，所有錯誤亦使用 `private, no-store`，避免跨來源子資源嵌入及 browser cache 跨 session 保留私人輸出。Scoped D1 generation metadata 或 R2 output object 暫時不可讀時回雙語 no-store `503 unavailable` 且不返回 SVG；真正不存在／跨 workspace 維持 `404`，canonical integrity 失配維持 `409`，固定 log 不包含私人識別資料。

Browser generation list 在任何 JSON parse 前要求 exact `200 application/json`，成功亦只接受 exact `{ generations }` envelope，再套用最多 20 項、唯一 ID、完整 review／provenance 與同源 route normalizer；額外 outer fields 不會進入 workspace。

Browser 對私人 hydration response 以 decoded stream 實際位元組數設定 parse 前上限：health 4 KiB、session 16 KiB、workspace activity／output usage／product-source／brand snapshot list 64 KiB、generation list 128 KiB、Agent state 256 KiB。`Content-Length` 只能預先拒絕，不取代實際 stream 計數；超限 response 不會改變登入、功能 gate 或任何既有可信 snapshot。

Session、health、workspace activity、output usage、product-source list、brand snapshot list、generation list 及 Agent state GET 都有 15 秒 browser deadline。到期後初始 bootstrap 會離開 loading；on-demand view 則保留上一次可信 snapshot 並顯示固定雙語錯誤，不以 GET timeout 猜測任何 mutation 是否已提交。

同一個 mounted workspace 的並行初始 bootstrap 會共用一個 in-flight request coordinator：session／health 各一次，只有確認登入後才讀 generation list／Agent state。完成或失敗後立即清除 promise，不跨 reload 保留私人 cache；effect teardown、登出及較新 session hydration 會使舊 epoch 失效，舊輸出或 Agent 快照不可重新進入畫面。

私人 mutation success response 同樣先限制 decoded stream：logout 1 KiB、product upload 4 KiB、password auth／output review 16 KiB、Campaign Pack 64 KiB、Agent action 256 KiB。超限回應只進入固定雙語錯誤，不會改變工作區狀態或人工決定。

`deterministic` 不接觸外部 provider。`assisted` 只可加入背景方向，商品與文字仍經同一確定性合成。圖片 adapter 只接受 1–4,000 字元 prompt、空的 reference URL 清單及已知比例；其他輸入會在 provider egress 前拒絕。圖片比例由 server-side mapping 同時決定 provider request size 及預期 IHDR；回傳 PNG 尺寸必須精確相符，不能靠後續裁切修正。任何 provider PNG 回應在合成前都須通過 base64／8 MiB 壓縮資料上限、完整 PNG container CRC／次序／`tRNS` 語義／終止結構，以及與來源上載共用的單邊 8192 px／32 MP 尺寸和 EXIF／文字 metadata 拒絕規則。IDAT 另以最多 128 MiB 的 streaming decoded scanline 驗證 zlib、IHDR 長度與 filter；無效、不可解碼、超限、尺寸錯誤或帶 metadata 的回應 fail closed，不會寫入可審核輸出。SVG 是目前正式支援格式；PNG／JPEG 不屬於輸出合約。

## 8. Cloudflare 架構

```text
Static Assets -> React SPA
Worker API -> D1 + private R2 + CampaignAgent Durable Object
Campaign Pack -> Queue batch -> deterministic compositor -> private R2
D1 mutation triggers -> privacy-minimized workspace activity metadata
Cron Trigger -> expired session, auth-attempt and invite-retention cleanup
```

公開 repository 只保存 generic binding 名稱與 placeholder。實際帳戶、D1 identifier、資源名稱、URL、secret 及營運資料留在受保護部署設定。

外部 AI 不屬於預設資料路徑。只有 provider、資料處理、品質及成本閘門全部明確開啟時，`assisted` provider 才可提出背景方向或受限建議；商品原圖、準確文字、批准、output ledger 與正式交付仍由本地合約控制。付款則保持 disabled、provider-neutral，並與 Campaign Pack domain 分離。

## 9. 驗收標準

- 真實使用者不會預填 demo 商業資料；
- 已保存 Agent brief 可在重新登入後恢復；
- 修改 brief 或商品圖後不可沿用舊批准；
- 一次請求只建立一套三輸出 pack；
- 重送、Queue duplicate delivery 及 enqueue failure 不會重複預留；
- 商品圖、價格、優惠、CTA 及雙語文案可逐項核對；
- 完成輸出預設為草稿，只有 owner／admin 核准後才返回 download URL；重送及相反決定併發不會覆蓋首個審核結果；
- D1 與 R2 的 output SHA-256／format／provenance metadata 不一致時，不可核准，preview 與 download 亦不返回私人 object body；
- D1 與 R2 的來源圖 SHA-256／大小／MIME／provenance metadata 不一致時，不可預覽或批准，Queue 亦不可開始 provider work；
- 私人來源圖庫只列目前 workspace 的有界安全 metadata；選用其他來源圖後不可沿用舊 Agent 批准，跨 workspace、原始檔名及 R2 identity 不可取得；
- owner／admin 可讀的活動快照只限目前 workspace 及最小必要 metadata；member、跨 workspace、內容欄位及原始檔名均不可取得；
- 匿名及跨 workspace 不可讀取私人資料；
- deterministic mode 不接觸 provider；
- desktop、mobile、keyboard focus、無水平溢出及破圖檢查通過；
- type check、Workers integration tests、production build、Wrangler dry-run 及 dependency audit 通過；
- migration、部署版本、live routes 與 Git main 對應同一個已驗證 SHA。
- public release gate 對 tracked／staged／擬加入檔案、生成 bundle 及 Git metadata 完成掃描，而且只報告 path 與問題類別；
- 任何 assisted 評估都使用合成 fixture、固定限制、人工評分與 deterministic fallback，不直接成為正式交付證據。
