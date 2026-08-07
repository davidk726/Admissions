/** 수능 모의고사(학력평가·모평) 성적 헬퍼 */

export type SubjectKey =
  | 'history'
  | 'korean'
  | 'math'
  | 'english'
  | 'inquiry1'
  | 'inquiry2'
  | 'secondLang'

export type ScoreInput = {
  /** 표준점수 — 한국사/영어는 미사용 */
  standard: Partial<Record<SubjectKey, number | null>>
  /** 백분위 — 성적표 값 직접 입력 (시험마다 다름) */
  percentile: Partial<Record<SubjectKey, number | null>>
  /** 등급 — 한국사/영어 필수 입력 */
  grade: Partial<Record<SubjectKey, number | null>>
  koreanElective: string
  mathElective: string
  inquiry1Name: string
  inquiry2Name: string
}

export const DEFAULT_SCORE: ScoreInput = {
  standard: {
    history: null,
    korean: 104,
    math: 110,
    english: null,
    inquiry1: 52,
    inquiry2: 54,
    secondLang: null,
  },
  percentile: {
    history: null,
    korean: 54,
    math: 63.39,
    english: null,
    inquiry1: 63.66,
    inquiry2: 60.36,
    secondLang: null,
  },
  grade: {
    history: 4,
    korean: null,
    math: null,
    english: 2,
    inquiry1: null,
    inquiry2: null,
    secondLang: null,
  },
  koreanElective: '화법과작문',
  mathElective: '확률과통계',
  inquiry1Name: '세계지리',
  inquiry2Name: '사회문화',
}

/** 영어 등급 → 환산용 백분위 상당(절대평가라 성적표에 백분위 없음) */
export const ENGLISH_GRADE_TO_PERCENTILE: Record<number, number> = {
  1: 100,
  2: 98,
  3: 94,
  4: 86,
  5: 70,
  6: 50,
  7: 30,
  8: 20,
  9: 10,
}

/**
 * 표준점수 규정 범위 (평가원: 평균 ± 5×표준편차, 범위 밖 절삭)
 * 실제 회차별 최저~최고는 시험마다 다르며, 입력 하한·상한 검증용으로만 사용
 */
export const STANDARD_SCALE = {
  main: { mean: 100, sd: 20 },
  inquiry: { mean: 50, sd: 10 },
} as const

export const STANDARD_RANGE = {
  main: {
    min: STANDARD_SCALE.main.mean - 5 * STANDARD_SCALE.main.sd,
    max: STANDARD_SCALE.main.mean + 5 * STANDARD_SCALE.main.sd,
  },
  inquiry: {
    min: STANDARD_SCALE.inquiry.mean - 5 * STANDARD_SCALE.inquiry.sd,
    max: STANDARD_SCALE.inquiry.mean + 5 * STANDARD_SCALE.inquiry.sd,
  },
} as const

export const PERCENTILE_RANGE = { min: 0, max: 100 } as const

export function standardKind(key: SubjectKey): 'main' | 'inquiry' | null {
  if (key === 'korean' || key === 'math') return 'main'
  if (key === 'inquiry1' || key === 'inquiry2') return 'inquiry'
  return null
}

export function clampStandard(key: SubjectKey, value: number): number {
  const kind = standardKind(key)
  if (!kind) return Math.round(value)
  const { min, max } = STANDARD_RANGE[kind]
  const rounded = Math.round(value)
  if (rounded < min) return min
  if (rounded > max) return max
  return rounded
}

export function isStandardInRange(key: SubjectKey, value: number | null | undefined): boolean {
  if (value == null || !Number.isFinite(value)) return false
  const kind = standardKind(key)
  if (!kind) return Number.isInteger(value)
  const { min, max } = STANDARD_RANGE[kind]
  return Number.isInteger(value) && value >= min && value <= max
}

export function clampPercentile(value: number): number {
  const n = Number(value.toFixed(2))
  if (n < PERCENTILE_RANGE.min) return PERCENTILE_RANGE.min
  if (n > PERCENTILE_RANGE.max) return PERCENTILE_RANGE.max
  return n
}

export function isPercentileInRange(value: number | null | undefined): boolean {
  if (value == null || !Number.isFinite(value)) return false
  return value >= PERCENTILE_RANGE.min && value <= PERCENTILE_RANGE.max
}

