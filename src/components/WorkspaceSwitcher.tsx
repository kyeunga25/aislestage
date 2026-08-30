import { Check, ChevronDown, LoaderCircle, RefreshCw } from 'lucide-react'
import { useId, useState } from 'react'
import type { WorkspaceSummary } from '../lib/types'

type Props = {
  currentWorkspace: WorkspaceSummary
  workspaces: WorkspaceSummary[]
  isLoading: boolean
  isSwitching: boolean
  disabled?: boolean
  notice?: string
  onOpen: () => void
  onSelect: (workspaceId: string) => void
}

const roleCopy = {
  owner: '擁有者 · Owner',
  admin: '管理員 · Admin',
  member: '一般成員 · Member'
} as const

export function WorkspaceSwitcher({
  currentWorkspace,
  workspaces,
  isLoading,
  isSwitching,
  disabled = false,
  notice = '',
  onOpen,
  onSelect
}: Props) {
  const menuId = useId()
  const [open, setOpen] = useState(false)
  const initial = currentWorkspace.name.trim().charAt(0).toUpperCase() || 'W'
  const unavailable = disabled || isSwitching

  return <div className={`workspace-menu ${open ? 'open' : ''}`}>
    <button
      type="button"
      className="workspace-chip"
      aria-controls={menuId}
      aria-disabled={unavailable}
      aria-expanded={open}
      aria-label={`${isSwitching ? '正在切換' : '切換'}工作區，目前是 ${currentWorkspace.name}`}
      disabled={unavailable}
      onClick={() => {
        const next = !open
        setOpen(next)
        if (next) onOpen()
      }}
    >
      <span>{initial}</span><strong>{currentWorkspace.name}</strong>{isSwitching ? <LoaderCircle className="spin" size={15} /> : <ChevronDown size={15} />}
    </button>
    <section className="workspace-menu-panel" id={menuId} aria-label="可用工作區 · Available workspaces" aria-busy={isLoading || isSwitching} hidden={!open}>
      <div className="workspace-menu-head"><span><strong>切換工作區</strong><small>Available workspaces</small></span>{isLoading ? <LoaderCircle className="spin" size={16} aria-label="正在載入工作區" /> : <span>{workspaces.length}</span>}</div>
      <ul className="workspace-menu-list">
        {workspaces.map((workspace) => {
          const current = workspace.id === currentWorkspace.id
          return <li key={workspace.id}>
            <button
              type="button"
              className={`workspace-menu-option ${current ? 'current' : ''}`}
              disabled={unavailable || current}
              onClick={() => onSelect(workspace.id)}
            >
              <span className="workspace-menu-avatar">{workspace.name.trim().charAt(0).toUpperCase() || 'W'}</span>
              <span><strong>{workspace.name}</strong><small>{roleCopy[workspace.role]} · 可用輸出 {workspace.availableOutputs}</small></span>
              {current ? <Check size={16} aria-label="目前工作區" /> : null}
            </button>
          </li>
        })}
      </ul>
      {isLoading && workspaces.length === 1 ? <p className="workspace-menu-status"><RefreshCw className="spin" size={14} />正在核對其他工作區…</p> : null}
      {notice ? <p className="workspace-menu-notice" role="alert">{notice}</p> : null}
      <p className="workspace-menu-boundary">切換後會重新載入所有私人 workspace 資料；D1 membership 仍會逐次核對。 <span>Private state reloads after switching.</span></p>
    </section>
  </div>
}
