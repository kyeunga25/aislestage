import { CheckCircle2 } from 'lucide-react'
import { workflows } from '../lib/workflows'
import { WorkflowIcon } from './Icon'
import type { WorkflowId } from '../lib/types'

type Props = { selectedId: WorkflowId; onChange: (id: WorkflowId) => void }

export function WorkflowPicker({ selectedId, onChange }: Props) {
  return <section className="workflow-picker" aria-labelledby="workflow-title">
    <div className="section-heading"><h2 id="workflow-title">選擇視覺格式</h2><p>先選一個商用範本，系統會套用適合的構圖與文案安全區。</p></div>
    <div className="workflow-list">
      {workflows.map((workflow) => {
        const selected = workflow.id === selectedId
        return <button type="button" className={`workflow-option ${selected ? 'selected' : ''}`} onClick={() => onChange(workflow.id)} key={workflow.id}>
          <span className="workflow-icon"><WorkflowIcon name={workflow.icon} size={21} /></span>
          <span className="workflow-copy"><strong>{workflow.title}</strong><small>{workflow.description}</small></span>
          <span className="workflow-radio">{selected && <CheckCircle2 size={17} />}</span>
        </button>
      })}
    </div>
  </section>
}
