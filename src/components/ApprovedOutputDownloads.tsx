import { ArrowDownToLine, Image as ImageIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  approvedOutputPngUnavailableMessage,
  canExportApprovedOutputPng
} from '../lib/approved-output-png'
import { downloadApprovedOutputPng } from '../client/approved-output-png-download'
import type { GenerationResult } from '../lib/types'

type Props = {
  result: GenerationResult
  controlsDisabled?: boolean
  onBusyChange?: (busy: boolean) => void
}

export function ApprovedOutputDownloads({ result, controlsDisabled = false, onBusyChange }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const operation = useRef(0)
  const localPngAvailable = canExportApprovedOutputPng(result)
  const extension = result.contentType === 'image/svg+xml' ? 'svg' : 'png'
  const sourceLabel = result.contentType === 'image/svg+xml' ? '下載 SVG 原件' : '下載已核准 PNG'

  useEffect(() => () => {
    operation.current += 1
    onBusyChange?.(false)
  }, [onBusyChange])

  async function exportPng() {
    if (busy || controlsDisabled || !localPngAvailable) return
    const currentOperation = ++operation.current
    setBusy(true)
    setError('')
    onBusyChange?.(true)
    try {
      await downloadApprovedOutputPng(result)
    } catch {
      if (operation.current === currentOperation) setError(approvedOutputPngUnavailableMessage)
    } finally {
      if (operation.current === currentOperation) {
        setBusy(false)
        onBusyChange?.(false)
      }
    }
  }

  return <div className="approved-output-download-section" aria-busy={busy}>
    <div className="approved-output-downloads">
      <a className="approved-download" href={result.downloadUrl!} download={`aislestage-${result.aspectRatio.replace(':', 'x')}.${extension}`}><ArrowDownToLine size={16} />{sourceLabel}</a>
      {localPngAvailable ? <button className="approved-png-download" type="button" onClick={() => void exportPng()} disabled={busy || controlsDisabled}><ImageIcon size={16} />{busy ? <>建立 PNG…<span className="visually-hidden"> Creating PNG…</span></> : '另存本機 PNG'}</button> : null}
    </div>
    {localPngAvailable ? <small className="approved-output-local-note">PNG 只在此瀏覽器從已核准 SVG 建立；不會上傳或改寫原件。<span lang="en"> Created locally; the approved SVG stays unchanged.</span></small> : null}
    {error ? <p className="approved-output-download-error" role="alert">{error}</p> : null}
  </div>
}
