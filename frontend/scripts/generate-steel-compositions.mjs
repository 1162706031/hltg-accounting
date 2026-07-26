import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const sourcePath = resolve(scriptDir, '../public/employee-manual/模具钢成分.md')
const outputPath = resolve(scriptDir, '../public/employee-manual/模具钢成分.json')
const source = readFileSync(sourcePath, 'utf8')
const elementCodes = ['C', 'Si', 'Mn', 'P', 'S', 'Cr', 'Mo', 'Ni', 'V', 'W', 'Co', 'Nb', 'Al']

function decodeEntities(value) {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
    .replaceAll('&nbsp;', ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
}

function cleanText(value) {
  return decodeEntities(value)
    .replace(/<eq>([\s\S]*?)<\/eq>/gi, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\\leqslant|\\leq/g, '≤')
    .replace(/\^\{\\?text\{?\d+\}?\}|\^\{\d+\}|\^\d+/g, '')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseAttributes(value) {
  return Object.fromEntries(
    [...value.matchAll(/([\w-]+)="([^"]*)"/g)].map((match) => [match[1].toLowerCase(), match[2]])
  )
}

function parseTable(tableHtml) {
  const rawRows = [...tableHtml.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)]
  const grid = []

  rawRows.forEach((rowMatch, rowIndex) => {
    grid[rowIndex] ??= []
    let columnIndex = 0
    const cells = [...rowMatch[1].matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/gi)]
    for (const cell of cells) {
      while (grid[rowIndex][columnIndex] !== undefined) columnIndex += 1
      const attributes = parseAttributes(cell[1])
      const rowSpan = Math.max(1, Number(attributes.rowspan) || 1)
      const columnSpan = Math.max(1, Number(attributes.colspan) || 1)
      const text = cleanText(cell[2])
      for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
        grid[rowIndex + rowOffset] ??= []
        for (let columnOffset = 0; columnOffset < columnSpan; columnOffset += 1) {
          grid[rowIndex + rowOffset][columnIndex + columnOffset] = text
        }
      }
      columnIndex += columnSpan
    }
  })

  const width = Math.max(...grid.map((row) => row.length))
  return grid.map((row) => Array.from({ length: width }, (_, index) => row[index] ?? ''))
}

function normalizeSearchTerm(value) {
  return cleanText(value)
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[‐‑‒–—―－]/g, '-')
    .replace(/[Х]/g, 'X')
    .replace(/[В]/g, 'B')
    .replace(/[М]/g, 'M')
    .replace(/[ФΦ]/g, 'F')
    .replace(/[Г]/g, 'G')
    .replace(/\s+/g, '')
    .trim()
}

function cleanGrade(value) {
  return cleanText(value)
    .replace(/\^.*$/, '')
    .replace(/^(?:ISO|DIN|ASTM|AISI\/SAE|JIS)\s*标准钢号\s*/i, '')
    .trim()
}

function round(value) {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000
}

function parseSpec(rawValue, impliedMaximum = false) {
  const value = cleanText(rawValue)
    .replace(/[～〜]/g, '~')
    .replace(/\s+/g, '')
    .replace(/[()]/g, '')
  if (!value || /^[—–-]+$/.test(value)) return null

  const numbers = [...value.matchAll(/\d+(?:\.\d+)?/g)].map((match) => Number(match[0]))
  if (!numbers.length) return null

  if ((value.includes('~') || value.includes('至')) && numbers.length >= 2) {
    const minimum = Math.min(numbers[0], numbers[1])
    const maximum = Math.max(numbers[0], numbers[1])
    return {
      raw: `${minimum}~${maximum}`,
      kind: 'range',
      min: minimum,
      max: maximum,
      nominal: round((minimum + maximum) / 2),
      ...(numbers[0] > numbers[1] ? { sourceRaw: value, correctedReversedBounds: true } : {})
    }
  }

  const maximumOnly = impliedMaximum || value.includes('≤') || value.startsWith('<')
  if (maximumOnly) {
    return { raw: `≤${numbers[0]}`, kind: 'maximum', max: numbers[0], nominal: numbers[0] }
  }

  return { raw: String(numbers[0]), kind: 'exact', min: numbers[0], max: numbers[0], nominal: numbers[0] }
}

function headerElement(value) {
  const header = cleanText(value).replace(/[≤<].*$/, '').replace(/[^A-Za-z]/g, '')
  return elementCodes.find((code) => header.toLowerCase() === code.toLowerCase())
}

