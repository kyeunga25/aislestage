import { ArrowLeft, ArrowRight, LockKeyhole, ShieldCheck } from 'lucide-react'
import { BrandMark } from './BrandMark'

type Props = {
  reason?: 'membership-required' | 'authentication-required' | 'configuration-error' | 'unavailable'
}

export function AccessGate({ reason = 'authentication-required' }: Props) {
  const membershipRequired = reason === 'membership-required'
  const configurationError = reason === 'configuration-error'

  return <main className="access-gate">
    <a className="app-brand access-gate-brand" href="/" aria-label="AisleStage 主頁"><BrandMark /><span><strong>AisleStage</strong><small>AI 電商素材工作台</small></span></a>
    <section className="access-gate-card" aria-labelledby="access-gate-title">
      <span className="access-gate-icon">{membershipRequired ? <LockKeyhole size={28} /> : <ShieldCheck size={28} />}</span>
      <p className="access-gate-kicker">Cloudflare Access</p>
      <h1 id="access-gate-title">{membershipRequired ? '此身份尚未加入工作區' : configurationError ? '安全登入尚未完成設定' : '需要驗證身份'}</h1>
      <p>{membershipRequired
        ? 'Cloudflare Access 已完成身份驗證，但這個帳戶沒有有效的 AisleStage 工作區成員關係。請由管理員確認受邀電郵及帳戶狀態。'
        : configurationError
          ? '工作區會保持鎖定，直至 Access issuer 與 audience 的受保護設定完成。'
          : '請使用獲邀電郵通過 Cloudflare Access。驗證成功後，系統仍會在 Worker 核對簽章及 D1 工作區權限。'}</p>
      <div className="access-gate-actions">
        {!configurationError ? <a className="landing-login" href="/cdn-cgi/access/logout">重新驗證身份<ArrowRight size={16} /></a> : null}
        <a className="landing-secondary" href="/"><ArrowLeft size={16} />返回主頁</a>
      </div>
      <small>工作區不接受公開註冊。請勿在支援訊息中傳送驗證碼、token 或私人商品資料。</small>
    </section>
  </main>
}
