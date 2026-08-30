import { fetchWithTimeout } from './fetch-with-timeout'
import type { AspectRatio, GenerationResult } from './types'

export const approvedOutputPngUnavailableMessage = '未能在本機建立 PNG，請重新載入後再試。 Unable to create the PNG locally; reload and try again.'

const APPROVED_OUTPUT_TIMEOUT_MS = 30_000
const MAX_APPROVED_SVG_BYTES = 18 * 1024 * 1024
const MAX_APPROVED_SVG_CHUNKS = 1_024
const MAX_APPROVED_SVG_ELEMENTS = 128
const MAX_LOCAL_PNG_BYTES = 16 * 1024 * 1024
const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>\n'
const allowedIds = new Set(['title', 'description', 'canvas', 'background-wash', 'shadow', 'product-clip'])
const requiredIds = new Set(allowedIds)
const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

type ApprovedAspectRatio = Extract<AspectRatio, '1:1' | '4:5' | '9:16'>
export type OutputDimensions = { width: number; height: number }
type SvgAttributes = Map<string, string>

const outputDimensions: Record<ApprovedAspectRatio, OutputDimensions> = {
  '1:1': { width: 1080, height: 1080 },
  '4:5': { width: 1080, height: 1350 },
  '9:16': { width: 1080, height: 1920 }
}

const allowedAttributes: Record<string, ReadonlySet<string>> = {
  svg: new Set(['xmlns', 'xmlns:xlink', 'width', 'height', 'viewBox', 'role', 'aria-labelledby']),
  title: new Set(['id']),
  desc: new Set(['id']),
  defs: new Set(),
  linearGradient: new Set(['id', 'x1', 'y1', 'x2', 'y2']),
  stop: new Set(['offset', 'stop-color', 'stop-opacity']),
  filter: new Set(['id', 'x', 'y', 'width', 'height']),
  feDropShadow: new Set(['dx', 'dy', 'stdDeviation', 'flood-color', 'flood-opacity']),
  clipPath: new Set(['id']),
  rect: new Set(['x', 'y', 'width', 'height', 'rx', 'fill', 'opacity', 'filter', 'stroke', 'stroke-width']),
  circle: new Set(['cx', 'cy', 'r', 'fill', 'opacity']),
  path: new Set(['d', 'fill', 'opacity']),
  text: new Set(['x', 'y', 'fill', 'font-family', 'font-size', 'font-weight', 'letter-spacing', 'text-anchor']),
  tspan: new Set(['x', 'y', 'text-anchor']),
  image: new Set(['href', 'x', 'y', 'width', 'height', 'preserveAspectRatio', 'opacity', 'clip-path'])
}

const selfClosingElements = new Set(['stop', 'feDropShadow', 'rect', 'circle', 'path', 'image'])
const textElements = new Set(['title', 'desc', 'text', 'tspan'])
const allowedChildren: Record<string, ReadonlySet<string>> = {
  svg: new Set(['title', 'desc', 'defs', 'rect', 'circle', 'path', 'text', 'image']),
  defs: new Set(['linearGradient', 'filter', 'clipPath']),
  linearGradient: new Set(['stop']),
  filter: new Set(['feDropShadow']),
  clipPath: new Set(['rect']),
  text: new Set(['tspan']),
  title: new Set(),
  desc: new Set(),
  tspan: new Set()
}

function isApprovedAspectRatio(value: AspectRatio): value is ApprovedAspectRatio {
  return Object.prototype.hasOwnProperty.call(outputDimensions, value)
}

function expectedGenerationRoute(result: GenerationResult, suffix: 'image' | 'download') {
  return `/api/generations/${encodeURIComponent(result.id)}/${suffix}`
}

