# AislePack 統一產品規格 / Unified Product Specification

版本：Deterministic Campaign Pack

這份文件是產品定位、介面、Agent 行為與目前交付範圍的單一依據。`PRODUCT_STRATEGY.md`、`CODEX_AGENT_BRIEF.md` 與 `TODO.md` 分別保留策略、工程與公開驗證狀態，不另行建立互相矛盾的產品版本。

## 1. 產品定義 / Product definition

**AislePack — AI 電商素材工作台**協助電商團隊把一張有權使用的商品圖片，以及一份已核實的商業 brief，整理成協調一致的 Campaign Pack。

第一個完整輸出固定包括：

- 1:1 商品主圖；
- 4:5 社交廣告；
- 9:16 限時動態；
- 繁體中文及英文推廣文案；
- 可審核的商品名稱、價格、優惠與 CTA 排版。

產品不是自由 prompt 圖片工具，也不是通用設計編輯器。Agent 可以檢查資料、提出渠道與版面建議及整理文案，但不可以自行新增產品宣稱、發佈廣告或跳過使用者批准。

## 2. 可見品牌與歷史關係 / Brand boundary

- 對外工作名稱：`AislePack`。
- 中文功能描述：`AI 電商素材工作台`。
- 核心交付名稱：`Campaign Pack`。
- `Motive` 只屬早期設計及基礎設施歷史，不再作為介面品牌。

名稱仍需在正式商業化前完成公司名稱、商標、網域及目標客戶語言測試；現階段不把未完成的法律檢索描述為已取得權利。

## 3. 使用者工作流 / Core workflow

1. 登入已授權工作區。
2. 輸入品牌、商品、價格、優惠、賣點與 CTA。
3. 上傳 PNG、JPEG 或 WebP 商品來源圖；檔案儲存在 workspace-scoped private R2 路徑。
4. Campaign Agent 檢查缺漏、商品圖片、宣稱安全與三個輸出尺寸。
5. Agent 產生受限制的輸出計劃並停在 `awaiting-approval`。
6. 使用者可以重新規劃、提出調整，或批准指定 revision。
7. 只有目前 revision 被批准後，介面才可以進入受控生成步驟。
8. Worker 再次比對已批准 brief、商品資產、revision、workflow 及比例；任一項被修改都拒絕排隊。
9. 輸出以私人路徑顯示；精確商業文字保持為可審核、可編輯的確定性圖層。

### 帳號與 Beta access

- 正式環境預設關閉新註冊，已有 active 帳號仍可登入；
- Beta 可切換為電郵綁定的一次性邀請註冊，不開放匿名自助註冊；
- 帳號用途 `standard`／`beta`／`test` 與生命週期 `active`／`suspended`／`deactivated` 分開保存；
- workspace 保留 `owner`／`admin`／`member` 角色，任何角色差異必須由 Worker policy 明確執行；
- 完整公開合約及隔離測試流程見 [`BETA_ACCESS.md`](BETA_ACCESS.md)。

## 4. Dashboard 資訊架構 / Information architecture

主介面沿用最初 Motive dashboard 的可辨識骨架，並套用 AislePack 視覺系統：

- 左側導覽：工作台、Campaign Packs、商品庫、品牌庫、素材庫；
- 頂部工作區列：額度、通知、工作區、帳號；
- 四步進度：商品資料、商品圖片、Agent 規劃、確認輸出；
- 三欄工作台：商業資料、商品圖片、Campaign Agent；
- 下方成果：三比例預覽、繁中／英文文案、下載與重新生成狀態。

導覽項目必須有真實可用的 workspace view，不使用 `#coming-soon` 空連結。版面預覽與正式生成素材要有清楚標籤，避免把示範背景誤認為已生成成品。

### 視覺規格 / Visual system

- 背景：true white `#ffffff`；
- 主色：AislePack blue `#155eef`；
- 完成狀態：mint `#1aa876`；
- 文字：dark navy `#172033`；
- 邊界：1px cool gray `#e2e7ef`；
- 圓角：主要 5–9px，避免過度卡片化；
- 字體：DM Sans + Noto Sans TC；
- 密度：中等偏緊，保留原始 dashboard 的一屏工作效率；
- 圖示：一致的細線圖示；
- 動態：只用於載入、狀態及導覽，並尊重 `prefers-reduced-motion`。

完整 desktop 視覺規格：`docs/design/aislepack-agent-workspace-concept.png`。

## 5. Campaign Agent 合約 / Agent contract

每個 workspace 對應一個 Cloudflare Agents SDK Durable Object instance，狀態使用 SQLite-backed Agent state 持久化。

狀態：