function parseOtherElements(value) {
  const result = {}
  const text = cleanText(value).replace(/\s+/g, '')
  const pattern = /(Si|Mn|Cr|Mo|Co|Nb|Ni|Al|C|P|S|V|W)\s*:?\s*(≤|<)?\s*(\d+(?:\.\d+)?)(?:\s*[~～]\s*(\d+(?:\.\d+)?))?/g
  for (const match of text.matchAll(pattern)) {
    const code = elementCodes.find((element) => element.toLowerCase() === match[1].toLowerCase())
    if (!code) continue
    const raw = match[4] ? `${match[3]}~${match[4]}` : `${match[2] ?? ''}${match[3]}`
    result[code] = parseSpec(raw)
  }
  return result
}

function aliasValues(rawValue, kind) {
  let value = cleanGrade(rawValue)
  if (!value || /^[—–-]+$/.test(value)) return []
  const approximate = /^约/.test(value)
  value = value.replace(/^约/, '').replace(/^\((.*)\)$/, '$1').trim()
  const prefixedGrade = value.match(/(?:标准钢号)?\s*([A-Za-z0-9][A-Za-z0-9.\-/]*)$/)
  if (/标准钢号/.test(value) && prefixedGrade) value = prefixedGrade[1]
  if (!value) return []
  return [{ value, normalized: normalizeSearchTerm(value), kind, approximate }]
}

function gradeAndAliases(rawGrade) {
  const value = cleanGrade(rawGrade)
  const aliases = []
  let grade = value
  const parenthetical = value.match(/^(.*?)\(([^()]+)\)$/)
  if (parenthetical) {
    grade = parenthetical[1].trim()
    aliases.push(...aliasValues(parenthetical[2], 'parenthetical'))
  }
  const slashParts = grade.split('/').map((part) => part.trim()).filter(Boolean)
  if (slashParts.length > 1 && slashParts.every((part) => /[A-Za-zΑ-ωА-я]/.test(part))) {
    aliases.push(...slashParts.flatMap((part) => aliasValues(part, 'grade_variant')))
  }
  return { grade, aliases }
}

