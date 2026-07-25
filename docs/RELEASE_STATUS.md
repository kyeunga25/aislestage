# 發佈狀態 / Release status

本頁只記錄可由 repository 或正式環境核對的公開狀態，不記錄私有基礎設施映射、使用者資料、營運資料或商業規劃。

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
