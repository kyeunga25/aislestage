import { ArrowRight, LockKeyhole, Sparkles } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { BrandMark } from './BrandMark'
import type { AuthUser, WorkspaceSummary } from '../lib/types'

type Props = {
  registrationOpen: boolean
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

export function AuthPage({ registrationOpen, onAuthenticated }: Props) {
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
    <section className="auth-copy" aria-label="AislePack 產品介紹">
      <a className="app-brand auth-brand" href="/" aria-label="AislePack">
        <BrandMark /><span><strong>AislePack</strong><small>AI 電商素材包</small></span>
      </a>
      <div>
        <h1>一張商品圖，完成整套推廣素材</h1>
        <p>用固定三步建立 1:1、4:5、9:16 電商素材與繁中、英文文案。商品外觀保持一致，商業文字準確呈現。</p>
      </div>
      <div className="auth-points">
        <span><Sparkles size={17} /> 一次完成三種尺寸</span>
        <span><LockKeyhole size={17} /> 圖片與素材私人保存</span>
      </div>
    </section>
    <section className="auth-card" aria-labelledby="auth-title">
      <div className={`auth-tabs${registrationOpen ? '' : ' closed'}`} role="tablist" aria-label="帳號操作">
        <button className={mode === 'login' ? 'active' : ''} type="button" onClick={() => setMode('login')}>登入</button>
        {registrationOpen ? <button className={mode === 'register' ? 'active' : ''} type="button" onClick={() => setMode('register')}>註冊</button> : null}
      </div>
      <form className="auth-form" onSubmit={handleSubmit}>
        <div className="section-heading"><h2 id="auth-title">{isRegister ? '建立帳號' : '登入 AislePack'}</h2><p>{isRegister ? '建立你的私人工作區，開始第一套 Campaign Pack。' : '回到工作區，繼續建立推廣素材包。'}</p></div>
        {!registrationOpen ? <p className="beta-access-note"><strong>目前為獲邀封閉測試</strong><span>新帳號註冊已關閉；現有測試帳號可以正常登入。</span></p> : null}
        {isRegister && <div className="form-row"><label>你的姓名<input value={name} onChange={(event) => setName(event.target.value)} required /></label><label>工作區名稱<input value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} placeholder="例如 HK Tech Gear" required /></label></div>}
        <label>電郵地址<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <label>密碼<input type="password" autoComplete={isRegister ? 'new-password' : 'current-password'} minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary-button auth-submit" type="submit" disabled={isSubmitting}>{isSubmitting ? '處理中…' : isRegister ? '建立帳號與工作區' : '登入工作區'}<ArrowRight size={16} /></button>
      </form>
    </section>
  </main>
}
