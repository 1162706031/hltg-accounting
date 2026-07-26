export const STEEL_COMPOSITION_ELEMENTS = ['C', 'Mn', 'Si', 'Cr', 'W', 'Mo', 'V', 'Co', 'Nb', 'Ni', 'P', 'S'] as const

export type SteelCompositionElement = (typeof STEEL_COMPOSITION_ELEMENTS)[number]

export interface CompositionSpec {
  raw: string
  kind: 'range' | 'maximum' | 'exact'
  min?: number
  max: number
  nominal: number
  sourceRaw?: string
  correctedReversedBounds?: boolean
}

interface SteelAlias {
  value: string
  normalized: string
  kind: 'designation' | 'old_grade' | 'material_number' | 'parenthetical' | 'grade_variant'
  approximate: boolean
}

export interface SteelCompositionRecord {
  id: string
  grade: string
  normalizedGrade: string
  aliases: SteelAlias[]
  category?: string
  notes?: string
  composition: Partial<Record<SteelCompositionElement | 'Al', CompositionSpec>>
  source: {
    table: number
    heading: string
    title: string
  }
}

export interface UserSteelCompositionSource {
  id: number | string
  name: string
  chemical_composition?: Record<string, string | number | null | undefined> | null
}

interface SteelEquivalence {
  primaryGrade: string
  normalizedPrimaryGrade: string
  aliases: Array<{
    value: string
    normalized: string
    kind: 'equivalent'
    approximate: boolean
  }>
}

interface SteelCompositionData {
  records: SteelCompositionRecord[]
  equivalences: SteelEquivalence[]
}

export interface SteelCompositionMatch {
  status: 'found'
  record: SteelCompositionRecord
  matchedTerm: string
  matchedBy: 'grade' | 'designation' | 'old_grade' | 'material_number' | 'parenthetical' | 'grade_variant' | 'equivalent'
}

export interface AmbiguousSteelCompositionMatch {
  status: 'ambiguous'
  candidates: SteelCompositionRecord[]
}

export interface MissingSteelCompositionMatch {
  status: 'not_found'
}

export type SteelCompositionLookupResult =
  | SteelCompositionMatch
  | AmbiguousSteelCompositionMatch
  | MissingSteelCompositionMatch

const DATA_URL = '/employee-manual/%E6%A8%A1%E5%85%B7%E9%92%A2%E6%88%90%E5%88%86.json'
let dataPromise: Promise<SteelCompositionData> | undefined

function normalizeTerm(value: string): string {
  return value
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

function compactTerm(value: string): string {
  return normalizeTerm(value).replace(/[-_.\/()]/g, '')
}

function queryTerms(query: string): Array<{ value: string; isWhole: boolean }> {
  const whole = normalizeTerm(query)
  const extracted = query.match(/[A-Za-zΑ-ωА-я0-9][A-Za-zΑ-ωА-я0-9.\-_/]*/g) ?? []
  const terms = [{ value: whole, isWhole: true }, ...extracted.map((value) => ({ value: normalizeTerm(value), isWhole: false }))]
  const seen = new Set<string>()
  return terms.filter((term) => {
    if (term.value.length < 2 || seen.has(term.value)) return false
    seen.add(term.value)
    return true
  })
}

/**
 * 从物品名称中提取纯钢号。描述性后缀不会进入用户补充成分记录，
 * 例如 H13锭物品、H13母棒均提取为 H13，SKD 61钢锭提取为 SKD61。
 */
export function extractSteelGradeName(itemName: string): string | null {
  const normalizedName = itemName.normalize('NFKC').trim()
  if (!normalizedName) return null

  const tokens = normalizedName.match(/[A-Za-zΑ-ωА-я0-9][A-Za-zΑ-ωА-я0-9.\-_/]*/g) ?? []
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    const hasLetter = /[A-Za-zΑ-ωА-я]/.test(token)
    const hasDigit = /\d/.test(token)
    if (hasLetter && hasDigit) return normalizeTerm(token)

    const next = tokens[index + 1]
    if (hasLetter && next && /^\d+$/.test(next)) return normalizeTerm(`${token}${next}`)
    if (/^\d+(?:\.\d+)+$/.test(token) || /^\d{3,8}$/.test(token)) return normalizeTerm(token)
  }

  const withoutDescription = normalizedName
    .replace(/[（(【\[].*?[）)】\]]\s*$/g, '')
    .replace(/(?:钢锭|锭物品|锭料|锭|母棒|圆棒|棒材|圆钢|钢棒|板材|钢板|扁钢|模块|模具钢|原料|坯料|毛坯|锻件|物品)+$/g, '')
    .trim()
  return withoutDescription ? normalizeTerm(withoutDescription) : null
}

function formatCompositionNumber(value: string | number): string {
  return String(Number(value))
}

