import { ArrowLeft, ArrowRight, Check, LockKeyhole, LogOut, ShieldCheck } from 'lucide-react'
import { normalizeAccessFailureReason, safePrivateReturnPath, type AccessFailureReason } from '../lib/access-login'
import { BrandMark } from './BrandMark'

type Props = {
  reason?: AccessFailureReason
  returnTo?: string
}

type LoginMessage = {
  title: string
  titleEn: string
  body: string
  status?: string
  tone: 'ready' | 'warning' | 'error' | 'success'
}

const loginMessages: Record<AccessFailureReason | 'ready', LoginMessage> = {
  ready: {
    title: '登入私人工作區',
    titleEn: 'Sign in to your private workspace',
    body: '這個入口只供已獲邀成員使用。你會先前往 Cloudflare Access；身份通過後，Worker 仍會核對 JWT 與有效工作區成員關係。',
    tone: 'ready'
  },
  'authentication-required': {
    title: '登入未完成或已失效',
    titleEn: 'Authentication is required',
    body: '請從這個安全入口重新開始。成功通過 Cloudflare Access 後，系統會返回原本要求的私人頁面。',
    status: '未建立可用的私人工作區 session。',
    tone: 'warning'
  },
  'authentication-invalid': {
    title: '安全登入憑證未能驗證',
    titleEn: 'The secure sign-in token could not be verified',
    body: 'Cloudflare Access 已返回應用程式，但 Worker 未能驗證這次登入憑證。請先安全登出，再重新開始；在驗證完成前，私人內容會保持鎖定。',
    status: '這次 Access session 不可使用。',
    tone: 'error'
  },
  'identity-incomplete': {
    title: '登入身份資料不完整',
    titleEn: 'The verified identity is incomplete',
    body: 'Cloudflare Access 已返回應用程式，但必要的身份聲明不完整。請重新登入；如問題持續，請由管理員核對身份提供者設定。',
    status: '系統沒有建立或修改工作區帳戶。',
    tone: 'error'
  },
  'membership-required': {
    title: '身份已驗證，但未獲工作區授權',
    titleEn: 'Workspace access was not approved',
    body: 'Cloudflare Access 已核對身份，但 Worker 找不到 active 帳戶及工作區成員關係。請確認你使用的是獲邀身份，並由管理員核對帳戶狀態。',
    status: '私人資料沒有開放，亦沒有建立新帳戶。',
    tone: 'error'
  },
  'configuration-error': {
    title: '安全登入暫時不可用',
    titleEn: 'Secure sign-in is temporarily unavailable',
    body: 'Access 驗證設定未能通過完整檢查。工作區會保持鎖定，請稍後再試或聯絡管理員。',
    status: '系統已 fail closed；私人內容沒有公開。',
    tone: 'error'
  },
  'access-denied': {
    title: 'Cloudflare Access 未批准這次登入',
    titleEn: 'Cloudflare Access denied this sign-in',
    body: '只有 Access Allow policy 中的獲邀身份可以進入。請改用獲邀身份重新驗證；這個頁面不會代為建立帳戶或繞過 policy。',
    status: '這次要求未獲授權。',
    tone: 'error'
  },
  'signed-out': {
    title: '你已安全登出',
    titleEn: 'You are signed out',
    body: '如要再次進入，請重新通過 Cloudflare Access。工作區及私人 API 仍保持受保護。',
    status: 'Access session 已結束。',
    tone: 'success'
  },
  unavailable: {
    title: '登入服務暫時無法連線',
    titleEn: 'Sign-in is temporarily unavailable',
    body: '系統未能完成這次安全檢查。請稍後再試；在驗證恢復前，私人工作區會保持鎖定。',
    status: '沒有私人內容被載入。',
    tone: 'error'
  }
}

export function AccessLoginPage({ reason, returnTo }: Props) {
  const query = new URLSearchParams(window.location.search)
  const activeReason = reason || normalizeAccessFailureReason(query.get('reason'))
  const destination = safePrivateReturnPath(returnTo || query.get('returnTo'))
  const message = loginMessages[activeReason || 'ready']
  const canResetIdentity = activeReason === 'authentication-invalid'
    || activeReason === 'identity-incomplete'
    || activeReason === 'membership-required'
    || activeReason === 'access-denied'
  const destinationLabel = destination === '/app' ? '工作區首頁' : '原本的私人頁面'

  return <main className={`access-gate access-gate-${message.tone}`}>
    <a className="app-brand access-gate-brand" href="/" aria-label="AisleStage 主頁"><BrandMark /><span><strong>AisleStage</strong><small>AI 電商素材工作台</small></span></a>
    <section className="access-gate-card" aria-labelledby="access-gate-title">
      <div className="access-gate-heading">
        <span className="access-gate-icon">{message.tone === 'error' ? <LockKeyhole size={28} /> : <ShieldCheck size={28} />}</span>
        <div>
          <p className="access-gate-kicker">Invite-only · Cloudflare Access</p>
          <h1 id="access-gate-title">{message.title}</h1>
          <p className="access-gate-title-en" lang="en">{message.titleEn}</p>
        </div>
      </div>
      {message.status ? <p className={`access-gate-status ${message.tone}`} role={message.tone === 'error' ? 'alert' : 'status'}>{message.status}</p> : null}
      <p className="access-gate-lead">{message.body}</p>
      <ol className="access-login-steps" aria-label="安全登入流程">
        <li><span>1</span><div><strong>由公開登入頁開始</strong><small lang="en">Start at this public sign-in page</small></div><Check size={15} /></li>
        <li><span>2</span><div><strong>Cloudflare Access 核對身份</strong><small lang="en">Verify the invited identity at the edge</small></div></li>
        <li><span>3</span><div><strong>Worker 核對工作區權限</strong><small lang="en">Validate JWT and active membership</small></div></li>
      </ol>
      <div className="access-gate-actions">
        <a className="landing-login" href={destination}>使用 Cloudflare Access 繼續<ArrowRight size={16} /></a>
        {canResetIdentity ? <a className="landing-secondary" href="/cdn-cgi/access/logout"><LogOut size={16} />登出目前 Access 身份</a> : null}
        <a className="landing-secondary" href="/"><ArrowLeft size={16} />返回主頁</a>
      </div>
      <p className="access-gate-return">驗證成功後返回：<strong>{destinationLabel}</strong></p>
      <small>工作區不接受公開註冊。本頁不收集電郵、密碼或驗證碼；請勿在支援訊息中傳送 token 或私人商品資料。</small>
    </section>
  </main>
}