export function canExportApprovedOutputPng(result: GenerationResult) {
  const provenance = result.provenance
  return result.status === 'completed'
    && result.reviewStatus === 'approved'
    && typeof result.reviewedAt === 'string'
    && result.reviewedAt.length > 0
    && result.contentType === 'image/svg+xml'
    && isApprovedAspectRatio(result.aspectRatio)
    && result.imageUrl === expectedGenerationRoute(result, 'image')
    && result.downloadUrl === expectedGenerationRoute(result, 'download')
    && Number.isSafeInteger(result.approvedRevision)
    && Number(result.approvedRevision) > 0
    && provenance?.approvedRevision === result.approvedRevision
    && provenance?.compositionVersion === 'deterministic-svg-v1'
    && (provenance?.generationMode === 'deterministic' || provenance?.generationMode === 'assisted')
}

function validText(value: string) {
  return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f<>]/.test(value)
    && !/&(?!(?:amp|lt|gt|quot|apos);)/.test(value)
}

function parseAttributes(source: string): SvgAttributes | null {
  const attributes = new Map<string, string>()
  let offset = 0
  while (offset < source.length) {
    const whitespace = /^\s+/.exec(source.slice(offset))
    if (!whitespace) return null
    offset += whitespace[0].length
    if (offset === source.length) break
    const attribute = /^([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*"([^"]*)"/.exec(source.slice(offset))
    if (!attribute || attributes.has(attribute[1])) return null
    attributes.set(attribute[1], attribute[2])
    offset += attribute[0].length
  }
  return attributes
}

function safeNumber(value: string, allowPercent = false) {
  const pattern = allowPercent ? /^-?(?:\d+|\d*\.\d+)%?$/ : /^-?(?:\d+|\d*\.\d+)$/
  return pattern.test(value) && Number.isFinite(Number(value.replace('%', '')))
}

function safeUnitInterval(value: string) {
  return safeNumber(value) && Number(value) >= 0 && Number(value) <= 1
}

function safeFragmentReference(value: string, expectedIds: ReadonlySet<string>) {
  const match = /^url\(#([A-Za-z][A-Za-z0-9-]*)\)$/.exec(value)
  return Boolean(match && expectedIds.has(match[1]))
}

function safeEmbeddedImage(value: string) {
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value)
  if (!match || match[2].length < 12 || match[2].length % 4 !== 0) return false
  const signature = match[1] === 'png' ? 'iVBORw0KGgo' : match[1] === 'jpeg' ? '/9j/' : 'UklGR'
  return match[2].startsWith(signature)
}

function safeColor(value: string) {
  return /^#[0-9a-fA-F]{6}$/.test(value) || value === 'none'
}

function validAttribute(name: string, value: string) {
  if (!value || /[\u0000-\u001f<&]/.test(value)) return false
  if (name === 'xmlns') return value === 'http://www.w3.org/2000/svg'
  if (name === 'xmlns:xlink') return value === 'http://www.w3.org/1999/xlink'
  if (name === 'id') return allowedIds.has(value)
  if (name === 'viewBox') return /^0 0 \d+ \d+$/.test(value)
  if (name === 'role') return value === 'img'
  if (name === 'aria-labelledby') return value === 'title description'
  if (name === 'href') return safeEmbeddedImage(value)
  if (name === 'fill') return safeColor(value) || safeFragmentReference(value, new Set(['canvas', 'background-wash']))
  if (name === 'stop-color' || name === 'flood-color' || name === 'stroke') return safeColor(value)
  if (name === 'filter') return value === 'url(#shadow)'
  if (name === 'clip-path') return value === 'url(#product-clip)'
  if (name === 'preserveAspectRatio') return value === 'xMidYMid meet' || value === 'xMidYMid slice'
  if (name === 'text-anchor') return value === 'start' || value === 'middle' || value === 'end'
  if (name === 'font-family') return value === "Arial, 'Noto Sans TC', sans-serif" || value === 'Arial, sans-serif'
  if (name === 'font-weight') return value === '500' || value === '700' || value === '800'
  if (name === 'd') return /^[MmLlCcZz0-9.,\s-]+$/.test(value)
  if (name === 'opacity' || name === 'stop-opacity' || name === 'flood-opacity') return safeUnitInterval(value)
  return safeNumber(value, name === 'x' || name === 'y' || name === 'width' || name === 'height')
}

