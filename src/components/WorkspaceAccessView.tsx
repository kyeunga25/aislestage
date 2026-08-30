import {
  ArrowLeft,
  Crown,
  Mail,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserPlus,
  UserRound,
  UsersRound
} from 'lucide-react'
import { useState, type FormEvent } from 'react'
import type { WorkspaceMember, WorkspaceSummary } from '../lib/types'

export type WorkspaceAccessMutation = {
  kind: 'invite' | 'role' | 'remove'
  memberId: string | null
}

type Props = {
  members: WorkspaceMember[]
  viewerRole: Extract<WorkspaceSummary['role'], 'owner' | 'admin'>
  viewerUserId?: string
  isRefreshing: boolean
  mutation: WorkspaceAccessMutation | null
  notice: string
  onRefresh?: () => void
  onInvite: (input: { email: string; name: string; role: 'admin' | 'member' }) => boolean | Promise<boolean>
  onRoleChange: (member: WorkspaceMember, role: 'admin' | 'member') => void
  onRemove: (member: WorkspaceMember) => void
  onBack: () => void
}

const joinedTime = new Intl.DateTimeFormat('zh-HK', {
  dateStyle: 'medium',
  timeZone: 'Asia/Hong_Kong'
})

const roleCopy = {
  owner: '擁有者 · Owner',
  admin: '管理員 · Admin',
  member: '一般成員 · Member'
} as const

const statusCopy = {
  active: '使用中 · Active',
  suspended: '已暫停 · Suspended',
  deactivated: '已停用 · Deactivated'
} as const

export function WorkspaceAccessView({
  members,
  viewerRole,
  viewerUserId,
  isRefreshing,
  mutation,
  notice,
  onRefresh,
  onInvite,
  onRoleChange,
  onRemove,
  onBack
}: Props) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<'admin' | 'member'>('member')
  const busy = isRefreshing || mutation !== null

  async function submitInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const input = {
      email: email.trim().toLowerCase(),
      name: name.trim(),
      role: viewerRole === 'admin' ? 'member' as const : role
    }
    const accepted = await onInvite(input)
    if (accepted) {
      setEmail('')
      setName('')
      setRole('member')
    }
  }

  return <section className="collection-view workspace-access-view" aria-busy={busy}>
    <div className="collection-heading">
      <div className="collection-heading-main"><span><UsersRound size={21} /></span><div><h1>存取管理</h1><p>Workspace access · 管理目前工作區的受邀成員與角色。</p></div></div>
      <div className="collection-actions">
        {onRefresh ? <button className="outline-button" type="button" onClick={onRefresh} disabled={busy} aria-label={isRefreshing ? '正在重新載入成員 · Reloading members' : '重新載入成員 · Refresh members'}><RefreshCw className={isRefreshing ? 'spin' : undefined} size={16} />{isRefreshing ? '重新載入中…' : '重新載入'}</button> : null}
        <button className="outline-button" type="button" onClick={onBack}><ArrowLeft size={16} />返回工作台</button>
      </div>
    </div>

    <p className="access-boundary"><ShieldCheck size={18} /><span><strong>Cloudflare Access 邊界保持不變</strong>這個介面只建立或調整 D1 workspace membership，不會修改 Access allow policy。請只加入已由受保護 Access email／group policy 允許的人員。 <small>D1 membership does not grant the edge Access policy.</small></span></p>
    {notice ? <p className="workspace-notice collection-notice" role="alert">{notice}</p> : null}

    <section className="access-invite-panel" aria-labelledby="access-invite-title">
      <div className="data-head"><div><strong id="access-invite-title"><UserPlus size={17} />邀請 Access 成員</strong><small>Pre-onboard one verified identity · 不會發送電郵或顯示 secret</small></div></div>
      <form className="access-invite-form" onSubmit={(event) => void submitInvite(event)}>
        <label><span>成員電郵 · Email</span><input name="member-email" type="email" autoComplete="off" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} required disabled={busy} placeholder="member@example.com" /></label>
        <label><span>顯示名稱 · Name</span><input name="member-name" type="text" autoComplete="off" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required disabled={busy} placeholder="團隊成員" /></label>
        <label><span>工作區角色 · Role</span><select name="member-role" value={viewerRole === 'admin' ? 'member' : role} onChange={(event) => setRole(event.target.value as 'admin' | 'member')} disabled={busy || viewerRole === 'admin'}>
          <option value="member">一般成員 · Member</option>
          {viewerRole === 'owner' ? <option value="admin">管理員 · Admin</option> : null}
        </select></label>
        <button className="primary-button" type="submit" disabled={busy || !email.trim() || !name.trim()}><UserPlus size={16} />{mutation?.kind === 'invite' ? '正在加入…' : '加入工作區'}</button>
      </form>
      <p className="access-invite-note">新身份會建立為 Access-only beta account；首次通過同一已批准電郵的 Cloudflare Access 驗證後，Worker 才會綁定其 subject hash。 <span>Existing password accounts retain their current sign-in mode.</span></p>
    </section>

    <section className="access-member-panel" aria-labelledby="access-member-title">
      <div className="data-head"><div><strong id="access-member-title">目前成員</strong><small>Current members · owner 身分不可在此轉移或移除</small></div><span>{members.length} 人</span></div>
      {members.length ? <ol className="access-member-list">
        {members.map((member) => {
          const isOwner = member.role === 'owner'
          const isSelf = member.id === viewerUserId
          const canChangeRole = viewerRole === 'owner' && !isOwner && !isSelf
          const canRemove = !isOwner && !isSelf && (viewerRole === 'owner' || member.role === 'member')
          const memberBusy = mutation?.memberId === member.id
          return <li className="access-member" key={member.id}>
            <span className={`access-member-avatar ${member.role}`}>{isOwner ? <Crown size={17} /> : <UserRound size={17} />}</span>
            <div className="access-member-identity"><strong>{member.name}</strong><span><Mail size={13} />{member.email}</span><small>{member.authMode === 'access' ? 'Cloudflare Access' : '本機密碼 · Local password'} · {statusCopy[member.accountStatus]} · 加入於 <time dateTime={member.createdAt}>{joinedTime.format(new Date(member.createdAt))}</time></small></div>
            <div className="access-member-role">
              {isOwner
                ? <strong>owner · 不可變更</strong>
                : canChangeRole
                  ? <label><span className="visually-hidden">{member.name} 的角色</span><select value={member.role} onChange={(event) => onRoleChange(member, event.target.value as 'admin' | 'member')} disabled={busy || memberBusy}>
                    <option value="member">一般成員 · Member</option>
                    <option value="admin">管理員 · Admin</option>
                  </select></label>
                  : <strong>{roleCopy[member.role]}</strong>}
            </div>
            {canRemove ? <button className="danger-text-button" type="button" disabled={busy || memberBusy} onClick={() => {
              if (window.confirm(`確定要從工作區移除 ${member.name}？此操作不會刪除其帳號。`)) onRemove(member)
            }}><Trash2 size={15} />{memberBusy && mutation?.kind === 'remove' ? '正在移除…' : '移除成員'}</button> : <span className="access-member-protected">{isSelf ? '目前帳號' : '受保護角色'}</span>}
          </li>
        })}
      </ol> : <div className="empty-library compact"><UsersRound size={24} /><strong>{isRefreshing ? '正在載入成員…' : '尚未有成員資料'}</strong><p>{isRefreshing ? 'Loading workspace members…' : '工作區必須保留一位 owner；請重新載入確認授權狀態。'}</p></div>}
    </section>
  </section>
}
