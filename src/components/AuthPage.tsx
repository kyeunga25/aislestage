import { ArrowRight, LockKeyhole, Sparkles } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import type { AuthUser, WorkspaceSummary } from '../lib/types'

type Props = {
  onAuthenticated: (session: { user: AuthUser; currentWorkspace: WorkspaceSummary }) => void
}

type Mode = 'login' | 'register'

async function submitAuth(mode: Mode, payload: Record<string, string>) {
  const response = await fetch(`/api/auth/${mode}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : '登入服務暫時未能使用。')
  return data as { user: AuthUser; currentWorkspace: WorkspaceSummary }
}

export function AuthPage({ onAuthenticated }: Props) {
  const [mode, setMode] = useState<Mode>('login')
  const [name, setName] = useState('')
  const [workspaceName, setWorkspaceName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const isRegister = mode === 'register'

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setIsSubmitting(true)
    try {
      const session = await submitAuth(mode, { name, workspaceName, email, password })
      onAuthenticated(session)
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : '登入服務暫時未能使用。')
    } finally {
      setIsSubmitting(false)
    }
  }

  return <main className="auth-shell">
    <section className="auth-copy" aria-label="Motive 產品介紹">
      <a className="brand auth-brand" href="/" aria-label="Motive">
        <span className="brand-mark"><i /><i /><i /></span><span>Motive</span>
      </a>
      <div>
        <h1>每個品牌都有自己的 AI 視覺工作區</h1>
        <p>註冊後會自動建立私人 workspace、試用額度與生成記錄，讓你把產品資料、素材結果和後續團隊管理分開保存。</p>
      </div>
      <div className="auth-points">
        <span><Sparkles size={17} /> 20 個 trial credits</span>
        <span><LockKeyhole size={17} /> D1 session 管理</span>
      </div>
    </section>
    <section className="auth-card" aria-labelledby="auth-title">
      <div className="auth-tabs" role="tablist" aria-label="帳號操作">
        <button className={mode === 'login' ? 'active' : ''} type="button" onClick={() => setMode('login')}>登入</button>
        <button className={mode === 'register' ? 'active' : ''} type="button" onClick={() => setMode('register')}>註冊</button>
      </div>
      <form className="auth-form" onSubmit={handleSubmit}>
        <div className="section-heading"><h2 id="auth-title">{isRegister ? '建立帳號' : '登入帳號'}</h2><p>{isRegister ? '建立你的第一個工作區，之後生成素材都會綁定到這個 workspace。' : '使用已註冊的電郵和密碼回到你的 workspace。'}</p></div>
        {isRegister && <div className="form-row"><label>你的姓名<input value={name} onChange={(event) => setName(event.target.value)} required /></label><label>工作區名稱<input value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} placeholder="例如 HK Tech Gear" required /></label></div>}
        <label>電郵地址<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <label>密碼<input type="password" autoComplete={isRegister ? 'new-password' : 'current-password'} minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary-button auth-submit" type="submit" disabled={isSubmitting}>{isSubmitting ? '處理中…' : isRegister ? '建立帳號與 workspace' : '登入工作區'}<ArrowRight size={16} /></button>
      </form>
    </section>
  </main>
}
