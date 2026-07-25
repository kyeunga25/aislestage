# AislePack 統一產品規格 / Unified Product Specification

版本：v0.4 — Release Readiness

本文件是產品定位、介面、Agent、資料及輸出行為的單一公開依據。

## 1. 產品定義

AislePack 是一個 AI 電商素材工作台。它把一張有權使用的商品圖片，以及一份已核實的繁中／英文商業 brief，整理成一套協調一致的 Campaign Pack。

每套輸出固定包括：

- 1:1 商品主圖；
- 4:5 社交廣告；
- 9:16 限時動態；
- 可複製的繁體中文及英文文案；
- 可核對的商品名稱、價格、優惠、賣點與 CTA。

產品不是自由 prompt 圖片工具，也不是通用設計編輯器。Agent 不可以新增未提供的產品宣稱、替使用者批准、發佈廣告或繞過 workspace 授權。

## 2. 核心工作流

1. 使用者登入 active workspace。
2. 填寫繁中與英文商品資料、價格、優惠、賣點及 CTA。
3. 上傳 PNG、JPEG 或 WebP 商品原圖。
4. Agent 檢查必填資料、來源圖及三個渠道輸出。
5. Agent 停在 `awaiting-approval`。
6. 使用者核對並批准目前 revision；修改任何資料會立即令前端計劃失效。
7. Worker 再次比對批准 state、revision、完整 brief、asset、workflow 及比例。
8. 一個具冪等鍵的請求原子建立三個 Queue jobs。
9. 完成的私人 SVG 由授權路徑預覽及下載。

## 3. 帳號與 access

- 正式環境使用邀請註冊，不提供匿名自助註冊；
- 一次性邀請同時綁定標準化電郵，D1 只保存 token hash 與組合 hash；
- 帳號狀態為 `active`、`suspended` 或 `deactivated`；
- workspace 狀態為 `active` 或 `paused`；
- membership 角色為 `owner`、`admin` 或 `member`；
- 現階段角色表示 workspace membership，所有受保護操作仍採相同 server-side workspace scope；
- 新邀請 workspace 取得六個技術性可用輸出，足以建立兩套 Campaign Pack。

詳情見 [`BETA_ACCESS.md`](BETA_ACCESS.md)。

## 4. Dashboard 資訊架構

- 左側：工作台、Campaign Packs、商品庫、品牌庫、素材庫；
- 頂部：可用輸出數、目前 workspace、使用者及登出；
- 四步：商品資料、商品圖片、Agent 規劃、確認輸出；
- 三欄：雙語商業資料、私人商品圖、Campaign Agent；
- 成果區：三比例預覽、雙語文案、狀態、下載及重新建立；
- 使用指引：完整三步流程與私隱提示。

所有導覽都有實際 workspace view。沒有通知、workspace 切換或帳號選單功能時，不顯示假按鈕。示範預覽、排隊中、已生成及失敗狀態必須清楚區分。

### 視覺系統

- 背景 `#ffffff`；
- 主色 `#155eef`；
- 完成狀態 `#1aa876`；
- 文字 `#172033`；
- 邊界 `#e2e7ef`；
- 主要圓角 5–9 px；
- 系統字體配合 Noto Sans TC fallback；
- 動態只用於載入與狀態，並尊重 `prefers-reduced-motion`。

已接受的 desktop 視覺依據：`docs/design/aislepack-agent-workspace-concept.png`。

## 5. Agent 合約

每個 workspace 對應一個 Cloudflare Agents SDK Durable Object：

```text
idle -> needs-input -> awaiting-approval -> approved
```

- instance name 由 Worker 使用 session workspace ID 決定；
- browser 不可以直接讀寫 Durable Object storage；
- 只有 server callable method 可以改變 state；
- deterministic mode 使用固定規則；
- assisted mode 只可改寫 plan summary 與三個固定理由；
- provider 失敗時不批准、不排隊、不扣用量；
- 每次重新規劃產生新的 revision。

## 6. 私人資產

- 只接受 PNG、JPEG、WebP；
- 最大 4 MB；
- browser 與 Worker 都檢查基本類型／大小，Worker 再檢查 signature；
- 含 EXIF、XMP 或文字 metadata 的來源圖會被拒絕，原始檔名不會保存；
- source object 存於 workspace-scoped private R2 key；
- browser 只收到 asset ID 及授權 preview URL；
- 跨 workspace 返回 not found；
- D1 寫入失敗時清理剛建立的單一 R2 object；
- 來源圖和輸出不得互相覆寫。
- 使用者可逐一刪除明確的商品圖或已完成輸出；刪除商品圖會同時重設其 Agent 計劃。

## 7. Campaign Pack 與保真

正式 UI 固定提交三個已批准輸出。D1 會在同一 batch 建立 pack、三個 reservation 及三個 generation records；不足三個可用輸出時不留下部分 pack。重送相同 idempotency key 只返回原有 pack。

確定性程式負責：

- 原始商品位元組及幾何；
- 品牌、商品名、價格、優惠、賣點、規格及 CTA；
- XML escaping、文字安全區及固定比例；
- 1:1 1080×1080、4:5 1080×1350、9:16 1080×1920；
- 私人 SVG 保存與 restrictive response headers。

`deterministic` 不接觸外部 provider。`assisted` 只可加入背景方向，商品與文字仍經同一確定性合成。SVG 是目前正式支援格式；PNG／JPEG 不屬於輸出合約。

## 8. Cloudflare 架構

```text
Static Assets -> React SPA
Worker API -> D1 + private R2 + CampaignAgent Durable Object
Campaign Pack -> Queue batch -> deterministic compositor -> private R2
Cron Trigger -> expired session and auth-attempt cleanup
```

公開 repository 只保存 generic binding 名稱與 placeholder。實際帳戶、D1 identifier、資源名稱、URL、secret 及營運資料留在受保護部署設定。

## 9. 驗收標準

- 真實使用者不會預填 demo 商業資料；
- 已保存 Agent brief 可在重新登入後恢復；
- 修改 brief 或商品圖後不可沿用舊批准；
- 一次請求只建立一套三輸出 pack；
- 重送、Queue duplicate delivery 及 enqueue failure 不會重複預留；
- 商品圖、價格、優惠、CTA 及雙語文案可逐項核對；
- 匿名及跨 workspace 不可讀取私人資料；
- deterministic mode 不接觸 provider；
- desktop、mobile、keyboard focus、無水平溢出及破圖檢查通過；
- type check、Workers integration tests、production build、Wrangler dry-run 及 dependency audit 通過；
- migration、部署版本、live routes 與 Git main 對應同一個已驗證 SHA。
