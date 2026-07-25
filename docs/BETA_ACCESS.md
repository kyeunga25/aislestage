# Beta 帳號與權限 / Beta Access

這份文件定義可公開的帳號、權限及測試合約。實際帳號、電郵、session、Cloudflare 資源對應及邀請碼不會寫入 repository。

## 目前權限範圍

| 身分 | 可用範圍 | 目前限制 |
| --- | --- | --- |
| 未登入訪客 | 健康狀態、workflow 清單、登入；註冊受 server gate 控制 | 不可讀取 workspace、Agent、圖片或生成記錄 |
| `owner` | 自己所屬 workspace 的資料、私有圖片、Agent 規劃／批准及生成流程 | 只限內容操作，沒有管理 API |
| `admin` | 與 `owner` 相同的內容操作 | 角色已保留，但尚未有獨立管理權限 |
| `member` | 與 `owner` 相同的內容操作 | 角色已保留，但尚未限制批准或生成動作 |

每個受保護請求都要先通過 session，再以 `workspace_memberships` 驗證 workspace。現階段三種角色只代表成員關係；程式不會假設角色名稱本身已形成完整 RBAC。

## Beta 註冊模式

`REGISTRATION_MODE` 有三個 server-side 模式：

- `closed`：不建立新帳號；已有 active 帳號仍可登入。公開 template 使用此模式。
- `invite`：顯示「獲邀註冊」，電郵及一次性邀請碼必須同時符合未過期邀請。正式 release 使用此模式。
- `open`：供受控本機或指定環境測試公開註冊；不應因前端顯示狀態而自行啟用。

邀請資料只保存邀請碼 hash，以及「標準化電郵＋高熵邀請碼」的組合 hash，不保存明文邀請碼或邀請電郵，也不留下可單獨枚舉電郵的 hash。成功註冊會在同一個 D1 batch 建立 user、active workspace、owner membership、六個初始可用輸出並消耗邀請。

登入及註冊的短期濫用控制只保存電郵與來源 IP 的單向 hash；登入所需的實際電郵只存在於受保護的 user record，不寫入公開文件或應用程式 log。

## 帳號生命週期

帳號分開保存用途與狀態，避免用電郵命名慣例控制權限：

- `account_type`：`standard`、`beta`、`test`；只作環境及測試分類，不授予額外權限。
- `account_status`：`active`、`suspended`、`deactivated`；只有 `active` 可以建立或繼續 session。
- workspace role：`owner`、`admin`、`member`；目前只表示 active membership，所有內容操作仍由 server-side workspace scope 驗證。
- workspace access：只有 `active` workspace 可建立 session context 或執行受保護操作。

公開介面不提供帳號清單或邀請管理。邀請可由 `npm run cf:invite` 在受保護本機環境建立；收件電郵及 D1 名稱只由環境變數提供，不寫入 repository 或 script output。撤銷、帳號狀態變更及成員指派只可經受保護的操作流程完成。

## 隔離測試流程

1. 在測試 D1 建立一個短期、綁定測試電郵 hash 的 `pending` invite。
2. 用 `REGISTRATION_MODE=invite` 及保留測試網域完成註冊。
3. 確認帳號為 `active`／`beta` 或 `test`，並只建立一個 owner workspace。
4. 確認邀請轉為 `used`，不可轉用另一電郵或再次使用。
5. 驗證未登入及跨 workspace 請求被拒絕。
6. 把帳號改為 `suspended`，確認既有 session 及新登入同時失效。
7. 測試結束後只清理隔離測試環境，不以正式帳號或正式資產作 fixture。

Integration tests cover this contract with isolated Workers and D1 bindings. Production identities and deployment mappings are intentionally excluded.