/** 백분위 → 대략 등급 (표시용, 실제 등급컷은 회차마다 다름) */
export function percentileToGrade(p: number): number {
  if (p >= 96) return 1
  if (p >= 89) return 2
  if (p >= 77) return 3
  if (p >= 60) return 4
  if (p >= 40) return 5
  if (p >= 23) return 6
  if (p >= 11) return 7
  if (p >= 4) return 8
  return 9
}

export type DerivedScores = {
  koreanP: number | null
  mathP: number | null
  englishP: number | null
  inquiry1P: number | null
  inquiry2P: number | null
  inquiryBestP: number | null
  historyGrade: number | null
  englishGrade: number | null
  /** 국30 수30 영20 탐(상위1)20 가중 환산 백분위 */
  convertedPercentile: number | null
  approxGrade: number | null
}

function readPercentile(
  input: ScoreInput,
  key: 'korean' | 'math' | 'inquiry1' | 'inquiry2',
): number | null {
  const p = input.percentile[key]
  return isPercentileInRange(p) ? (p as number) : null
}

export function deriveScores(input: ScoreInput): DerivedScores {
  const koreanP = readPercentile(input, 'korean')
  const mathP = readPercentile(input, 'math')
  const inquiry1P = readPercentile(input, 'inquiry1')
  const inquiry2P = readPercentile(input, 'inquiry2')
  const inquiryBestP =
    inquiry1P == null && inquiry2P == null
      ? null
      : Math.max(inquiry1P ?? -Infinity, inquiry2P ?? -Infinity)

  const englishGrade =
    input.grade.english != null &&
    Number.isInteger(input.grade.english) &&
    input.grade.english >= 1 &&
    input.grade.english <= 9
      ? input.grade.english
      : null
  const historyGrade =
    input.grade.history != null &&
    Number.isInteger(input.grade.history) &&
    input.grade.history >= 1 &&
    input.grade.history <= 9
      ? input.grade.history
      : null
  const englishP =
    englishGrade != null && ENGLISH_GRADE_TO_PERCENTILE[englishGrade] != null
      ? ENGLISH_GRADE_TO_PERCENTILE[englishGrade]
      : null

  let convertedPercentile: number | null = null
  if (koreanP != null && mathP != null && englishP != null && inquiryBestP != null) {
    convertedPercentile = Number(
      (koreanP * 0.3 + mathP * 0.3 + englishP * 0.2 + inquiryBestP * 0.2).toFixed(2),
    )
  }

  return {
    koreanP,
    mathP,
    englishP,
    inquiry1P,
    inquiry2P,
    inquiryBestP,
    historyGrade,
    englishGrade,
    convertedPercentile,
    approxGrade: convertedPercentile != null ? percentileToGrade(convertedPercentile) : null,
  }
}

export type Eligibility = '가능' | '적정' | '소신' | '어려움' | '확인필요'

export function judgeEligibility(
  derived: DerivedScores,
  cut70: number | null | undefined,
  scoreKind?: string,
): { status: Eligibility; diff: number | null; scale: 'percentile' | 'grade' | 'other' } {
  if (cut70 == null || !Number.isFinite(cut70)) {
    return { status: '확인필요', diff: null, scale: 'other' }
  }

  const isGradeScale =
    scoreKind === 'grade' ||
    (scoreKind !== 'percentile' && scoreKind !== 'converted' && cut70 >= 1 && cut70 <= 9)

  if (isGradeScale && cut70 <= 9.5) {
    const myGrade = derived.approxGrade
    if (myGrade == null) return { status: '확인필요', diff: null, scale: 'grade' }
    const diff = Number((cut70 - myGrade).toFixed(2))
    if (diff >= 0.5) return { status: '가능', diff, scale: 'grade' }
    if (diff >= 0) return { status: '적정', diff, scale: 'grade' }
    if (diff >= -0.5) return { status: '소신', diff, scale: 'grade' }
    return { status: '어려움', diff, scale: 'grade' }
  }

  if (cut70 > 9.5 && cut70 <= 100.5) {
    const mine = derived.convertedPercentile
    if (mine == null) return { status: '확인필요', diff: null, scale: 'percentile' }
    const diff = Number((mine - cut70).toFixed(2))
    if (diff >= 2) return { status: '가능', diff, scale: 'percentile' }
    if (diff >= 0) return { status: '적정', diff, scale: 'percentile' }
    if (diff >= -2) return { status: '소신', diff, scale: 'percentile' }
    return { status: '어려움', diff, scale: 'percentile' }
  }

  return { status: '확인필요', diff: null, scale: 'other' }
}
