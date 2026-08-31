# Beta 帳號與權限 / Beta Access

這份文件定義可公開的帳號、權限及測試合約。實際帳號、電郵、session、Cloudflare 資源對應及邀請碼不會寫入 repository。

## 目前權限範圍

| 身分 | 可用範圍 | 目前限制 |
| --- | --- | --- |
| 未登入訪客 | 公開產品主頁；健康狀態及 workflow 清單可按部署 policy 保持公開 | 不可讀取 workspace、Agent、圖片或生成記錄 |
| `owner` | 自己所屬 workspace 的資料、私有圖片、Agent 規劃／批准、生成、技術用量、正式輸出審核及成員管理 | 可加入 `admin`／`member`、調整非 owner 角色及移除非本人員；不可在介面轉移或移除 owner |
| `admin` | 與 `owner` 相同的內容操作、技術用量及正式輸出審核；可管理一般 member | 只可加入／移除 `member`；不可加入 admin、變更角色、移除 admin／owner 或自己 |
| `member` | 所屬 workspace 的內容操作、私人草稿預覽與技術用量 | 不可作出不可變更的正式下載審核決定 |

正式環境的每個受保護請求都要先通過 Cloudflare Access，再由 Worker 驗證 JWT，最後以 `workspace_memberships` 驗證 workspace。一般內容操作仍使用相同 workspace scope；正式輸出審核及管理介面再按上表要求 `owner`／`admin`。UI 隱藏只供可用性，真正角色與 workspace scope 一律由 Worker 重核。

## Access-first 登入

`AUTH_MODE=access` 是正式主流程。`/app*` 與受保護 API 由 Access path policy 攔截；Worker 只接受通過 RS256 簽章、issuer 及 application audience 核對的 `Cf-Access-Jwt-Assertion`。Access subject 只以 SHA-256 hash 保存，並與單一 user 綁定。

restricted release 保持 `ACCESS_AUTO_PROVISION=disabled`：身份必須先對應既有 active account 與 workspace membership。未來若另行批准自動建立，仍必須先把 Access allow policy 收窄至受邀電郵或 group。密碼登入及註冊 endpoint 在 Access 模式返回 not found。

`AUTH_MODE=password` 只保留給本機、隔離測試及遷移相容；以下舊式邀請合約仍由 integration tests 覆蓋，但不會出現在新的公開登入路徑。

## Workspace 存取管理

owner／admin 登入私人工作區後，可按需開啟「存取管理」。清單最多返回目前 workspace 的 50 個 canonical 成員，只包含顯示名稱、標準化電郵、角色、帳號狀態、登入模式及加入時間；不返回 workspace identifier、Access subject hash、password material 或其他 workspace 身份。

- 加入一個尚不存在的電郵時，Worker 會建立 `active`、`beta`、Access-only 帳號與目前 workspace membership；subject hash 保持空白，直至同一已核實電郵首次通過 Cloudflare Access JWT 驗證才綁定；
- 加入既有 active 帳號只建立目前 workspace membership，不改寫其名稱、登入模式或其他 workspace；相同角色重送安全收斂，不同角色固定 conflict；
- D1 及 API 同時限制每個 workspace 最多 50 個成員，避免並發加入越過應用層 preflight；
- 角色更新只由 owner 操作，owner／目前帳號不可變更；移除只刪除一筆 membership，不刪 user account、其他 workspace 或私人資產；
- membership 加入、角色變更及移除只保存最小 audit identity，保留 180 日後由 scheduled cleanup 刪除。

這個介面**不會**修改 Cloudflare Access application／Allow policy，也不會發送電郵、PIN 或邀請連結。操作者必須另外在受保護的 Cloudflare 設定確認該身份已獲 allow policy 授權；D1 membership 不能繞過 edge Access，Access policy 亦不能繞過 Worker membership。

## 相容密碼註冊模式

`REGISTRATION_MODE` 有三個 server-side 模式：

- `closed`：不建立新帳號；已有 active 帳號仍可登入。公開 template 使用此模式。
- `invite`：顯示「獲邀註冊」，電郵及一次性邀請碼必須同時符合未過期邀請；只保留作 password-mode 相容流程。
- `open`：供受控本機或指定環境測試公開註冊；不應因前端顯示狀態而自行啟用。

