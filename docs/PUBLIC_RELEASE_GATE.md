# 公開 repository 發佈閘門 / Public release gate

每次 commit、push、pull request、release 或 deployment 前，都要先確認 exact scope，並執行：

```bash
git status -sb
git diff --check
git diff --cached --check
npm run release:check
```

## 掃描範圍

- tracked files、staged files 及擬加入的 untracked files；
- `dist`、source map、log、截圖、fixture、export、backup、SQLite／D1 dump 及 CI artifact；
- commit subject／body、PR／issue／release text；
- private-key marker、常見 credential 形態、client-exposed secret、非 placeholder Cloudflare mapping；
- 真實客戶、商品、campaign、訂單、付款資料及 confidential provider terms。
- 非公開 deployment topology、Access inventory、dashboard 截圖、database dump／query result、object key、Queue payload 及 provider request／response；
- 為了說明技術棧而不必要地複製完整資源映射、資料庫組織或 maintainer-specific CI/CD 設定。

公開 scanner 只包含一般規則。Confidential terms 由被 Git 忽略、限制權限的本機檔案提供：

```bash
AISLESTAGE_EGRESS_TERMS_FILE=/protected/path/terms.txt npm run release:check
```

Scanner 只報告 path 與問題類別，不輸出疑似 secret、identifier 或資料內容。無法解釋的 match 一律 fail closed。

準備 PR body、issue 或 release notes 時，把擬公開文字放在 repository 外的臨時檔案，連同 repository 一起掃描：

```bash
AISLESTAGE_EGRESS_TEXT_FILE=/protected/path/release-text.txt npm run release:check
```

此檔案內容不會被 scanner 輸出或加入 Git。實際發佈後仍要重新讀取 GitHub 上的公開文字，確認與已掃描版本一致。

## 發佈證據

GitHub secret scanning 與 push protection 只能作 defence in depth。完整發佈仍要核對：

- exact reviewed SHA 與 CI；
- check、test、build、dry-run、dependency audit 及 egress gate；
- migration 與 deployment version；
- live public／protected routes、security headers、generation gate 及產品流程；
- local `main`、`origin/main`、merge commit、tag／release 與 active deployment 一致。

如果 credential 可能曾進入 working tree、history、log 或 artifact，先停止相關功能、撤銷／rotate credential 並審計活動；history cleanup 是另一項需要明確批准的操作，不能用刪檔代替。
