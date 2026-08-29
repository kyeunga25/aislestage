# 發佈狀態 / Release status

本頁只記錄可由 repository 或正式環境核對的公開狀態，不記錄私有基礎設施映射、使用者資料、營運資料或商業規劃。

## v0.6.0 development status

- [x] contact-first、invite-only 產品合約與 public/private route 邊界完成；
- [x] assisted provider、資料處理、固定評估、預算與全域 kill switch 採 fail-closed 設定；
- [x] provider-neutral payment boundary 保持 disabled，沒有 checkout 或付款狀態宣稱；
- [x] public repository egress gate 納入本機及 CI；
- [x] workspace status、Queue、allowance、provider 與 observability 合約經測試核對；
- [x] 圖片 adapter 在 egress 前限制 prompt 為 1–4,000 字元、reference URL 清單為空且比例必須已知；不支援輸入不會 fallback 或發出 provider request。provider success response 具實際 byte／chunk、MIME／UTF-8、exact field、文字長度與 base64 邊界；解碼 PNG 另核對完整 container chunk order／CRC／`tRNS` 語義／IDAT／IEND、共用 8192 px／32 MP 尺寸上限、EXIF／文字 metadata，以及 128 MiB bounded streaming zlib／scanline／filter；1:1、4:5、9:16、16:5 的 request size 與回傳 IHDR 由同一 mapping 精確綁定，尺寸錯誤等無效回應不落盤並在終止失敗時只釋放一次 reservation；
- [x] provider header／body／PNG decompression 共用 30 秒 deadline；逾時的 bounded Queue retry 及 terminal allowance release 經隔離 integration 測試核對；
- [x] 完成輸出預設為私人草稿，owner／admin 的不可變審核決定與逐項受控下載已通過隔離 integration 及 browser QA；
- [x] 審核前的 scoped D1 generation row 或 approve R2 `head` 暫時不可讀時回雙語 no-store `503`；不執行 review UPDATE，draft／reviewed timestamp 保持不變；
- [x] review UPDATE ambiguous commit 以 workspace-scoped generation、completed state、target decision、expected revision 及 reviewed timestamp reconciliation；已提交以 replay 回覆，未提交保持 draft／不可下載；
- [x] review UPDATE 成功後的 authoritative reload 不可讀時回可重試 `503`；相同 decision 重送會讀取已提交不可變狀態並以 replay 恢復，不重複 mutation；
- [x] browser 同一時間只執行一個審核 action；每次 attempt 連完整 response 有 15 秒 deadline，transport／response stream 中斷／deadline／`408`／`5xx` 最多以同一 generation／decision／revision 自動重試一次，兩次失敗後保留 draft 並解除 UI 鎖；authorization、conflict、malformed／oversized success 不重送；
- [x] browser review client 只提交 decision／expected revision，並以共享 normalizer 及 immutable identity／workflow／ratio／content／provenance binding 驗證 exact `200 application/json` success envelope；不相符 payload 或任意 server error detail 不會進入 workspace state；
- [x] Queue output SHA-256 經 R2 寫入驗收；approve／preview／download 在 D1 與 R2 digest、MIME 或 provenance metadata 不一致時 fail closed；
- [x] 私人 preview／已批准 download 的 scoped D1 metadata 或 R2 object 暫時不可讀時回雙語 no-store `503 unavailable` 且不返回 SVG；404／409 語義與私隱 log 邊界保持不變；
- [x] Queue completion batch 的 ambiguous commit 會核對 completed row、R2 metadata、draft state 與 settlement ledger；已提交保留 output，明確未提交才清理及重試；
- [x] 來源商品圖 SHA-256 經 R2 寫入驗收；Agent plan 在 DO mutation／provider work 前核對 workspace ownership 與 D1／R2 digest、大小、MIME、provenance，preview／approve／Queue 亦再次核對；missing／跨 workspace／失配不覆蓋既有 revision；
- [x] 私人商品圖 GET 的 scoped D1 metadata 或 R2 object 暫時不可讀時回雙語 no-store `503 unavailable`；不存在／跨 workspace 保持 `404`，固定 log 不包含私人識別資料；
- [x] 商品圖 D1 insert 的 ambiguous commit 會以 request-bound asset ID 與 canonical 欄位 reconciliation；已提交不刪 R2，明確未提交才補償刪除 object；
- [x] pre-onboarded Access subject UPDATE ambiguous commit 以 exact user／email／name／subject hash／auth mode／status post-read reconciliation；未提交返回 `unavailable` 並可安全重試；
- [x] PNG critical chunk／CRC／結尾、indexed-color PLTE bit-depth 容量、`tRNS` 色彩類型／長度／palette／唯一性／次序，以及靜態 WebP RIFF size／padding／VP8／VP8L header 採 bounded 結構驗證；private PNG 與 unknown WebP 自訂 payload 會拒絕，而 public PNG color chunk、合法透明度及標準 extended WebP fixture 保持可用；signature-only、truncated、checksum／length 失配、超額 palette、無效透明度與無 image data 上傳均在 D1／R2 前 fail closed；
- [x] PNG IHDR、JPEG frame、WebP VP8X／VP8／VP8L header 尺寸在解碼前限制為單邊 8192 px 及 32 MP；三種 oversized fixture 均不建立 D1／R2 asset；
- [x] PNG chunk、JPEG structural marker 與 WebP chunk 掃描均採固定 4,096 traversal-count 上限；過度分段 JPEG 在寫入 D1／R2 前 fail closed；
- [x] scheduled auth cleanup 刪除過期 session、7 日前 auth attempt、過期 pending／revoked invite hash 及 30 日前 used invite linkage，同時保留仍有效／近期記錄；
- [x] password／invite registration batch ambiguous commit 以 server-generated user／workspace IDs、canonical account fields、owner membership、初始 allowance 及 invite linkage reconciliation；已提交可建立 session，其他同 email 帳號不可冒充本次成功；
- [x] session INSERT ambiguous commit 以本次 token hash、user ID 與 exact expiry reconciliation；完整相符才發出原 hardened cookie，其他狀態不回傳 token 識別資料；
- [x] password session／active user／workspace membership 讀取不可用時，`/api/session` 及受保護 API 回雙語 no-store `503 unavailable` 並保留 cookie；只有已確認無效 session 才清 cookie；
- [x] 前端 bootstrap loader 要求 exact `200 application/json`，並只接受 active user／workspace、合法角色、safe-integer allowance 及跨欄位一致的 restricted health envelope；session 非成功 body 不解析，Access 分類只使用 bounded `x-aislestage-access-failure` header，malformed／矛盾成功回應 fail closed，不會開啟 client feature controls；
- [x] hydration JSON 共用 bounded stream reader：health 4 KiB、session 16 KiB、generation list 128 KiB、Agent state 256 KiB；`Content-Length` 只作預檢，實際 decoded bytes 超限仍取消 body 並保留既有 snapshot；
- [x] session／health／generation list／Agent state GET 共用 15 秒 AbortController deadline；到期釋放 loading、保留既有 snapshot 並返回固定雙語 unavailable，mutation 仍由 endpoint reconciliation 處理；
- [x] mounted workspace 的並行初始 bootstrap 以 settle 後清除的 single-flight coordinator 合併 StrictMode request；未登入不讀 generation／Agent，effect cleanup／logout／較新 session epoch 阻止舊私人快照回寫。合成 browser QA 證明每次 load 四條 GET 各一次、reload 重新各讀一次且 390 px 無 overflow；延遲的 workspace A 快照亦不能覆蓋登出後重新登入的 workspace B；
- [x] mutation acknowledgement 亦使用 bounded stream reader：logout 1 KiB、product upload 4 KiB、password auth／output review 16 KiB、Campaign Pack 64 KiB、Agent action 256 KiB；超限 success body 不會套用狀態；
- [x] password auth client 採 6 KiB UTF-8 總量及逐欄界限；login 不傳註冊／邀請欄位，register 只在 invite mode 傳邀請碼；login／register 分別要求 exact `200`／`201 application/json` 再共用 active-session schema，任意 server error detail 不會反映到表單；
- [x] password login／register 只作一次 30 秒 bounded POST，不自動重送 password、invite 或 account mutation；transport／stream／deadline／`408`／`5xx` 只以 bounded session GET 對帳 exact email，以及註冊的 name／workspace／owner identity；處理期間 tabs、credentials 及重複 submit 保持鎖定；
- [x] session 授權後的 `/api/workspaces` 清單重讀失敗會回雙語 no-store `503 unavailable`，不洩漏 D1 錯誤、不改變 session，亦不回傳不完整清單；
- [x] `/api/generations` 的 active workspace scope 或最多 20-row 清單查詢不可讀時回雙語 no-store `503 unavailable`，不回傳空白／部分清單；跨 workspace 保持 `404`；
- [x] 前端 generation list 先要求 exact `200 application/json` 及 exact `{ generations }` envelope；normalizer 只接受最多 20 項、唯一 ID、完整狀態／provenance 及 exact same-origin output routes，網絡、非 canonical status、額外欄位、外部 URL 或 malformed 回應保留 session／既有輸出；
- [x] 私人 product-source GET 只列目前 workspace 最近 20 張具 digest 記錄的 PNG／JPEG／靜態 WebP，並只返回 UUID、canonical generic 名稱、MIME、大小、同源 preview route 及 UTC 時間；原始檔名、object／workspace／user identity 與 checksum 不進入清單；
- [x] product-source client 採 on-demand 15 秒／64 KiB exact envelope 與逐項 schema；malformed、跨 workspace 或暫時故障保留可信清單，選用另一張來源圖會失效舊 Agent 計劃並返回工作台；
- [x] 商品庫的 strict refresh 與序列化單項刪除已通過 component／integration tests；列表、選用、返回工作台、目前使用及私隱提示另通過 1440 px／390 px browser QA，沒有水平溢出或 app console warning／error；
- [x] 商品圖上載／刪除、Campaign Pack 建立、輸出批准／拒絕／刪除以 D1 trigger 與核心 mutation 原子記錄最小必要活動 metadata；
- [x] owner／admin 專用活動 API 只返回目前 workspace 最近 50 項操作類型、UTC 時間及可選操作者名稱；member、跨 workspace、subject ID、原始檔名、brief／input JSON 及底層錯誤均不可取得；
- [x] 活動 view 採 on-demand 15 秒／64 KiB strict loader，故障保留可信快照；desktop 與 390 px 導覽、keyboard-accessible name、無水平溢出及無 console error 已完成 browser QA；
- [x] Campaign Pack browser client 使用 32 KiB canonical request、三組唯一合法輸出，並以 exact `202` creation／`200` replay envelope 綁定 UUID、pack identity、輸出數、revision 及完整 workflow／ratio set；不解析任意 server error detail；
- [x] Campaign Pack 每次 browser attempt 連完整 response 有 30 秒 deadline；transport／response stream 中斷／deadline／`408`／`5xx` 最多以同一 canonical body／idempotency key 自動重試一次，其他結果不重送；request／polling 期間鎖定 brief、來源圖、重規劃及重複建立入口；
- [x] Pack 建立後的 poll 綁定 exact 三個 generation IDs 與 16 個固定 interval；成功讀取重設 failure count，最多容許兩次連續暫時 GET 故障並保留最後可信快照，第三次才以雙語 queued-but-unavailable 狀態解除鎖，不誤報建立失敗；
- [x] 進入／手動重新載入 Campaign Packs 或素材庫會序列化執行單一 15 秒 bounded generation-list GET；審核／刪除期間停用，request epoch 阻止舊 hydration／refresh 覆蓋新 snapshot 或登出狀態，故障保留 rows 並在 collection view 顯示雙語錯誤；Demo 不發私人 request；
- [x] session `last_seen_at` 保持不延長 expiry 的 best-effort telemetry；寫入失敗不會推翻已核實的 active user／workspace authorization；
- [x] logout DELETE ambiguous commit 只在同一 token-hash row 已不存在時清除 cookie；未提交或不可讀保留 retry anchor 並返回 `503`；
- [x] password browser logout 只在 exact `200 application/json { "ok": true }` 後清空私人 state，故障時保持登入並可重試；Access logout 使用固定同源 path，不接受 response-controlled redirect；
- [x] password logout 每次 attempt 連完整 response 有 15 秒 deadline；transport／response stream 中斷／deadline／`408`／`5xx` 最多以同一 cookie 自動重試一次，兩次失敗後解除按鈕並保持登入；authorization、malformed／oversized success 不重送；
- [x] auth-attempt INSERT ambiguous commit 以 server-generated event ID、email／IP hashes 及 event type reconciliation；已提交不重複，真正缺失或不可讀維持 fail closed；
- [x] invite CLI 只接受明確列出的唯一參數；未知、位置、重複、缺值、不合法 account type 及受保護 flags 均在產生邀請或執行 Wrangler 前 fail closed；
- [x] owner onboarding CLI 必須明確且唯一選擇 local／remote target；未知、位置、重複、帶值、缺少／衝突 target 及混合 self-test flags 均在讀取 identity 或執行 Wrangler 前 fail closed；
- [x] JSON／multipart 寫入只接受精確、大小寫不敏感的 base media type；合法 charset／boundary 參數保留，substring lookalike 會取消未讀 stream，並在 password verification 或 endpoint mutation 前返回 `415`；
- [x] Campaign Agent stub acquisition／state RPC 失敗回固定雙語 no-store `503`；前端只套用完整 bounded state envelope，暫時或 malformed 回應保留目前計劃而不偽裝成 `idle`；
- [x] Agent GET／plan／approve 都要求 exact `200 application/json`；GET 另要求 exact `{ state }` envelope，三者共用 bounded、unique-ID normalizer，分別綁定 canonical brief 與 requested revision／timestamp／replay marker；非 canonical status、錯誤 media type、額外 outer field、malformed state 或 server detail 不會套用；
- [x] Agent plan 以單次 40 秒 bounded attempt 配合 authoritative GET 對帳，transport／response stream 中斷／deadline／`408`／`5xx` 後只接受相同 brief、較新 revision，不會重送非冪等 mutation；approve 對同類暫時故障以每次 15 秒 deadline 最多同 revision 重試一次；處理期間 brief、來源圖與重複動作保持鎖定；
- [x] 商品圖刪除只在 workspace Agent 的目前 brief 引用同一 asset ID 時重設 plan；刪除無關來源圖及重送刪除不會清除既有 revision，前端會重新載入 authoritative state；
- [x] 商品圖／已完成輸出的 scoped delete preflight metadata 不可讀時回固定雙語 no-store `503`；D1 row、私人 R2 object 及 Agent revision 均不變；
- [x] browser delete client 每次只接受一個 bounded safe ID、same-origin route 與空 body；只把 `204`／workspace-scoped `404` 視為 absent，使用 15 秒 deadline 釋放 stalled action，逾時及其他狀態保留 UI 項目且可安全重試，不反映任意 server error detail；
- [x] 商品圖片刪除期間鎖定所有圖片 mutation 入口；私人輸出清單同一時間只執行一個刪除並標示目標，成功或失敗都會解除 UI 鎖，避免重複確認及競爭 DELETE；
- [x] synthetic R2 delete failure 會保留 D1 retry anchor 及 Agent revision；只有 R2 delete 完成後才按 asset identity 重設 plan；
- [x] 商品圖 D1 DELETE ambiguous commit 會核對同 workspace／asset type row；已提交回覆冪等 `204`，未提交保留 D1 retry anchor 並可再次完成刪除；
- [x] 已完成輸出的 D1 DELETE ambiguous commit 會以 workspace-scoped row absence reconciliation；已提交回覆冪等 `204`，未提交保留 retry anchor 並可再次刪除；
- [x] `/app` 與 `/app/*` 採 Worker-first，工作區 shell 在 Access JWT 及 active D1 membership 驗證後才返回；
- [x] feature branch 的完整 repository checks，以及 390–1280px browser／visual QA 完成；
- [ ] fixed-SHA PR、正式 deployment 及 live acceptance 完成。