function sourceContext(tableMatch, tableIndex) {
  const before = source.slice(0, tableMatch.index)
  const headings = [...before.matchAll(/^##\s+(.+)$/gm)]
  const labels = [...before.matchAll(/^附录表[^\r\n]+$/gm)]
  return {
    table: tableIndex + 1,
    heading: headings.at(-1)?.[1]?.trim() ?? '',
    title: labels.at(-1)?.[0]?.trim() ?? headings.at(-1)?.[1]?.trim() ?? ''
  }
}

function uniqueAliases(aliases, grade) {
  const gradeKey = normalizeSearchTerm(grade)
  const seen = new Set()
  return aliases.filter((alias) => {
    if (!alias.normalized || alias.normalized === gradeKey || seen.has(`${alias.kind}:${alias.normalized}`)) return false
    seen.add(`${alias.kind}:${alias.normalized}`)
    return true
  })
}

function parseCompositionTable(grid, context) {
  const header = grid[1] ?? grid[0]
  const gradeColumns = header
    .map((value, index) => (/^钢号/.test(cleanText(value)) ? index : -1))
    .filter((index) => index >= 0)
  const gradeColumn = gradeColumns.at(-1)
  if (gradeColumn === undefined) return []

  const aliasColumns = header
    .map((value, index) => (/旧钢号/.test(value) ? [index, 'old_grade'] : /材料号/.test(value) ? [index, 'material_number'] : null))
    .filter(Boolean)
  const elementColumns = header
    .map((value, index) => {
      const code = headerElement(value)
      return code ? { index, code, impliedMaximum: /≤|</.test(cleanText(value)) } : null
    })
    .filter(Boolean)
  const otherColumn = header.findIndex((value) => /其他/.test(value))
  const categoryColumn = gradeColumn > 0 && /^钢号/.test(cleanText(header[gradeColumn - 1])) ? gradeColumn - 1 : -1
  const records = []

  for (const row of grid.slice(2)) {
    const parsedGrade = gradeAndAliases(row[gradeColumn])
    if (!parsedGrade.grade) {
      if (otherColumn >= 0 && records.length) Object.assign(records.at(-1).composition, parseOtherElements(row[otherColumn]))
      continue
    }

    const composition = {}
    for (const column of elementColumns) {
      const spec = parseSpec(row[column.index], column.impliedMaximum)
      if (spec) composition[column.code] = spec
    }
    if (otherColumn >= 0) Object.assign(composition, parseOtherElements(row[otherColumn]))
    if (!Object.keys(composition).length) continue

    const aliases = [...parsedGrade.aliases]
    for (const [index, kind] of aliasColumns) aliases.push(...aliasValues(row[index], kind))
    records.push({
      grade: parsedGrade.grade,
      normalizedGrade: normalizeSearchTerm(parsedGrade.grade),
      aliases: uniqueAliases(aliases, parsedGrade.grade),
      category: categoryColumn >= 0 ? cleanText(row[categoryColumn]) : '',
      composition,
      source: context
    })
  }
  return records
}

function parseDevelopedSteelTable(grid, context) {
  const header = grid[1]
  const gradeColumn = header.findIndex((value) => /^钢号/.test(cleanText(value)))
  const aliasColumn = header.findIndex((value) => /代号/.test(value))
  const notesColumn = header.findIndex((value) => /备注/.test(value))
  const categoryColumn = header.findIndex((value) => /钢组/.test(value))
  const otherColumn = header.findIndex((value) => /其他/.test(value))
  const elementColumns = header
    .map((value, index) => {
      const code = headerElement(value)
      return code ? { index, code, impliedMaximum: /≤|</.test(cleanText(value)) } : null
    })
    .filter(Boolean)
  const records = []

  for (const row of grid.slice(2)) {
    const parsedGrade = gradeAndAliases(row[gradeColumn])
    if (!parsedGrade.grade) continue
    const composition = {}
    for (const column of elementColumns) {
      const spec = parseSpec(row[column.index], column.impliedMaximum)
      if (spec) composition[column.code] = spec
    }
    if (otherColumn >= 0) Object.assign(composition, parseOtherElements(row[otherColumn]))
    if (!Object.keys(composition).length) continue

    const aliases = [...parsedGrade.aliases, ...aliasValues(row[aliasColumn], 'designation')]
    records.push({
      grade: parsedGrade.grade,
      normalizedGrade: normalizeSearchTerm(parsedGrade.grade),
      aliases: uniqueAliases(aliases, parsedGrade.grade),
      category: cleanText(row[categoryColumn]),
      notes: cleanText(row[notesColumn]),
      composition,
      source: { ...context, title: '附录3 我国研制和仿制的模具钢钢号、代号及主要化学成分' }
    })
  }
  return records
}

function parseEquivalenceTable(grid) {
  const results = []
  for (const row of grid.slice(2)) {
    const primaryGrade = cleanGrade(row[0])
    if (!primaryGrade) continue
    const aliases = row.slice(1).flatMap((value) => aliasValues(value, 'equivalent'))
    if (!aliases.length) continue
    results.push({
      primaryGrade,
      normalizedPrimaryGrade: normalizeSearchTerm(primaryGrade),
      aliases: uniqueAliases(aliases, primaryGrade)
    })
  }
  return results
}

const tableMatches = [...source.matchAll(/<table>([\s\S]*?)<\/table>/gi)]
if (tableMatches.length !== 30) throw new Error(`Expected 30 tables, found ${tableMatches.length}`)

const records = []
let equivalences = []
tableMatches.forEach((tableMatch, tableIndex) => {
  const grid = parseTable(tableMatch[1])
  const context = sourceContext(tableMatch, tableIndex)
  if (tableIndex === 25) {
    equivalences = parseEquivalenceTable(grid)
  } else if (tableIndex >= 26) {
    records.push(...parseDevelopedSteelTable(grid, context))
  } else {
    records.push(...parseCompositionTable(grid, context))
  }
})

records.forEach((record, index) => {
  record.id = `steel-${String(index + 1).padStart(4, '0')}`
})

const dc53 = records.find(
  (record) => record.normalizedGrade === 'CR8MO2SIV' && record.aliases.some((alias) => alias.normalized === 'DC53')
)
if (!dc53) throw new Error('DC53 -> Cr8Mo2SiV alias was not parsed')
if (records.length < 350) throw new Error(`Too few composition records parsed: ${records.length}`)

const payload = {
  meta: {
    source: '模具钢成分.md',
    sourceSha256: createHash('sha256').update(source).digest('hex'),
    tableCount: tableMatches.length,
    recordCount: records.length,
    equivalenceGroupCount: equivalences.length,
    nominalPolicy: 'range_midpoint; maximum_limit_uses_limit; exact_uses_exact'
  },
  elements: elementCodes,
  records,
  equivalences
}

writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
console.log(`Generated ${records.length} records and ${equivalences.length} equivalence groups`)
console.log(`DC53 -> ${dc53.grade}: ${Object.entries(dc53.composition).map(([code, spec]) => `${code}=${spec.raw}`).join(', ')}`)
