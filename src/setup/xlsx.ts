import { strFromU8, unzipSync } from 'fflate'

/**
 * A small reader for Excel files (.xlsx), enough to pull cell values out of a
 * workbook downloaded from Google Sheets. It reads the saved result of each
 * formula, never the formula. Nothing is uploaded: the file is read in the browser.
 */
export type CellValue = string | number | boolean | null

export interface Workbook {
  sheetNames: string[]
  /** The value of one cell, e.g. cell('Class List', 'B3'). null when empty or the sheet is missing. */
  cell(sheet: string, ref: string): CellValue
  hasSheet(sheet: string): boolean
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
}

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(tag)
  return m ? unescapeXml(m[1]) : undefined
}

/** All the text inside a shared string or inline string, across formatting runs. */
function textOf(xml: string): string {
  let out = ''
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) out += unescapeXml(m[1])
  return out
}

function parseSheet(xml: string, shared: string[]): Map<string, CellValue> {
  const cells = new Map<string, CellValue>()
  const re = /<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    const ref = attr(m[1], 'r')
    const body = m[2]
    if (!ref || body === undefined) continue
    const type = attr(m[1], 't')
    if (type === 'inlineStr') {
      cells.set(ref, textOf(body))
      continue
    }
    const v = /<v>([\s\S]*?)<\/v>/.exec(body)
    if (!v) continue
    const raw = unescapeXml(v[1])
    if (type === 's') cells.set(ref, shared[Number(raw)] ?? '')
    else if (type === 'b') cells.set(ref, raw === '1')
    else if (type === 'str' || type === 'e') cells.set(ref, raw)
    else cells.set(ref, Number(raw))
  }
  return cells
}

/** Open a workbook. Throws if the file is not an Excel file. */
export function readXlsx(data: Uint8Array): Workbook {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(data, {
      // Only the parts that hold names and values. Workbooks carry drawings and styles we never need.
      filter: (f) => f.name === 'xl/workbook.xml' || f.name === 'xl/_rels/workbook.xml.rels' || f.name === 'xl/sharedStrings.xml' || f.name.startsWith('xl/worksheets/sheet'),
    })
  } catch {
    throw new Error('That file is not an Excel workbook.')
  }
  const workbookXml = files['xl/workbook.xml']
  const relsXml = files['xl/_rels/workbook.xml.rels']
  if (!workbookXml || !relsXml) throw new Error('That file is not an Excel workbook.')

  const targets = new Map<string, string>()
  for (const m of strFromU8(relsXml).matchAll(/<Relationship\s([^>]*?)\/?>/g)) {
    const id = attr(m[1], 'Id')
    const target = attr(m[1], 'Target')
    if (id && target) targets.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target}`)
  }

  const paths = new Map<string, string>()
  const sheetNames: string[] = []
  for (const m of strFromU8(workbookXml).matchAll(/<sheet\s([^>]*?)\/?>/g)) {
    const name = attr(m[1], 'name')
    const rid = attr(m[1], 'r:id')
    const path = rid ? targets.get(rid) : undefined
    if (name && path) {
      sheetNames.push(name)
      paths.set(name, path)
    }
  }

  const sharedXml = files['xl/sharedStrings.xml']
  const shared: string[] = []
  if (sharedXml) {
    for (const m of strFromU8(sharedXml).matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)) shared.push(m[1] ? textOf(m[1]) : '')
  }

  const parsed = new Map<string, Map<string, CellValue>>()
  function sheet(name: string): Map<string, CellValue> | undefined {
    const done = parsed.get(name)
    if (done) return done
    const path = paths.get(name)
    const xml = path ? files[path] : undefined
    if (!xml) return undefined
    const cells = parseSheet(strFromU8(xml), shared)
    parsed.set(name, cells)
    return cells
  }

  return {
    sheetNames,
    hasSheet: (name) => paths.has(name),
    cell: (name, ref) => sheet(name)?.get(ref) ?? null,
  }
}