function validateAttributes(tagName: string, attributes: SvgAttributes) {
  const names = allowedAttributes[tagName]
  if (!names || attributes.size > names.size) return false
  for (const [name, value] of attributes) {
    if (!names.has(name) || name.toLowerCase().startsWith('on') || !validAttribute(name, value)) return false
  }
  if (tagName === 'svg') {
    return attributes.size === names.size
      && attributes.has('xmlns')
      && attributes.has('xmlns:xlink')
      && attributes.has('width')
      && attributes.has('height')
      && attributes.has('viewBox')
      && attributes.has('role')
      && attributes.has('aria-labelledby')
  }
  if (tagName === 'title') return attributes.get('id') === 'title'
  if (tagName === 'desc') return attributes.get('id') === 'description'
  if (tagName === 'image') return attributes.has('href')
  return true
}

export function validateApprovedCampaignSvg(svg: string, aspectRatio: AspectRatio, knownByteLength?: number) {
  const byteLength = knownByteLength === undefined ? new TextEncoder().encode(svg).byteLength : knownByteLength
  if (!isApprovedAspectRatio(aspectRatio)
    || typeof svg !== 'string'
    || svg.length === 0
    || !Number.isSafeInteger(byteLength)
    || byteLength <= 0
    || byteLength > MAX_APPROVED_SVG_BYTES
    || !svg.startsWith(XML_DECLARATION)
    || /<!(?:--|DOCTYPE|ENTITY)|<\?(?!xml version="1\.0" encoding="UTF-8"\?>)/i.test(svg)) return false

  const expected = outputDimensions[aspectRatio]
  const content = svg.slice(XML_DECLARATION.length)
  const tagPattern = /<[^>]*>/g
  const stack: string[] = []
  const ids = new Set<string>()
  let rootSeen = false
  let rootClosed = false
  let elementCount = 0
  let imageCount = 0
  let cursor = 0
  let match: RegExpExecArray | null

  while ((match = tagPattern.exec(content))) {
    const text = content.slice(cursor, match.index)
    const parent = stack.at(-1)
    if (!validText(text) || (text.trim() && (!parent || !textElements.has(parent)))) return false
    cursor = tagPattern.lastIndex
    const token = match[0]
    const closing = /^<\/([A-Za-z][A-Za-z0-9]*)\s*>$/.exec(token)
    if (closing) {
      if (stack.pop() !== closing[1]) return false
      if (closing[1] === 'svg') rootClosed = true
      continue
    }

    const opening = /^<([A-Za-z][A-Za-z0-9]*)([\s\S]*?)(\/?)>$/.exec(token)
    if (!opening || rootClosed) return false
    const tagName = opening[1]
    const selfClosing = opening[3] === '/'
    if (!Object.prototype.hasOwnProperty.call(allowedAttributes, tagName)
      || selfClosing !== selfClosingElements.has(tagName)) return false
    const attributesSource = selfClosing ? opening[2].replace(/\s+$/, '') : opening[2]
    const attributes = parseAttributes(attributesSource)
    if (!attributes || !validateAttributes(tagName, attributes)) return false

    const currentParent = stack.at(-1)
    if (!rootSeen) {
      if (tagName !== 'svg' || currentParent) return false
      rootSeen = true
      if (attributes.get('width') !== String(expected.width)
        || attributes.get('height') !== String(expected.height)
        || attributes.get('viewBox') !== `0 0 ${expected.width} ${expected.height}`) return false
    } else if (!currentParent || !allowedChildren[currentParent]?.has(tagName)) {
      return false
    }

    elementCount += 1
    if (elementCount > MAX_APPROVED_SVG_ELEMENTS) return false
    const id = attributes.get('id')
    if (id) {
      if (ids.has(id)) return false
      ids.add(id)
    }
    if (tagName === 'image') {
      imageCount += 1
      if (imageCount > 2) return false
    }
    if (!selfClosing) stack.push(tagName)
  }

  const trailing = content.slice(cursor)
  return rootSeen
    && rootClosed
    && stack.length === 0
    && imageCount >= 1
    && validText(trailing)
    && trailing.trim() === ''
    && ids.size === requiredIds.size
    && [...requiredIds].every((id) => ids.has(id))
}

