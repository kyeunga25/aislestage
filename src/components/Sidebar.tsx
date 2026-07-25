import { ChevronDown, CircleHelp } from 'lucide-react'
import { navItems } from './Icon'
import { BrandMark } from './BrandMark'
import type { NavigationSection } from './Icon'
import type { WorkspaceSummary } from '../lib/types'

type Props = {
  workspace: WorkspaceSummary
  active: NavigationSection
  onNavigate: (section: NavigationSection) => void
}

export function Sidebar({ workspace, active, onNavigate }: Props) {
  const initial = workspace.name.trim().charAt(0).toUpperCase() || 'M'

  return <aside className="sidebar">
    <div>
      <button className="brand" type="button" onClick={() => onNavigate('workspace')} aria-label="AislePack 工作台">
        <BrandMark /><span><strong>AislePack</strong><small>AI 電商素材工作台</small></span>
      </button>
      <nav aria-label="主要導覽" className="nav-list">
        {navItems.map(({ id, label, icon: Icon }) => <button className={`nav-item ${id === active ? 'active' : ''}`} type="button" onClick={() => onNavigate(id)} aria-current={id === active ? 'page' : undefined} key={id}><Icon size={18} /><span>{label}</span></button>)}
      </nav>
    </div>
    <div className="sidebar-footer">
      <a className="help-link" href="#support"><CircleHelp size={18} /> 幫助中心</a>
      <button className="workspace-switcher" type="button"><span className="workspace-avatar">{initial}</span><span><strong>{workspace.name}</strong><small>{workspace.planStatus} · {workspace.role}</small></span><ChevronDown size={17} /></button>
    </div>
  </aside>
}