/** 将后端已保存的物品转为只保留纯钢号的用户补充成分记录。 */
export function userItemToSteelCompositionRecord(item: UserSteelCompositionSource): SteelCompositionRecord | null {
  const grade = extractSteelGradeName(item.name)
  if (!grade || !item.chemical_composition) return null

  const composition: SteelCompositionRecord['composition'] = {}
  for (const code of STEEL_COMPOSITION_ELEMENTS) {
    const input = item.chemical_composition[code]
    if (input === null || input === undefined || input === '') continue
    const value = Number(input)
    if (!Number.isFinite(value) || value <= 0 || value > 100) continue
    const raw = formatCompositionNumber(input)
    composition[code] = { raw, kind: 'exact', max: value, nominal: value }
  }
  if (!Object.keys(composition).length) return null

  return {
    id: `user-item:${item.id}`,
    grade,
    normalizedGrade: normalizeTerm(grade),
    aliases: [],
    category: '用户补充',
    composition,
    source: {
      table: 0,
      heading: '用户补充成分',
      title: '用户保存的物品成分'
    }
  }
}

async function loadData(): Promise<SteelCompositionData> {
  dataPromise ??= fetch(DATA_URL).then(async (response) => {
    if (!response.ok) throw new Error(`钢种成分数据库加载失败（${response.status}）`)
    return response.json() as Promise<SteelCompositionData>
  })
  return dataPromise
}

function recordsCompatible(left: SteelCompositionRecord, right: SteelCompositionRecord): boolean {
  return STEEL_COMPOSITION_ELEMENTS.every((code) => {
    const leftSpec = left.composition[code]
    const rightSpec = right.composition[code]
    return !leftSpec || !rightSpec || leftSpec.raw === rightSpec.raw
  })
}

function recordPriority(record: SteelCompositionRecord): number {
  const completeness = STEEL_COMPOSITION_ELEMENTS.filter((code) => record.composition[code]).length
  const title = record.source.title
  const sourceScore = title.includes('附录3') ? 30 : title.includes('GB/T') ? 20 : /ASTM|JIS|DIN/.test(title) ? 10 : 0
  return sourceScore + completeness
}

export async function lookupSteelComposition(
  query: string,
  additionalRecords: SteelCompositionRecord[] = []
): Promise<SteelCompositionLookupResult> {
  const data = await loadData()
  const terms = queryTerms(query)
  if (!terms.length) return { status: 'not_found' }

  const matches = new Map<string, { record: SteelCompositionRecord; score: number; matchedTerm: string; matchedBy: SteelCompositionMatch['matchedBy'] }>()
  const addMatch = (
    record: SteelCompositionRecord,
    score: number,
    matchedTerm: string,
    matchedBy: SteelCompositionMatch['matchedBy']
  ) => {
    const existing = matches.get(record.id)
    if (!existing || score > existing.score) matches.set(record.id, { record, score, matchedTerm, matchedBy })
  }

  for (const record of [...data.records, ...additionalRecords]) {
    for (const term of terms) {
      const tokenPenalty = term.isWhole ? 0 : 30
      if (record.normalizedGrade === term.value) addMatch(record, 1000 - tokenPenalty, record.grade, 'grade')
      else if (compactTerm(record.normalizedGrade) === compactTerm(term.value)) addMatch(record, 800 - tokenPenalty, record.grade, 'grade')

      for (const alias of record.aliases) {
        if (alias.approximate) continue
        const strictScores: Record<SteelAlias['kind'], number> = {
          designation: 930,
          material_number: 900,
          old_grade: 880,
          parenthetical: 860,
          grade_variant: 840
        }
        if (alias.normalized === term.value) addMatch(record, strictScores[alias.kind] - tokenPenalty, alias.value, alias.kind)
        else if (compactTerm(alias.normalized) === compactTerm(term.value)) {
          addMatch(record, strictScores[alias.kind] - 180 - tokenPenalty, alias.value, alias.kind)
        }
      }
    }
  }

  for (const equivalence of data.equivalences) {
    for (const alias of equivalence.aliases) {
      if (alias.approximate) continue
      for (const term of terms) {
        const strict = alias.normalized === term.value
        const compact = compactTerm(alias.normalized) === compactTerm(term.value)
        if (!strict && !compact) continue
        for (const record of data.records.filter((item) => item.normalizedGrade === equivalence.normalizedPrimaryGrade)) {
          addMatch(record, (strict ? 650 : 550) - (term.isWhole ? 0 : 30), alias.value, 'equivalent')
        }
      }
    }
  }

  const ranked = [...matches.values()].sort(
    (left, right) => right.score - left.score || recordPriority(right.record) - recordPriority(left.record)
  )
  if (!ranked.length) return { status: 'not_found' }

  const topScore = ranked[0].score
  const topMatches = ranked.filter((match) => match.score === topScore)
  const compatible = topMatches.every((match, index) =>
    topMatches.slice(index + 1).every((other) => recordsCompatible(match.record, other.record))
  )
  if (!compatible) {
    return { status: 'ambiguous', candidates: topMatches.slice(0, 6).map((match) => match.record) }
  }

  const best = topMatches[0]
  return { status: 'found', record: best.record, matchedTerm: best.matchedTerm, matchedBy: best.matchedBy }
}

export function compositionFormValues(record: SteelCompositionRecord): Record<SteelCompositionElement, string> {
  return Object.fromEntries(
    STEEL_COMPOSITION_ELEMENTS.map((code) => [code, String(record.composition[code]?.nominal ?? 0)])
  ) as Record<SteelCompositionElement, string>
}

export function compositionRangeSummary(record: SteelCompositionRecord): string {
  return STEEL_COMPOSITION_ELEMENTS.flatMap((code) => {
    const spec = record.composition[code]
    return spec ? [`${code} ${spec.raw}%`] : []
  }).join('，')
}