邀請資料只保存邀請碼 hash，以及「標準化電郵＋高熵邀請碼」的組合 hash，不保存明文邀請碼或邀請電郵，也不留下可單獨枚舉電郵的 hash。成功註冊會在同一個 D1 batch 建立 user、active workspace、owner membership、六個初始可用輸出並消耗邀請。

登入及註冊的短期濫用控制只保存電郵與來源 IP 的單向 hash；登入所需的實際電郵只存在於受保護的 user record，不寫入公開文件或應用程式 log。

## 帳號生命週期

帳號分開保存用途與狀態，避免用電郵命名慣例控制權限：

- `account_type`：`standard`、`beta`、`test`；只作環境及測試分類，不授予額外權限。
- `account_status`：`active`、`suspended`、`deactivated`；只有 `active` 可以建立或繼續 session。
- workspace role：`owner`、`admin`、`member`；所有內容操作由 server-side workspace scope 驗證，而正式輸出審核只容許 `owner` 或 `admin`。
- workspace access：只有 `active` workspace 可建立 session context 或執行受保護操作。

Scheduled cleanup 會刪除已過期的 pending／revoked invite hash；已使用 invite 的 hash 與帳戶 linkage 只保留 30 日，workspace membership audit event 保留 180 日。仍有效的 pending invite、30 日內的 used 記錄及 180 日內的 access event 會保留，讓短期重送與營運核對維持可預期。

公開主頁不提供帳號清單或邀請管理；workspace 成員清單只在私人 owner／admin 介面按需載入。`npm run cf:invite` 仍供 password-mode 相容註冊流程使用；收件電郵只由 `AISLESTAGE_INVITE_EMAIL` 環境變數提供，D1 則只使用受保護 `wrangler.local.jsonc` 內的通用 `DB` binding。script 拒絕以 command-line flags 傳入收件電郵、資料庫或 config，亦不會把這些受保護值交給 child-process argv。帳號狀態變更、owner 轉移及 Cloudflare policy 維護仍不在 workspace UI 範圍。

## 邀請指令 / Invite command

先在受保護的 shell session 設定 `AISLESTAGE_INVITE_EMAIL`，不要把實際收件資料寫進 command history、文件或 repository。指令只接受以下選項：

| 選項 / Option | 合約 / Contract |
| --- | --- |
| `--days 1..30` 或 / or `--days=1..30` | 有效日數 / lifetime；預設 / default 7，每次最多提供一次 / once only |
| `--account-type beta\|test` 或 / or `--account-type=beta\|test` | 帳號分類 / classification；預設 / default `beta`，不授予額外權限 / grants no extra permission |
| `--local` | 明確使用受保護 config 的本機 D1；否則使用 remote D1 / explicitly select local D1; otherwise remote |
| `--self-test` | 只執行無網絡自測，不可與操作選項並用 / offline self-test only; cannot be combined |

```bash
npm run cf:invite:check
npm run cf:invite -- --days 7 --account-type beta
npm run cf:invite -- --local --days=1 --account-type=test
```

未知或位置參數、重複選項、缺值、不支援的 account type，以及 `--email`、`--database`、`--config` 都會在讀取收件環境變數、產生邀請資料或執行 Wrangler 前 fail closed。邀請碼只在成功寫入後顯示一次，應只經私人渠道交付。

Set the recipient only through a protected `AISLESTAGE_INVITE_EMAIL` environment. The command accepts the documented options above exactly once, rejects malformed or protected arguments before any D1 work, and shows the resulting invite code once after a successful write.

## 隔離測試流程

1. 在測試 D1 建立一個短期、綁定測試電郵 hash 的 `pending` invite。
2. 用 `REGISTRATION_MODE=invite` 及保留測試網域完成註冊。
3. 確認帳號為 `active`／`beta` 或 `test`，並只建立一個 owner workspace。
4. 確認邀請轉為 `used`，不可轉用另一電郵或再次使用。
5. 驗證未登入及跨 workspace 請求被拒絕。
6. 把帳號改為 `suspended`，確認既有 session 及新登入同時失效。
7. 驗證 owner／admin 的成員矩陣、50 人上限、重送對帳、audit retention、跨 workspace 隱藏及 malformed body fail-closed。
8. 測試結束後只清理隔離測試環境，不以正式帳號或正式資產作 fixture。

Integration tests cover this contract with isolated Workers and D1 bindings. Production identities and deployment mappings are intentionally excluded.
