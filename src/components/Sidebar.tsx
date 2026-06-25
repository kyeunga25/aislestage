import { ChevronDown, CircleHelp, Sparkles } from 'lucide-react'
import { navItems } from './Icon'

export function Sidebar() {
  return <aside className="sidebar">
    <div>
      <a className="brand" href="#workspace" aria-label="Motive 工作台">
        <span className="brand-mark"><i /><i /><i /></span><span>Motive</span>
      </a>
      <nav aria-label="主要導覽" className="nav-list">
        {navItems.map(({ label, icon: Icon }, index) => <a className={`nav-item ${index === 0 ? 'active' : ''}`} href={`#${index === 0 ? 'workspace' : 'coming-soon'}`} key={label}><Icon size={19} /><span>{label}</span></a>)}
      </nav>
    </div>
    <div className="sidebar-footer">
      <a className="help-link" href="#support"><CircleHelp size={18} /> 幫助中心</a>
      <button className="workspace-switcher" type="button"><span className="workspace-avatar">H</span><span><strong>HK Tech Gear</strong><small>封閉測試工作區</small></span><ChevronDown size={17} /></button>
    </div>
  </aside>
}
