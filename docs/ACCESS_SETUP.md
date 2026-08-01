# Cloudflare Access 登入 / Access sign-in

AisleStage 把公開產品主頁與私人工作區分開：`/` 可公開瀏覽，`/app*` 及受保護 API 先經 Cloudflare Access，再由 Worker 驗證 Access JWT 和 D1 workspace membership。

這份文件只記錄可公開的設定合約。Cloudflare account identifier、實際 hostname、team domain、Access application audience、D1 identifier、資源名稱及受邀電郵必須留在受保護設定，不可寫入 repository、PR、issue 或公開 log。

## 為何採用 Access

Cloudflare Zero Trust Free 適合 50 人以下的受邀測試團隊。Access 可只保護指定 hostname/path，並以 Cloudflare identity provider、外部 IdP 或一次性電郵 PIN 驗證身份：

- [Zero Trust plans](https://www.cloudflare.com/plans/zero-trust-services/)
- [Self-hosted applications](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/)
- [Application paths](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/)
- [One-time PIN login](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/)

Access 在邊緣拒絕未符合 policy 的請求，但 origin 仍不可只信任 header 存在。AisleStage 會驗證 `Cf-Access-Jwt-Assertion` 的 RS256 簽章、issuer、audience、有效期、subject 及電郵格式：

- [Validate Access JWTs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [Access application token](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/)

## 路徑與 policy

在正式 hostname 建立 self-hosted Access application，保護：

```text
/app*
/api/*
```

`/` 是公開產品主頁。若營運監測需要匿名讀取 `/api/health`，可建立更精確的 public exception；該 endpoint 只返回模式與健康狀態，不返回帳戶、資源或使用者資料。`/api/workflows` 亦只有固定公開 workflow identifier。

正式 allow policy 應只包括受邀電郵或受控 identity group。不要使用 `Everyone`。對純瀏覽器工作區，可在 Access application 的 advanced cookie settings 啟用 HttpOnly，並在相容性確認後採用 Binding Cookie；登出使用同一應用網域的 `/cdn-cgi/access/logout`。

一次性 PIN 適合不在 Cloudflare account 內的受邀測試者。PIN policy 必須使用明確電郵 allowlist；Access policy 同時是第一層邀請邊界。

## Worker 受保護設定

正式 `wrangler.local.jsonc` 或等效 CI secret mapping 需要：

```text
AUTH_MODE=access
ACCESS_TEAM_DOMAIN=https://replace-with-team.cloudflareaccess.com
ACCESS_AUD=replace-with-application-audience
ACCESS_AUTO_PROVISION=disabled
```

- `ACCESS_TEAM_DOMAIN` 只接受 HTTPS `*.cloudflareaccess.com` origin；
- `ACCESS_AUD` 必須與目前 self-hosted application 完全相同；
- `ACCESS_AUTO_PROVISION=disabled`：只有既有 D1 帳戶可在首次 Access 登入時綁定 subject；
- `ACCESS_AUTO_PROVISION=enabled` 是保留能力，不屬於 restricted release；如日後另行批准，通過 Access allow policy 的新身份才可建立 beta user、active workspace、owner membership 及預設輸出額度。

自動建立只應在 Access policy 已收窄至受邀身份後啟用。D1 只保存 Access subject 的 SHA-256 hash；原始 JWT、subject、PIN 及 Access cookie 不會寫入 log 或資料表。綁定後若同一帳戶出現不同 subject，請求會 fail closed。

## 發佈順序

1. 在受保護設定加入實際 team domain、audience 及 auth mode；
2. 建立 path-scoped Access application 和受邀 allow policy；
3. 如 exact reviewed SHA 含有尚未套用的 migration，核對目標後才執行 `npm run cf:migrate`；
4. 執行完整 check、test、build 及 dry-run；
5. 執行 `npm run cf:deploy`；
6. 匿名檢查 `/` 可讀，`/app` 由 Access 攔截；
7. 以受邀測試身份登入，確認 `/api/session`、workspace membership、私人 R2 讀取、登出及重新驗證；
8. 核對公開 log、PR 及 deployment output 沒有受保護 identifier 或身份資料。

Turnstile 不應疊加在 Access 登入頁。若日後公開主頁加入匿名試用申請或聯絡表單，才為該表單獨立加入 Turnstile server-side verification。