本段是開發清單，不是 preview 或 production 完成聲明。只有所有證據對應同一已審核 SHA 後才可改為 verified release。

## v0.5.1 verified release

- [x] 1280px 原生 desktop viewport 的 Hero 預覽卡密度與概念稿重新對照；
- [x] mobile breakpoint 維持無水平溢出；
- [x] GitHub CI、merge、active deployment、tag／release 及最終截圖驗證。

## v0.5.0 verified release

- [x] 公開繁中／英文產品主頁及 `/app` 私人工作區路由；
- [x] desktop／mobile 無水平溢出，導覽、語言切換及 deep route browser QA；
- [x] Cloudflare Access RS256 JWT、issuer、audience 及 identity claim 驗證；
- [x] Access subject hash 綁定、active D1 membership 與受控 beta workspace 建立；
- [x] Access subject／email 初始 D1 lookup 不可讀時回 no-store `503 unavailable`；不洩漏原始錯誤，亦不誤報未獲邀或 membership denial；
- [x] Access auto-provision batch post-commit failure 以 exact active subject／email 恢復；未提交或 reconciliation 不可讀回 `503 unavailable`，不誤報 membership denial；
- [x] Access 模式停用密碼登入／註冊，並使用同網域 Access logout；
- [x] password auth event 未提交或 rate-limit count 不可讀時返回雙語 no-store `503`；成功憑證不建立 session，亦不以廣泛 catch 隱藏其他錯誤；
- [x] auth event 以同一 server-generated ID／exact hashes 做一次有界重試；post-commit failure 與 transient pre-commit failure 均只留下單一 event；
- [x] session INSERT 未提交或 authorization reload 失敗時返回雙語 `503` 且不發 cookie；不可讀狀態會最佳努力清理唯一未交付 session row；
- [x] 缺少設定、缺少 token、錯誤 audience、未獲邀身份及重複請求的 integration tests；
- [x] 正式 Access application、allow policy、D1 migration 及 active deployment 驗證；
- [x] GitHub PR checks、merge SHA、tag／release 及 local/origin/main 一致性。

