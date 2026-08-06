# AI 評估與成本閘門 / AI evaluation and cost gates

核對日期：2026-08-07

這份文件定義 AisleStage 評估外部 AI 的公開安全合約。它不指定 production 模型，也不代表已啟用付費推理。所有評估先使用合成商品、合成商業資料與固定輸入；沒有明確批准時，部署保持 `GENERATION_MODE=disabled`、`ASSISTED_PROVIDER=disabled`。

## 目前程式狀態

| 路徑 | API／模型 | Repository 狀態 | 預設部署狀態 |
| --- | --- | --- | --- |
| 商品及文字合成 | 不使用模型；deterministic SVG compositor | 已實作及測試 | Generation kill switch 下保持停用；獲批准時可獨立使用 deterministic 模式 |
| 受限規劃／文案結構 | OpenAI Responses API、`gpt-5.6-terra`、Structured Outputs | Adapter 及合成測試已存在 | Assisted gates 全部 disabled，不會呼叫 provider |
| 背景候選 | OpenAI Image API、`gpt-image-2` | Adapter 及合成測試已存在 | Assisted gates 全部 disabled，不會呼叫 provider |
| Workers AI／AI Gateway | 官方 model catalog、成本及 logging 的評估參考 | 未接成 production provider | 不在 request path |

模型名稱是公開 source 中的 adapter contract，不是 production 啟用、品質通過、付費帳戶存在或實際 provider request 的證據。確定性 self-hosting 不需要任何 AI credential。

## 不可交給模型的責任

- 商品原圖位元組與幾何保留；
- Logo、商品名、價格、優惠、規格、CTA、聲明與 XML escaping；
- 1:1、4:5、9:16 尺寸及文字安全區；
- workspace authorization、人工批准、output reservation／settlement／release；
- 正式輸出保存、下載及刪除。

上述責任永遠由確定性程式與受保護資料層負責。模型失敗時回到 deterministic compositor，不可用未核實內容填補。

## 評估矩陣

| 任務 | 候選類型 | 資料風險 | 成本單位 | 必須通過的品質 gate | Fallback |
| --- | --- | --- | --- | --- | --- |
| 商業 brief 完整性 | 不需要模型；固定 validator | 低 | 0 | 必填、長度、雙語欄位及 revision 完全一致 | 阻止批准 |
| 背景／場景方向 | Cloudflare-hosted text-to-image／editing model | 中 | 每張輸入與輸出 tile、step、候選數 | 不重繪商品、不生成文字／Logo／價格；人工背景評分通過 | 純確定性背景 |
| Multi-reference 圖片編輯 | 支援多張輸入的 image editing model | 高 | 輸入圖片、像素、step、輸出候選 | 固定商品集的幾何、顏色、Logo 與包裝 OCR gate；未通過不得交付 | 單一原圖合成 |
| 圖片理解 | vision／image-to-text model | 高 | 圖片與 token | 只提出可核對 observation，不自動寫入產品事實 | 人工輸入資料 |
| 雙語摘要／版面理由 | bounded text model | 中 | input／output token | 嚴格 schema、只使用提供的事實、三項固定輸出、人工批准 | deterministic plan copy |

## 執行閘門

正式或受限 beta 的 assisted request 必須同時符合：

1. `GENERATION_MODE=assisted`，以及明確的 server-side `ASSISTED_PROVIDER` allowlist；
2. `ASSISTED_DATA_POLICY=approved`，raw prompt、response 與圖片 payload logging 關閉；
3. 每次只使用一張商品原圖、一個候選及固定輸出尺寸，retry 與並發有上限；
4. enqueue 前先完成 output reservation；成功 settle，永久失敗 release；
5. 每個 workspace 的並發、每日 assisted output 與抽象 budget units 不超過 deployment policy；
6. `ASSISTED_EVALUATION=approved`，固定合成 fixtures、OCR／保真檢查及人工評分全部通過；
7. `ASSISTED_BUDGET_MODE=approved`，而且 provider credential 只存在於 server-side secret；
8. `GENERATION_MODE=disabled` 可立即停止新請求，既有 Queue message 亦會 fail closed 並退回 reservation。

Workers AI 免費用量屬帳戶共享配置，不可當作每個 app 或每個 workspace 的商業保證。AI Gateway analytics 不能取代 D1 output ledger。

## 官方資料核對

- [OpenAI `gpt-5.6-terra`](https://developers.openai.com/api/docs/models/gpt-5.6-terra) — 目前 optional text adapter 的公開 model reference；
- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) — 受限 JSON schema response contract；
- [OpenAI `gpt-image-2`](https://developers.openai.com/api/docs/models/gpt-image-2) 及 [Image generation](https://developers.openai.com/api/docs/guides/image-generation) — 目前 optional background adapter 的公開 model／API reference；
- [Workers AI model catalog](https://developers.cloudflare.com/workers-ai/models/) — 候選能力與 model status；
- [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) — 逐模型 token／tile／step 計費及帳戶共享免費配置；
- [FLUX.2 dev model](https://developers.cloudflare.com/workers-ai/models/flux-2-dev/) — multi-reference 候選能力；
- [AI Gateway logging](https://developers.cloudflare.com/ai-gateway/observability/logging/) — metadata-only logging 與 payload collection 控制；
- [AI Gateway Unified Billing](https://developers.cloudflare.com/ai-gateway/features/unified-billing/) — 支援範圍、額外費用、spend limits 與 ZDR 邊界；
- [Cloudflare Queues delivery](https://developers.cloudflare.com/queues/reference/how-queues-works/) — at-least-once delivery 及 duplicate-safe consumer 要求。

這些資料易變。每次模型評估或 release 前必須重新核對官方頁面的更新日期、模型狀態、價格、輸入格式、logging policy 與限制。
