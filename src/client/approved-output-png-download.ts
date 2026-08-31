import {
  approvedOutputPngUnavailableMessage,
  createApprovedOutputPng,
  type ApprovedOutputPng,
  type OutputDimensions
} from '../lib/approved-output-png'
import type { GenerationResult } from '../lib/types'

const APPROVED_OUTPUT_RASTER_TIMEOUT_MS = 30_000

function rasterizeApprovedSvg(svg: string, dimensions: OutputDimensions) {
  return new Promise<Blob>((resolve, reject) => {
    let svgUrl = ''
    let image: HTMLImageElement
    try {
      svgUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
      image = new Image()
    } catch {
      if (svgUrl) URL.revokeObjectURL(svgUrl)
      reject(new Error(approvedOutputPngUnavailableMessage))
      return
    }

    let settled = false
    const finish = (error?: Error, blob?: Blob) => {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      image.onload = null
      image.onerror = null
      URL.revokeObjectURL(svgUrl)
      if (error || !blob) reject(error || new Error(approvedOutputPngUnavailableMessage))
      else resolve(blob)
    }
    const timeout = window.setTimeout(() => finish(new Error(approvedOutputPngUnavailableMessage)), APPROVED_OUTPUT_RASTER_TIMEOUT_MS)
    image.decoding = 'async'
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = dimensions.width
        canvas.height = dimensions.height
        const context = canvas.getContext('2d')
        if (!context) return finish(new Error(approvedOutputPngUnavailableMessage))
        context.drawImage(image, 0, 0, dimensions.width, dimensions.height)
        canvas.toBlob((blob: Blob | null) => finish(undefined, blob || undefined), 'image/png')
      } catch {
        finish(new Error(approvedOutputPngUnavailableMessage))
      }
    }
    image.onerror = () => finish(new Error(approvedOutputPngUnavailableMessage))
    image.src = svgUrl
  })
}

function saveApprovedOutputPng({ blob, filename }: ApprovedOutputPng) {
  let objectUrl = ''
  let link: HTMLAnchorElement | null = null
  try {
    objectUrl = URL.createObjectURL(blob)
    link = document.createElement('a')
    link.href = objectUrl
    link.download = filename
    link.rel = 'noopener'
    document.body.append(link)
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
  } catch {
    if (objectUrl) URL.revokeObjectURL(objectUrl)
    throw new Error(approvedOutputPngUnavailableMessage)
  } finally {
    link?.remove()
  }
}

export async function downloadApprovedOutputPng(result: GenerationResult) {
  saveApprovedOutputPng(await createApprovedOutputPng(result, rasterizeApprovedSvg))
}
