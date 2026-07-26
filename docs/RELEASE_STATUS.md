# 發佈狀態 / Release status

本頁只記錄可由 repository 或正式環境核對的公開狀態，不記錄私有基礎設施映射、使用者資料、營運資料或商業規劃。

## v0.5.1 candidate

- [x] 1280px 原生 desktop viewport 的 Hero 預覽卡密度與概念稿重新對照；
- [x] mobile breakpoint 維持無水平溢出；
- [ ] GitHub CI、merge、active deployment、tag／release 及最終截圖驗證。

## v0.5.0 verified release

- [x] 公開繁中／英文產品主頁及 `/app` 私人工作區路由；
- [x] desktop／mobile 無水平溢出，導覽、語言切換及 deep route browser QA；
- [x] Cloudflare Access RS256 JWT、issuer、audience 及 identity claim 驗證；
- [x] Access subject hash 綁定、active D1 membership 與受控 beta workspace 建立；
- [x] Access 模式停用密碼登入／註冊，並使用同網域 Access logout；
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
- [x] 修改資料後前端計劃立即失效，Worker 再獨立比對；
- [x] atomic + idempotent 三輸出 Campaign Pack API；
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
