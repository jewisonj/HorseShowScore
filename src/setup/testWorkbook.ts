import { strToU8, zipSync } from 'fflate'

/** Test helper: build a small Excel file from cell values, the way Google Sheets saves one. */
export function makeXlsx(sheets: Record<string, Record<string, string | number | boolean>>): Uint8Array {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const names = Object.keys(sheets)
  const shared: string[] = []
  const files: Record<string, Uint8Array> = {}
  names.forEach((name, i) => {
    const cells = Object.entries(sheets[name])
      .map(([ref, value]) => {
        if (typeof value === 'number') return `<c r="${ref}"><v>${value}</v></c>`
        if (typeof value === 'boolean') return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`
        if (value.startsWith('#')) return `<c r="${ref}" t="e"><f>VLOOKUP(1,A:B,2,FALSE)</f><v>${esc(value)}</v></c>`
        let index = shared.indexOf(value)
        if (index < 0) index = shared.push(value) - 1
        return `<c r="${ref}" s="3" t="s"><f>A1</f><v>${index}</v></c>`
      })
      .join('')
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(`<?xml version="1.0"?><worksheet><sheetData><row r="1">${cells}</row></sheetData></worksheet>`)
  })
  files['xl/workbook.xml'] = strToU8(
    `<?xml version="1.0"?><workbook xmlns:r="x"><sheets>${names.map((n, i) => `<sheet state="visible" name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 5}"/>`).join('')}</sheets></workbook>`,
  )
  files['xl/_rels/workbook.xml.rels'] = strToU8(
    `<?xml version="1.0"?><Relationships>${names.map((_, i) => `<Relationship Id="rId${i + 5}" Type="worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`,
  )
  files['xl/sharedStrings.xml'] = strToU8(
    `<?xml version="1.0"?><sst>${shared.map((s, i) => (i % 2 ? `<si><r><t>${esc(s.slice(0, 2))}</t></r><r><t xml:space="preserve">${esc(s.slice(2))}</t></r></si>` : `<si><t>${esc(s)}</t></si>`)).join('')}</sst>`,
  )
  files['xl/drawings/drawing1.xml'] = strToU8('<ignored/>')
  return zipSync(files)
}

/** A two-day show workbook in the layout the IHSA secretaries use. All names are made up. */
export function sampleShowWorkbook(): Uint8Array {
  const classTab = (riders: [number, string, string][]) => {
    const cells: Record<string, string | number | boolean> = { B2: 1, C5: 'Point Rider', D5: 'Draw', E5: 'Number', F5: 'Rider Name', H5: 'Horse Name', J5: 'Placings' }
    for (let i = 0; i < 12; i++) {
      const row = 6 + i
      cells[`D${row}`] = i + 1
      const r = riders[i]
      if (r) {
        cells[`E${row}`] = r[0]
        cells[`F${row}`] = r[1]
        cells[`G${row}`] = 'Example College'
        cells[`H${row}`] = r[2]
      } else {
        cells[`F${row}`] = '#N/A'
        cells[`H${row}`] = false
      }
    }
    return cells
  }
  return makeXlsx({
    ABOUT: { A1: 'Quick Start User Instructions' },
    // The horse committee has set the horses for classes 1 and 3. Class 2 is still empty.
    'Saturday Draw': {
      A4: 1, D5: 'Horse', D6: 'ROCKET', D7: 'ARCHIE (ROAN)', D8: 'ROCKET', D18: 'SPARE',
      G4: 2,
      M4: 3, P6: 'DUKE & DAISY', P18: 'SPARE', P19: "O'MALLEY",
      A24: 4, D26: 'SUPER PETE', D28: 'ROCKET',
    },
    'Horse Points': { C2: 'Input Horse Name', C3: 'ROCKET', C4: 'ARCHIE (ROAN)', C5: 'SUPER PETE', C6: "O'MALLEY", C7: 'DUKE & DAISY', C8: 'rocket', C9: 'SPARE' },
    'Class List': {
      B1: 'Class Source List Populates All Pages',
      A2: 'T', B2: 'March 6, 2027 Spring Western Show',
      A3: 1, B3: 'Reining', C3: 'Saturday', D3: 'Pat Example',
      A4: 2, B4: 'Level I Horsemanship, Sec. A', C4: 'Saturday', D4: 'Pat Example',
      A5: 3, B5: 'Level II Horsemanship', C5: 'Saturday', D5: 'Pat Example',
      A6: 4, B6: 'Ranch Riding', C6: 'Sunday', D6: 'Sam Sample',
      A7: 5, B7: 'Rookie B Horsemanship', C7: 'Sunday', D7: 'Sam Sample',
      A8: 6, B8: 'High Point Rider Standings',
    },
    Reining: classTab([[501, 'Ada  Able ', 'ROCKET'], [502, 'Ben Baker', 'ARCHIE (ROAN)']]),
    // The tab name carries a trailing space, as one did in the real workbook.
    'Level I Horsemanship, Sec. A ': classTab([[503, 'Cy Cole', 'SUPER PETE'], [504, 'Di Dunn', "O'MALLEY"], [505, 'Eve Ely', 'ROCKET']]),
    'Level II Horsemanship': classTab([]),
    'Ranch Riding': classTab([[501, 'Ada Able', 'DUKE & DAISY']]),
    Exhibitors: {
      B4: 'Input Back Number', C4: 'Input Rider Name', D4: 'Input School Name',
      B5: 501, C5: 'Ada  Able ', D5: 'Example College',
      B6: 502, C6: 'Ben Baker', D6: 'Example College',
      B7: 503, C7: 'Cy Cole', D7: 'Sample University ',
      B8: 504, C8: 'Di Dunn', D8: 'Sample University',
      B9: 505, C9: 'Eve Ely', D9: 'Sample University',
      C10: 'No number yet', D10: 'Sample University',
    },
  })
}
