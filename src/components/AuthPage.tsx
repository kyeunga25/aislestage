import { ArrowRight, LockKeyhole, Sparkles } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { BrandMark } from './BrandMark'
import { submitPasswordAuth } from '../lib/password-auth-client'
import type { AuthedSession } from '../lib/workspace-bootstrap-loader'

type Props = {
  registrationMode: 'open' | 'invite' | 'closed'
  onAuthenticated: (session: AuthedSession) => void
}

type Mode = 'login' | 'register'

export function AuthPage({ registrationMode, onAuthenticated }: Props) {
  const [mode, setMode] = useState<Mode>('login')
  const [name, setName] = useState('')
  const [workspaceName, setWorkspaceName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const submissionLock = useRef(false)
  const isRegister = mode === 'register'
  const registrationAvailable = registrationMode !== 'closed'
  const inviteOnly = registrationMode === 'invite'

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submissionLock.current) return
    submissionLock.current = true
    setError('')
    setIsSubmitting(true)
    try {
      const session = await submitPasswordAuth(mode === 'login'
        ? { mode, email, password }
        : { mode, name, workspaceName, email, password, ...(inviteOnly ? { inviteCode } : {}) })
      onAuthenticated(session)
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : '登入服務暫時無法使用。 Authentication service is temporarily unavailable.')
    } finally {
      submissionLock.current = false
      setIsSubmitting(false)
    }
  }

  return <main className="auth-shell">
    <section className="auth-copy" aria-label="AisleStage 產品介紹">
      <a className="app-brand auth-brand" href="/" aria-label="AisleStage">
        <BrandMark /><span><strong>AisleStage</strong><small>AI 電商素材工作台</small></span>
      </a>
      <div>
        <h1>一張商品圖，完成整套推廣素材</h1>
        <p>以商品資料、來源圖片、Agent 規劃及人工批准建立 1:1、4:5、9:16 電商素材與雙語文案。</p>
      </div>
      <div className="auth-points">
        <span><Sparkles size={17} /> 一次完成三種尺寸</span>
        <span><LockKeyhole size={17} /> 圖片與素材私人保存</span>
      </div>
    </section>
    <section className="auth-card" aria-labelledby="auth-title">
      <div className={`auth-tabs${registrationAvailable ? '' : ' closed'}`} role="tablist" aria-label="帳號操作">
        <button className={mode === 'login' ? 'active' : ''} type="button" onClick={() => setMode('login')} disabled={isSubmitting}>登入</button>
        {registrationAvailable ? <button className={mode === 'register' ? 'active' : ''} type="button" onClick={() => setMode('register')} disabled={isSubmitting}>{inviteOnly ? '獲邀註冊' : '註冊'}</button> : null}
      </div>
      <form className="auth-form" onSubmit={handleSubmit} aria-busy={isSubmitting}>
        <div className="section-heading"><h2 id="auth-title">{isRegister ? '建立帳號' : '登入 AisleStage'}</h2><p>{isRegister ? inviteOnly ? '使用受邀電郵及一次性邀請碼建立私人工作區。' : '建立你的私人工作區，開始第一套 Campaign Pack。' : '回到工作區，繼續建立推廣素材包。'}</p></div>
        <fieldset className="auth-fields" disabled={isSubmitting}>
          {!registrationAvailable ? <p className="registration-note"><strong>註冊目前未開放</strong><span>已有帳號仍可登入。</span></p> : null}
          {isRegister && <div className="form-row"><label>你的姓名<input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required /></label><label>工作區名稱<input value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} placeholder="例如 Example Store" maxLength={120} required /></label></div>}
          <label>電郵地址<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} required /></label>
          <label>密碼<input type="password" autoComplete={isRegister ? 'new-password' : 'current-password'} minLength={8} maxLength={256} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
          {isRegister && inviteOnly ? <label>Beta 邀請碼<input type="password" autoComplete="one-time-code" minLength={12} maxLength={256} value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} spellCheck={false} required /></label> : null}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button auth-submit" type="submit">{isSubmitting ? '處理中… Processing…' : isRegister ? '建立帳號與工作區' : '登入工作區'}<ArrowRight size={16} /></button>
        </fieldset>
      </form>
    </section>
  </main>
}
