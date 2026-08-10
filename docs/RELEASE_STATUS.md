# 發佈狀態 / Release status

本頁只記錄可由 repository 或正式環境核對的公開狀態，不記錄私有基礎設施映射、使用者資料、營運資料或商業規劃。

## v0.6.0 development status

- [x] contact-first、invite-only 產品合約與 public/private route 邊界完成；
- [x] assisted provider、資料處理、固定評估、預算與全域 kill switch 採 fail-closed 設定；
- [x] provider-neutral payment boundary 保持 disabled，沒有 checkout 或付款狀態宣稱；
- [x] public repository egress gate 納入本機及 CI；
- [x] workspace status、Queue、allowance、provider 與 observability 合約經測試核對；
- [x] provider success response 具實際 byte／chunk、MIME／UTF-8、exact field、文字長度、base64 與 PNG signature 邊界；
- [x] provider header／body 共用 30 秒 deadline；逾時的 bounded Queue retry 及 terminal allowance release 經隔離 integration 測試核對；
- [x] 完成輸出預設為私人草稿，owner／admin 的不可變審核決定與逐項受控下載已通過隔離 integration 及 browser QA；
- [x] review UPDATE ambiguous commit 以 workspace-scoped generation、completed state、target decision、expected revision 及 reviewed timestamp reconciliation；已提交以 replay 回覆，未提交保持 draft／不可下載；
- [x] Queue output SHA-256 經 R2 寫入驗收；approve／preview／download 在 D1 與 R2 digest、MIME 或 provenance metadata 不一致時 fail closed；
- [x] Queue completion batch 的 ambiguous commit 會核對 completed row、R2 metadata、draft state 與 settlement ledger；已提交保留 output，明確未提交才清理及重試；
- [x] 來源商品圖 SHA-256 經 R2 寫入驗收；Agent plan 在 DO mutation／provider work 前核對 workspace ownership 與 D1／R2 digest、大小、MIME、provenance，preview／approve／Queue 亦再次核對；missing／跨 workspace／失配不覆蓋既有 revision；
- [x] 商品圖 D1 insert 的 ambiguous commit 會以 asset ID 與 canonical 欄位 reconciliation；已提交不刪 R2，明確未提交才補償刪除 object；
- [x] pre-onboarded Access subject UPDATE ambiguous commit 以 exact user／email／name／subject hash／auth mode／status post-read reconciliation；未提交返回 `unavailable` 並可安全重試；
- [x] PNG critical chunk／CRC／結尾及靜態 WebP RIFF size／padding／VP8／VP8L header 採 bounded 結構驗證；signature-only、truncated、checksum／length 失配與無 image data 上傳均 fail closed；
- [x] PNG IHDR、JPEG frame、WebP VP8X／VP8／VP8L header 尺寸在解碼前限制為單邊 8192 px 及 32 MP；三種 oversized fixture 均不建立 D1／R2 asset；
- [x] PNG chunk、JPEG structural marker 與 WebP chunk 掃描均採固定 4,096 traversal-count 上限；過度分段 JPEG 在寫入 D1／R2 前 fail closed；
- [x] scheduled auth cleanup 刪除過期 session、7 日前 auth attempt、過期 pending／revoked invite hash 及 30 日前 used invite linkage，同時保留仍有效／近期記錄；
- [x] password／invite registration batch ambiguous commit 以 server-generated user／workspace IDs、canonical account fields、owner membership、初始 allowance 及 invite linkage reconciliation；已提交可建立 session，其他同 email 帳號不可冒充本次成功；
- [x] session INSERT ambiguous commit 以本次 token hash、user ID 與 exact expiry reconciliation；完整相符才發出原 hardened cookie，其他狀態不回傳 token 識別資料；
- [x] session `last_seen_at` 保持不延長 expiry 的 best-effort telemetry；寫入失敗不會推翻已核實的 active user／workspace authorization；
- [x] logout DELETE ambiguous commit 只在同一 token-hash row 已不存在時清除 cookie；未提交或不可讀保留 retry anchor 並返回 `503`；
- [x] auth-attempt INSERT ambiguous commit 以 server-generated event ID、email／IP hashes 及 event type reconciliation；已提交不重複，真正缺失或不可讀維持 fail closed；
- [x] invite CLI 只接受明確列出的唯一參數；未知、位置、重複、缺值、不合法 account type 及受保護 flags 均在產生邀請或執行 Wrangler 前 fail closed；
- [x] owner onboarding CLI 必須明確且唯一選擇 local／remote target；未知、位置、重複、帶值、缺少／衝突 target 及混合 self-test flags 均在讀取 identity 或執行 Wrangler 前 fail closed；
- [x] JSON／multipart 寫入只接受精確、大小寫不敏感的 base media type；合法 charset／boundary 參數保留，substring lookalike 會取消未讀 stream，並在 password verification 或 endpoint mutation 前返回 `415`；
- [x] 商品圖刪除只在 workspace Agent 的目前 brief 引用同一 asset ID 時重設 plan；刪除無關來源圖及重送刪除不會清除既有 revision，前端會重新載入 authoritative state；
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
- [x] Campaign Pack D1 batch ambiguous commit 以 server-generated pack／generation IDs、canonical queued rows 及唯一 reservations reconciliation；已提交仍送入 Queue，無對應 row 的 delivery 安全 no-op；
- [x] 單輸出 reservation batch／generation INSERT ambiguous commit 以 generation ID、唯一 ledger 及 canonical queued row reconciliation；已提交繼續入 Queue，明確無 row 才退回；
- [x] Queue claim UPDATE 回應不確定時不執行 provider／R2 work、不提前 release；queued／同 attempt processing／暫時不可讀狀態保留 reservation 並由下一 attempt 恢復；
- [x] processing attempt fence 覆蓋 canonical／approval／asset 重核、completion、retry 及 terminal mutation；舊 attempt 在 provider 或 R2 後被接管均不會覆寫較新狀態，未引用 object 會清理；
- [x] Queue batch failure 全數退回、duplicate delivery 冪等；
- [x] deterministic 1:1、4:5、9:16 private SVG；
- [x] raw OpenAI Responses structured-output 解析與 validator；
- [x] private output preview、download 及 restrictive headers；
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