## v0.4.0 repository contract

- [x] React 19、Vite 8、TypeScript 7 及目前 Wrangler／Workers types；
- [x] Wrangler-generated binding types 納入 `npm run check`；
- [x] active session + active workspace authorization；
- [x] closed／invite／open registration server gates；
- [x] email-bound one-time invite hash contract；
- [x] private R2 商品圖、4 MB 限制、MIME + signature 檢查；
- [x] browser multipart 不傳送本機原始檔名；upload success 只接受 exact `201 application/json` 及與本次 File 完全相符的 UUID、canonical 名稱、MIME、size 及同源 preview path，malformed response 與 server error detail 均 fail closed；upload pending 時所有圖片 file-input／更換／刪除入口都鎖定，避免競爭 mutation；
- [x] product upload 要求 client UUID v4 idempotency key 並綁定 asset ID；同 workspace 同 key／同 canonical content replay 原 `201`，不同內容固定 `409`，跨 workspace 不可 replay；digest-separated 候選 R2 object 令並發 conflict 不互相覆寫，敗方只清理未被 D1 引用的 object；
- [x] browser upload 每次 attempt 連完整 response body 有 45 秒 deadline；transport／response stream 中斷／deadline／`408`／`5xx` 最多同 key 自動重試一次，兩次失敗後釋放 UI；`4xx`、malformed／oversized success 不重送；
- [x] workspace-scoped Campaign Agent 與 revision approval；
- [x] 繁中／英文商業資料由使用者明確提供；
- [x] Campaign Brief 使用共享欄位上限並在 Agent state mutation 前拒絕會被靜默截短、丟棄或改寫的輸入；
- [x] Campaign plan 嚴格驗證單一 brief object envelope，malformed／null／額外外層欄位不改寫有效 revision；
- [x] Agent plan、Campaign Pack 及單輸出共用已知 Brief／brand／product 欄位集合，未知欄位 fail closed 且不寫入 state、allowance 或 input JSON；
- [x] Agent 與 compositor 共用三比例換行／明細行數 validator，任一比例超界的商業文字更正前不可批准或預留輸出；
- [x] 無空格 SKU／型號 token 會按共用視覺單位有界拆行，不丟失或替換商業字元；
- [x] Agent approval 嚴格驗證單一正整數 revision，並在同 revision 併發／重送時保持冪等；
- [x] 修改資料後前端計劃立即失效，Worker 再獨立比對；
- [x] atomic + idempotent 三輸出 Campaign Pack API；
- [x] Campaign Pack 只接受精確外層欄位及二欄 output envelope，未知欄位不會預留額度或建立記錄；
- [x] Campaign Pack idempotency key 綁定完整 canonical generation identities，同 key 不同 payload fail closed；
- [x] Campaign Pack／單輸出在 reservation 前重讀 active workspace 及 asset ownership；任一 preflight 不可讀回雙語 no-store `503`，且不建立 pack／generation／ledger／Queue message；
- [x] Campaign Pack D1 batch ambiguous commit 以 server-generated pack／generation IDs、canonical queued rows 及唯一 reservations reconciliation；已提交仍送入 Queue，無對應 row 的 delivery 安全 no-op；
- [x] Campaign Pack commit／Queue send 後的 final generation snapshot 不可讀時回固定雙語 no-store `503`；保留 queued／reservation，同 idempotency key 重試恢復原三個 IDs 且不重送 Queue；
- [x] Campaign Pack replay 先重新載入 authoritative session allowance，不重複套用固定三輸出的本機 reservation 推算；terminal replay 立即套用並略過額外 poll；
- [x] 單輸出 reservation batch／generation INSERT ambiguous commit 以 generation ID、唯一 ledger 及 canonical queued row reconciliation；已提交繼續入 Queue，明確無 row 才退回；
- [x] Queue claim UPDATE 回應不確定時不執行 provider／R2 work、不提前 release；queued／同 attempt processing／暫時不可讀狀態保留 reservation 並由下一 attempt 恢復；
- [x] processing attempt fence 覆蓋 canonical／approval／asset 重核、completion、retry 及 terminal mutation；舊 attempt 在 provider 或 R2 後被接管均不會覆寫較新狀態，未引用 object 會清理；
- [x] Queue batch failure 全數退回、duplicate delivery 冪等；
- [x] deterministic 1:1、4:5、9:16 private SVG；
- [x] raw OpenAI Responses structured-output 解析與 validator；
- [x] protected workspace shell、private product preview、output preview 及 approved download 均使用 `private, no-store` 與 `Cross-Origin-Resource-Policy: same-origin`；shell 另由 Worker 固定 CSP anti-framing／base／form、`X-Frame-Options: DENY`、no-referrer、no-sniff 及 restrictive Permissions Policy，不依賴 ASSETS response；browser 不可跨 logout／account change 重用私人 body，跨來源頁面亦不可作為子資源嵌入；
- [x] 單一私人商品圖／已完成輸出刪除與跨 workspace 拒絕；
- [x] Campaign Packs、商品、品牌、素材及使用指引視圖；
- [x] desktop／mobile responsive browser flow；
- [x] tracked config 只含 placeholder，正式設定由 protected variables 生成；
- [x] invite 建立工具只把 hash 寫入 D1，邀請碼只顯示一次。

