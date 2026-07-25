import { ChevronDown, CircleHelp } from 'lucide-react'
import { navItems } from './Icon'
import { BrandMark } from './BrandMark'
import type { WorkspaceSummary } from '../lib/types'

type Props = {
  workspace: WorkspaceSummary
}

export function Sidebar({ workspace }: Props) {
  const initial = workspace.name.trim().charAt(0).toUpperCase() || 'M'

  return <aside className="sidebar">
    <div>
      <a className="brand" href="#workspace" aria-label="AislePack 工作台">
        <BrandMark /><span>AislePack</span>
      </a>
      <nav aria-label="主要導覽" className="nav-list">
        {navItems.map(({ label, icon: Icon }, index) => <a className={`nav-item ${index === 0 ? 'active' : ''}`} href={`#${index === 0 ? 'workspace' : 'coming-soon'}`} key={label}><Icon size={19} /><span>{label}</span></a>)}
      </nav>
    </div>
    <div className="sidebar-footer">
      <a className="help-link" href="#support"><CircleHelp size={18} /> 幫助中心</a>
      <button className="workspace-switcher" type="button"><span className="workspace-avatar">{initial}</span><span><strong>{workspace.name}</strong><small>{workspace.planStatus} · {workspace.role}</small></span><ChevronDown size={17} /></button>
    </div>
  </aside>
}