```text
idle
  -> needs-input
  -> awaiting-approval
  -> approved
```

安全規則：

- Agent instance 只能由通過 session 驗證的 Worker API 存取；
- instance name 由 server 使用目前 workspace ID 決定，不接受 client 指定；
- client 不可以直接 `setState`；
- 批准必須包含目前 revision，過期 revision 返回衝突；
- deterministic mode 不呼叫外部模型，可供本機、測試及封閉預覽使用；
- assisted mode 只有在 server-side gate 與 provider secret 同時存在時才啟用；
- 模型輸出只可更新摘要及三個固定輸出的理由，不可新增宣稱或解除批准要求；
- Agent 失敗不可以自動觸發生成或扣除額度。

## 6. 私有商品資產 / Private product assets

- 接受：PNG、JPEG、WebP；
- 最大檔案：8 MB；
- 同時檢查 MIME allowlist 與檔案 signature；
- R2 key 固定在 `workspaces/{workspaceId}/assets/product-source/...`；
- D1 記錄 asset owner、workspace、content type、size 與 object key；
- 瀏覽器只收到 asset ID 及授權 preview URL；
- 跨 workspace 讀取返回 not found；
- 上傳失敗時清理已寫入但未建檔的單一 R2 object。

來源圖與衍生素材不得互相覆寫。任何刪除、保存期限及匯出行為都必須維持 workspace 授權與可審核性。

## 7. 生成與保真 / Generation and fidelity

模型可協助：

- 場景或背景；
- 構圖方向；
- 受限制的文案草稿。

確定性程式負責：

- 原始商品幾何與外觀；
- 商品名稱、價格、優惠、CTA、規格及必要聲明；
- 三個比例的一致文字與安全區；
- 最終審核及批准狀態。

目前已實作的確定性管線會把私人商品原圖以原始位元組嵌入 1080 px 寬的 1:1、4:5 及 9:16 SVG，並由程式排版品牌、商品名稱、價格、優惠、賣點、規格及 CTA。SVG 透過授權 Worker 路徑提供，並使用限制性內容安全標頭；原圖及輸出仍只存於私人 R2。

`GENERATION_MODE` 支援三個明確狀態：`disabled`、`deterministic`、`assisted`。`deterministic` 不接觸外部 provider；`assisted` 可以生成背景，但商品與商業文字仍由確定性合成層處理。追蹤的公開設定保持 `disabled`，實際環境必須由部署操作明確選擇模式。

SVG 是目前可審核的精確版面輸出。PNG／JPEG 不屬於目前公開支援格式，不可把 SVG 驗證描述為所有廣告渠道均可直接刊登。

## 8. 架構 / Architecture

```text
React dashboard
  -> authenticated Worker API
    -> D1: users, beta invites, sessions, workspaces, jobs, asset metadata
    -> R2: private source and output images
    -> CampaignAgent Durable Object: workspace plan + approval state
    -> Queue: idempotent generation jobs
      -> planning/copy provider
      -> image/background provider
      -> deterministic composition
      -> private output storage
```

穩定 binding 名稱：`DB`、`MEDIA_BUCKET`、`GENERATION_QUEUE`、`CAMPAIGN_AGENT`。公開文件只描述 binding 合約，不加入帳戶識別碼、實際資源名稱、部署 URL 或 secret。

## 9. 目前版本 / Current release

- Motive dashboard 骨架與 AislePack 視覺整合；
- 五個可切換 workspace view；
- Auth、session 與 workspace authorization；
- 封閉／獲邀註冊、帳號生命週期與生成 gate；
- workspace-scoped Campaign Agent；
- plan revision、修訂與人工批准；
- 私有商品圖片上傳、metadata 及授權預覽；
- 三比例版面預覽及雙語文案；
- 與已批准 revision 綁定的三比例確定性 SVG 合成；
- 私人輸出保存、授權預覽及格式正確的下載；
- Queue 與 usage accounting idempotency；
- Agent 與 asset isolation integration tests。
- 由受保護 Cloudflare build variables 產生忽略式 Wrangler 設定的 Workers Builds 部署路徑。

## 10. 驗證標準 / Validation gates

- 一套 brief 在不重複輸入下輸出 1:1、4:5、9:16；
- 商品外觀及所有商業文字可逐項核對；
- 未批准 revision 不可生成；
- 已批准後修改價格、優惠、CTA、商品圖、workflow 或比例不可沿用舊批准；
- 跨 workspace 不可取得 Agent state、來源圖或輸出；
- deterministic preview 不接觸模型或外部 provider；
- type check、Workers tests、production build、Wrangler dry run 及 browser responsive QA 全部通過後才交付。