async function readApprovedSvgResponse(response: Response, signal: AbortSignal, result: GenerationResult) {
  if (!response.ok || response.status !== 200) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error(approvedOutputPngUnavailableMessage)
  }
  const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
  const expectedFilename = `attachment; filename="aislestage-${result.aspectRatio.replace(':', 'x')}.svg"`
  if (contentType !== 'image/svg+xml' || response.headers.get('content-disposition') !== expectedFilename) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error(approvedOutputPngUnavailableMessage)
  }
  const declaredLength = response.headers.get('content-length')
  if (declaredLength !== null) {
    const normalized = declaredLength.trim()
    const bytes = /^\d+$/.test(normalized) ? Number(normalized) : Number.NaN
    if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > MAX_APPROVED_SVG_BYTES) {
      await response.body?.cancel().catch(() => undefined)
      throw new Error(approvedOutputPngUnavailableMessage)
    }
  }
  if (!response.body) throw new Error(approvedOutputPngUnavailableMessage)

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let chunkCount = 0
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value?.byteLength) continue
      chunkCount += 1
      totalBytes += value.byteLength
      if (chunkCount > MAX_APPROVED_SVG_CHUNKS
        || !Number.isSafeInteger(totalBytes)
        || totalBytes > MAX_APPROVED_SVG_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw new Error(approvedOutputPngUnavailableMessage)
      }
      chunks.push(value)
    }
  } catch {
    await reader.cancel().catch(() => undefined)
    throw new Error(approvedOutputPngUnavailableMessage)
  } finally {
    reader.releaseLock()
  }
  if (signal.aborted || totalBytes === 0) throw new Error(approvedOutputPngUnavailableMessage)
  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  let svg: string
  try {
    svg = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error(approvedOutputPngUnavailableMessage)
  }
  if (!validateApprovedCampaignSvg(svg, result.aspectRatio, totalBytes)) throw new Error(approvedOutputPngUnavailableMessage)
  return svg
}

async function validPngBlob(blob: Blob) {
  if (blob.type !== 'image/png' || blob.size < pngSignature.length || blob.size > MAX_LOCAL_PNG_BYTES) return false
  const signature = new Uint8Array(await blob.slice(0, pngSignature.length).arrayBuffer())
  return pngSignature.every((value, index) => signature[index] === value)
}

export type ApprovedOutputPng = { blob: Blob; filename: string }
export type ApprovedSvgRasterizer = (svg: string, dimensions: OutputDimensions) => Promise<Blob>

export async function createApprovedOutputPng(
  result: GenerationResult,
  rasterize: ApprovedSvgRasterizer
): Promise<ApprovedOutputPng> {
  if (!canExportApprovedOutputPng(result)) throw new Error(approvedOutputPngUnavailableMessage)
  try {
    const svg = await fetchWithTimeout(
      result.downloadUrl!,
      { credentials: 'same-origin', headers: { accept: 'image/svg+xml' } },
      APPROVED_OUTPUT_TIMEOUT_MS,
      (response, signal) => readApprovedSvgResponse(response, signal, result)
    )
    const blob = await rasterize(svg, outputDimensions[result.aspectRatio as ApprovedAspectRatio])
    if (!await validPngBlob(blob)) throw new Error(approvedOutputPngUnavailableMessage)
    return { blob, filename: `aislestage-${result.aspectRatio.replace(':', 'x')}.png` }
  } catch {
    throw new Error(approvedOutputPngUnavailableMessage)
  }
}
