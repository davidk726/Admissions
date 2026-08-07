export type MajorResult = {
  code?: string
  campus?: string
  group?: string
  field?: string
  track?: string
  major: string
  quotaInitial?: number | null
  quotaFinal?: number | null
  applicants?: number | null
  competition?: number | null
  enrolled?: number | null
  waitlistNo?: number | null
  enrollRate?: number | null
  fillRate?: number | null
  cut50?: number | null
  cut70?: number | null
  cut80?: number | null
  cut90?: number | null
  cut100?: number | null
  avg?: number | null
  max?: number | null
  min?: number | null
  scoreKind?: string
}

export type AdmissionDataset = {
  id: string
  university: string
  year: number
  admissionType: string
  track: string
  scoreUnit: string
  scoreKind?: string
  source: string
  sourceNote: string
  majors: MajorResult[]
}

export type AdmissionsBundle = {
  generatedAt: string
  universityCount: number
  majorCount: number
  universities: AdmissionDataset[]
}

export type Band = '안정' | '적정' | '소신' | '위험'

export type MatchResult = MajorResult & {
  band: Band
  diff: number
  cut: number
}

export function effectiveCut(m: MajorResult): number | null {
  const candidates = [m.cut70, m.cut80, m.cut50, m.avg, m.min]
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c)) return c
  }
  return null
}

export function classifyBand(score: number, cut: number): Band {
  const diff = score - cut
  if (diff >= 2) return '안정'
  if (diff >= 0) return '적정'
  if (diff >= -2) return '소신'
  return '위험'
}

export function matchMajors(score: number, majors: MajorResult[]): MatchResult[] {
  return majors
    .map((m) => {
      const cut = effectiveCut(m)
      if (cut == null) return null
      return {
        ...m,
        cut,
        band: classifyBand(score, cut),
        diff: Number((score - cut).toFixed(3)),
      }
    })
    .filter((m): m is MatchResult => m != null)
    .sort((a, b) => b.diff - a.diff)
}

export function fmt(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return n.toFixed(digits)
}
