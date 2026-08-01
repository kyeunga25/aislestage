# Provider-neutral 付款邊界 / Payment boundary

付款不屬於目前 AisleStage 執行中的產品能力。公開主頁、browser bundle、Campaign Pack API、D1 schema 與 tracked Wrangler template 不應包含 checkout、商戶 credential、供應商識別 mapping 或已上線付款的宣稱。

## 公開架構合約

- Campaign Pack domain 只認識 AisleStage 自己的 invoice／payment reference，不認識 provider-specific identifier；
- browser 不可直接呼叫付款供應商，也不可取得 App ID、簽署 material、privileged header 或 secret；
- 如日後獲批准，AisleStage Worker 只經 generic Service Binding 或經驗證的 server-to-server interface 呼叫最小付款邊界；
- provider-specific dependency、簽署程式、endpoint、public key、resource mapping 及實際 Worker 名稱不進此 public repository；
- 使用 hosted／tokenized payment flow，不接觸或保存 PAN／CVV；
- redirect、client query、畫面提示或截圖不能把付款改為 `paid`。

## 狀態與冪等要求

只有已驗證簽章的 webhook，或經驗證的 server-to-server query，才可更新付款狀態。Provider event、order 及 reference 必須有 unique constraint，並可安全處理 duplicate、retry 及 out-of-order delivery。

Provider-neutral 狀態最少覆蓋：

```text
pending
paid
failed
expired
partially_refunded
refunded
disputed
reversed
```

付款成功不直接等於 Campaign Pack 交付成功。Generation reservation／settlement／release 仍由獨立 D1 ledger 管理，失敗或重送不得重複扣除可用輸出。

## 上線阻擋條件

未完成書面服務、費率、settlement、資料處理、PCI responsibility、webhook、退款／爭議、SLA、IP allowlist 與 sandbox failure-mode 核對前，付款保持 disabled。任何 provider-specific source disclosure、真實商戶 object、sandbox／production transaction 或 credential 變更都需要另一次明確批准。
