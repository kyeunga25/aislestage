# AisleStage 持續開發 Prompt

> 這是一份可公開的執行契約，不是私人 roadmap。不得加入商戶資料、產品圖片、帳戶／部署識別碼、供應商細節、內部商業資料或對話紀錄。

你正在持續設計、開發及改善 AisleStage。目標是讓受邀商戶從一張已核准產品圖與可驗證 brief，安全地建立一致、可審核的 campaign pack，同時保持產品真確性、私隱、額度一致性及清晰 UX。

## 不可破壞的邊界

- 繁體中文為主要語言，聯絡、登入、權利聲明、工作狀態與錯誤提供英文版本。
- 產品保持 contact-first、invite-only；所有 workspace 操作都需要伺服器端身份、成員資格與角色驗證，公開頁面不得觸發私人 API。
- 原圖、brief、生成結果、身份、workspace、額度與內部紀錄保持私人，不得出現在 public asset、URL、log、fixture、截圖、analytics 或 Git。
- 必須保存產品幾何、logo、價格、規格與商業文字真確性；不確定內容不可由模型猜測。結果先為 draft，經人工核准才可交付。
- 付費 AI、付款與公開註冊預設 fail-closed；公開 demo 只能用明確標示的 synthetic data／deterministic output。
- 不與其他 app 共用 cookie、身份、資料庫、儲存空間、secret 或私人 telemetry。
- 保留所有既有未提交變更；不得 bulk stage、重置、覆蓋或批量刪除。

## 永續 development loop

1. **重新定位**：核對目錄、Git root、remote、branch、狀態與適用指令；既有變更全部視為使用者所有。
2. **觀察證據**：閱讀相關 UI、authorization boundary、domain contract、async／retry 邏輯、storage boundary、tests 與 release gate；不猜測 production。
3. **選一個 cycle**：最多列三項候選，按商戶價值、產品真確性、安全／私隱／法律、免費方案成本、可測試性與維護負擔選一個最小垂直切片。
4. **定義驗收**：涵蓋身份／workspace、輸入總量及格式、idempotency、額度 reserve／settle／release、重試、人工審核、輸出 provenance、無障礙及回復。
5. **實作與測試**：先加入正向、跨 workspace 負向、重放／併發、malformed／oversized input 及 provider-disabled tests，再作最小修改。不得以 Content-Length 作唯一大小保護。
6. **私隱與真確性檢查**：確認 image／brief／ID／provider data 不進入 log 或 public output；任何模型輸出都需 schema、品牌／規格對照、可追蹤版本及人工決定。
7. **本機 gates**：執行 repo 現有 check、test、build、local migration、Cloudflare dry-run、dependency audit 與適用 UI 測試；不呼叫付費 provider。
8. **提交 cycle**：只 stage 本輪檔案，檢查 cached diff，以 `type: content` 建立一個聚焦 commit；列明本機證據與未驗證線上狀態。
9. **繼續演進**：完成後立即重回觀察並選下一個安全切片；不要以無用重構、版本 bump 或文件 churn 保持循環。

Cloudflare、provider 或 deployment login 不可用時，保持 server gates 關閉並繼續下一個本機 UX、測試、安全、效能或可維護性 cycle；不得把 preview／CI 當作 production 證據。

## 本產品的優先選擇規則

優先改善：上載／JSON 整體 body 界限、workspace isolation、idempotent queue／額度、產品 fidelity 檢查、審核與回復、清晰失敗狀態、手機可用性、私隱／保留／匯出及安全 observability。真實 provider 接入需要另行審核資料用途、權利、跨境傳輸、callback、成本上限、quality gate 與 kill switch。

## Suite 整合契約

只接收經人工核准的最小產品資產 bundle：版本、schema、digest、一般化 rights／provenance 結果與所需公開素材。RigStage／Personal Space 不可直接存取 AisleStage 私人儲存或 workspace。任何 server-to-server 整合都要窄權限、明確部署授權、可撤銷並在失敗時安全降級。

## English runner contract

Complete one invite-only, fidelity-preserving vertical slice per cycle. Enforce server-side workspace isolation, bounded inputs, idempotent accounting, private assets, human review, and fail-closed provider/payment gates. Verify locally, commit exact completed scope, then immediately choose the next safe cycle.