## Required release evidence

每次正式發佈都必須重新取得以下證據：

- clean `git diff --check`；
- `npm run check`；
- 全部 Workers integration tests；
- production frontend build；
- Wrangler dry-run；
- production dependency audit；
- public repository egress check；
- D1 migrations 已套用；
- GitHub CI 對應準確 head SHA；
- active Cloudflare deployment 對應同一已審核 commit；
- live health、registration gate、匿名 401、security headers、desktop／mobile UI；
- 最終 local `main`、`origin/main`、merge commit 與 deployment version 一致。

部署結果只能在上述證據完成後標示為正式可用；preview 或單一命令成功不足以代表發佈完成。

## v0.4.0 verified release

2026-07-26 已完成以下發佈驗收；記錄只保留公開可披露的結果，不包含正式網址、帳戶識別碼、D1 identifier、實際資源名稱或測試憑證：

- [x] `git diff --check`、TypeScript／binding type check、36 個 Workers tests、production build、Wrangler dry-run 及 production dependency audit 全部通過；
- [x] GitHub pull request CI 對應已審核提交並通過，私隱字串檢查沒有發現受保護設定或內部商業資料；
- [x] D1 migration 已套用，active Cloudflare deployment 對應已合併的同一版本；
- [x] live root、SPA deep route、health、security headers、匿名 session、受保護 API 及 invite registration gate 通過；
- [x] 正式邀請流程建立隔離測試 workspace，Campaign Agent 建立及保存三輸出計劃，人工批准後 Queue 完成 1:1、4:5、9:16 素材；
- [x] 三個私人 SVG 經授權讀取並核對準確價格、優惠及 CTA，英文文案亦在正式 UI 逐欄核對；
- [x] 輸出額度由 6 正確結算至 3，reserved 數量回復 0；
- [x] desktop 及 mobile 正式 UI 沒有水平溢出、破圖或 console error；
- [x] 驗收後逐項刪除三個輸出與來源圖，再清除隔離帳戶、workspace 及邀請；遠端相關帳戶、workspace、媒體及生成記錄均核對為 0；
- [x] Cloudflare Git integration 已中斷；公開 CI 不會取得或顯示正式資源映射，正式發佈只由受保護本機設定執行。
