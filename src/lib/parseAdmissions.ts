import type { AdmissionDataset, MajorResult } from './admission'

type ColMap = Record<string, number>

function cleanText(v: unknown): string {
  if (v == null) return ''
  return String(v)
    .replace(/\u00a0/g, ' ')
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function toNumber(v: unknown): number | null {
  if (v == null || v === '') return null
  if (typeof v === 'number' && Number.isFinite(v)) return v
  let s = cleanText(v).replace(/,/g, '').replace(/%/g, '')
  if (!s || s === '-' || s === '—' || s === '–') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function classifyHeader(cell: string): string | null {
  const h = cleanText(cell).toLowerCase().replace(/\s+/g, '')
  if (!h) return null
  const mapping: Array<[string[], string]> = [
    [['모집단위', '학과명', '모집학과', '학부', '전공명', '학과'], 'major'],
    [['모집전형', '전형명', '전형구분', '세부전형', '전형'], 'track'],
    [['캠퍼스'], 'campus'],
    [['계열', '단과대학'], 'field'],
    [['모집군'], 'group'],
    [['모집인원', '정원'], 'quota'],
    [['지원인원', '지원자'], 'applicants'],
    [['경쟁률'], 'competition'],
    [['최종등록', '등록인원'], 'enrolled'],
    [['예비', '충원'], 'waitlist'],
    [['50%cut', '50%컷', '등급(50%)', '학생부등급(50%)', '50%'], 'cut50'],
    [['70%cut', '70%컷', '등급(70%)', '학생부등급(70%)', '75%컷', '75%cut', '70%', '75%'], 'cut70'],
    [['80%컷', '80%cut', '등록80%', '80%'], 'cut80'],
    [['90%컷', '90%cut', '등급(90%)', '90%'], 'cut90'],
    [['100%컷', '100%cut', '100%'], 'cut100'],
    [['환산점수', '환산총점', '대학환산'], 'avg'],
    [['평균', '평균백분위'], 'avg'],
    [['최고', '최우수'], 'max'],
    [['최저', '최하', '합격컷', '컷오프'], 'min'],
    [['백분위'], 'percentile_generic'],
    [['수능등급', '등급'], 'grade_generic'],
  ]
  // 단독 '군'은 너무 넓어서 모집군만 우선 처리 후 짧은 헤더만
  for (const [keys, label] of mapping) {
    for (const k of keys) {
      if (h.includes(k.toLowerCase().replace(/\s+/g, ''))) return label
    }
  }
  if (h === '군' || h.endsWith('군')) return 'group'
  return null
}

function mergeHeaderRows(a: unknown[], b: unknown[] | null): string[] {
  const width = Math.max(a.length, b?.length ?? 0)
  const merged: string[] = []
  for (let j = 0; j < width; j++) {
    const left = cleanText(a[j])
    const right = b ? cleanText(b[j]) : ''
    if (left && right && left !== right) merged.push(`${left} ${right}`)
    else merged.push(left || right)
  }
  return merged
}

function scoreKindFromHeaders(headers: string[]): string {
  const joined = headers.join(' ')
  if (joined.includes('등급') && !joined.includes('백분위') && !joined.includes('환산')) return 'grade'
  if (joined.includes('백분위')) return 'percentile'
  if (joined.includes('환산') || joined.includes('컷')) return 'converted'
  return 'mixed'
}

function findHeaderRow(
  rows: unknown[][],
  maxScan = 25,
): { idx: number; colmap: ColMap; headers: string[] } | null {
  let best: { score: number; idx: number; colmap: ColMap; headers: string[] } | null = null

  for (let i = 0; i < Math.min(rows.length, maxScan); i++) {
    const candidates: Array<{ headers: string[]; dataStart: number }> = [
      { headers: rows[i].map(cleanText), dataStart: i },
    ]
    if (i + 1 < rows.length) {
      candidates.push({
        headers: mergeHeaderRows(rows[i], rows[i + 1]),
        dataStart: i + 1,
      })
    }

    for (const { headers, dataStart } of candidates) {
      const labels: ColMap = {}
      headers.forEach((cell, j) => {
        const kind = classifyHeader(cell)
        if (kind && labels[kind] == null) labels[kind] = j
      })
      headers.forEach((cell, j) => {
        const h = cell.replace(/\s+/g, '')
        if (h.includes('최종등록') && h.includes('50%')) labels.cut50 = j
        if (h.includes('최종등록') && (h.includes('70%') || h.includes('75%'))) labels.cut70 = j
      })

      let score = labels.major != null ? 3 : 0
      for (const k of ['competition', 'cut70', 'cut50', 'avg', 'quota', 'applicants', 'cut80']) {
        if (labels[k] != null) score += 1
      }
      if (score >= 3 && labels.major != null) {
        if (!best || score > best.score || (score === best.score && dataStart < best.idx)) {
          best = { score, idx: dataStart, colmap: labels, headers }
        }
      }
    }
  }
  return best ? { idx: best.idx, colmap: best.colmap, headers: best.headers } : null
}

function rowToMajor(
  row: unknown[],
  colmap: ColMap,
  headers: string[],
  defaults: { track: string; campus: string; field: string; group: string },
): MajorResult | null {
  const get = (label: string) => {
    const idx = colmap[label]
    if (idx == null || idx >= row.length) return null
    return row[idx]
  }

  const major = cleanText(get('major'))
  if (!major || ['합계', '소계', '계', '모집단위', '학과', '구분'].includes(major)) return null
  if (/^\d+$/.test(major) || major.length < 2) return null

  let cut70 = toNumber(get('cut70'))
  let cut50 = toNumber(get('cut50'))
  let cut80 = toNumber(get('cut80'))
  const cut90 = toNumber(get('cut90'))
  let cut100 = toNumber(get('cut100'))
  let avg = toNumber(get('avg'))
  const mx = toNumber(get('max'))
  const mn = toNumber(get('min'))

  if (avg == null && colmap.percentile_generic != null) {
    avg = toNumber(get('percentile_generic'))
  }
  if (cut80 == null && colmap.percentile_generic != null && colmap.cut80 == null) {
    const hdr = headers[colmap.percentile_generic] ?? ''
    if (hdr.includes('80') || hdr.includes('컷')) cut80 = toNumber(get('percentile_generic'))
  }
  if (cut70 == null && cut80 != null) cut70 = cut80
  // 평균은 별도 컬럼으로 유지 (cut70에 복사하지 않음)
  if (cut100 == null && mn != null) cut100 = mn
  if (cut70 == null && colmap.grade_generic != null && colmap.avg == null) {
    const g = toNumber(get('grade_generic'))
    if (g != null) cut70 = g
  }
  if (
    cut70 == null &&
    avg == null &&
    colmap.percentile_generic != null &&
    colmap.avg == null
  ) {
    const p = toNumber(get('percentile_generic'))
    if (p != null) cut70 = p
  }

  const competition = toNumber(get('competition'))
  const quota = toNumber(get('quota'))
  const applicants = toNumber(get('applicants'))
  const enrolled = toNumber(get('enrolled'))
  const waitlist = toNumber(get('waitlist'))

  const metrics = [cut50, cut70, cut80, cut90, cut100, avg, mx, mn, competition]
  if (metrics.every((m) => m == null)) return null

  let group = cleanText(get('group')) || defaults.group
  if (group.endsWith('군') && group.length <= 3) group = group.replace(/군$/, '')

  return {
    major,
    track: cleanText(get('track')) || defaults.track,
    campus: cleanText(get('campus')) || defaults.campus,
    group,
    field: cleanText(get('field')) || defaults.field,
    quotaInitial: quota,
    applicants,
    competition,
    enrolled,
    waitlistNo: waitlist,
    cut50,
    cut70,
    cut80,
    cut90,
    cut100,
    avg,
    max: mx,
    min: mn,
    scoreKind: scoreKindFromHeaders(headers),
  }
}

export type FileMeta = {
  university: string
  year: number
  /** 파일명 기준. 혼합 파일은 시트에서 정시만 추출 */
  admissionType: '정시' | '수시' | '혼합'
  campusHint: string
  source: string
}

export function parseFilename(name: string): FileMeta {
  const base = name.replace(/\.(xlsx|xls|json)$/i, '')
  const m = base.match(/^(.+?)_(\d{4})\s*(수시|정시|입시결과)?(.*)$/)
  let university = base
  let year = new Date().getFullYear()
  let admissionType: FileMeta['admissionType'] = '정시'
  let campusHint = ''

  if (m) {
    university = m[1].trim()
    year = Number(m[2])
    const kind = m[3] ?? ''
    const rest = m[4] ?? ''
    const blob = `${kind} ${rest}`
    const hasSusi = blob.includes('수시') || name.includes('수시')
    const hasJeongsi = blob.includes('정시') || name.includes('정시')
    if (hasSusi && hasJeongsi) admissionType = '혼합'
    else if (hasSusi && !hasJeongsi && kind === '수시') admissionType = '수시'
    else if (hasJeongsi || kind === '입시결과' || kind === '정시') admissionType = '정시'
    else if (hasSusi) admissionType = '수시'
    const campus = rest.match(/\(([^)]+)\)/)
    if (campus) campusHint = campus[1]
  } else if (name.includes('수시') && name.includes('정시')) {
    admissionType = '혼합'
  } else if (name.includes('수시')) {
    admissionType = '수시'
  }

  return { university, year, admissionType, campusHint, source: name }
}

/** 시트명으로 수시/정시 구분. 둘 다 없으면 unknown */
function sheetAdmissionKind(sheetName: string): '수시' | '정시' | 'unknown' {
  const n = sheetName.replace(/\s+/g, '')
  const hasJeongsi = n.includes('정시')
  const hasSusi = n.includes('수시')
  if (hasJeongsi && !hasSusi) return '정시'
  if (hasSusi && !hasJeongsi) return '수시'
  if (hasJeongsi && hasSusi) return '정시' // 시트명에 둘 다 있으면 정시 우선 시도
  return 'unknown'
}

function shouldKeepSheet(sheetName: string, fileKind: FileMeta['admissionType']): boolean {
  if (/목차|안내|표지/.test(sheetName)) return false
  const kind = sheetAdmissionKind(sheetName)
  if (kind === '수시') return false // 수시 시트는 항상 제외
  if (kind === '정시') return true // 파일명에 수시가 있어도 정시 시트는 채택
  // 시트명에 구분이 없으면: 순수 수시 파일만 제외, 그 외(정시·혼합·입시결과)는 포함
  return fileKind !== '수시'
}

function isSusiTrack(track: string): boolean {
  const t = track.replace(/\s+/g, '')
  return t.includes('수시') && !t.includes('정시')
}

function dominantScoreKind(majors: MajorResult[]): string {
  const counts: Record<string, number> = {}
  for (const m of majors) {
    const k = m.scoreKind || 'unknown'
    counts[k] = (counts[k] ?? 0) + 1
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown'
}

function extractXlsxSheet(
  rows: unknown[][],
  sheetName: string,
  meta: FileMeta,
): MajorResult[] {
  const found = findHeaderRow(rows)
  if (!found) return []
  const { idx, colmap, headers } = found
  const defaults = {
    track: ['Sheet1', 'Sheet2', '정시', '수시'].includes(sheetName) ? meta.admissionType : sheetName,
    campus: meta.campusHint,
    field: '',
    group: '',
  }

  let lastMajor = ''
  let lastTrack = defaults.track
  let lastCampus = defaults.campus
  let lastField = ''
  const majors: MajorResult[] = []

  for (const raw of rows.slice(idx + 1)) {
    const cells = [...raw]
    const mi = colmap.major
    if (mi != null && mi < cells.length) {
      if (cleanText(cells[mi])) lastMajor = cleanText(cells[mi])
      else if (lastMajor && cells.some((c) => toNumber(c) != null)) cells[mi] = lastMajor
    }
    const ti = colmap.track
    if (ti != null && ti < cells.length) {
      if (cleanText(cells[ti])) lastTrack = cleanText(cells[ti])
      else cells[ti] = lastTrack
    }
    const ci = colmap.campus
    if (ci != null && ci < cells.length) {
      if (cleanText(cells[ci])) lastCampus = cleanText(cells[ci])
      else cells[ci] = lastCampus
    }
    const fi = colmap.field
    if (fi != null && fi < cells.length) {
      if (cleanText(cells[fi])) lastField = cleanText(cells[fi])
      else cells[fi] = lastField
    }

    const major = rowToMajor(cells, colmap, headers, {
      track: lastTrack || defaults.track,
      campus: lastCampus || defaults.campus,
      field: lastField,
      group: '',
    })
    if (major) majors.push(major)
  }
  return majors
}

export async function parseXlsxFile(buffer: ArrayBuffer, filename: string): Promise<AdmissionDataset> {
  const XLSX = await import('xlsx')
  const meta = parseFilename(filename)

  const wb = XLSX.read(buffer, { type: 'array', cellDates: false })
  const allMajors: MajorResult[] = []
  const notes: string[] = []
  const skippedSheets: string[] = []

  for (const sheetName of wb.SheetNames) {
    if (!shouldKeepSheet(sheetName, meta.admissionType)) {
      if (sheetAdmissionKind(sheetName) === '수시') skippedSheets.push(sheetName)
      continue
    }
    const sheet = wb.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: null,
      raw: true,
    }) as unknown[][]
    // 시트 단위로는 정시로 취급
    const sheetMeta: FileMeta = { ...meta, admissionType: '정시' }
    const majors = extractXlsxSheet(rows, sheetName, sheetMeta).filter(
      (m) => !isSusiTrack(m.track || ''),
    )
    notes.push(`${sheetName}: ${majors.length}`)
    allMajors.push(...majors)
  }

  if (allMajors.length === 0) {
    if (skippedSheets.length > 0 && meta.admissionType === '수시') {
      throw new Error(
        '정시 시트를 찾지 못했습니다. 수시 시트만 있는 파일이면 정시 시트가 있는 파일을 올려 주세요.',
      )
    }
    throw new Error(`정시 표를 읽지 못했습니다: ${filename}`)
  }

  const kind = dominantScoreKind(allMajors)
  let id = `${meta.university}-${meta.year}-정시`
  if (meta.campusHint) id += `-${meta.campusHint}`

  const skipNote = skippedSheets.length ? ` · 수시시트제외(${skippedSheets.join(', ')})` : ''

  return {
    id,
    university: meta.university,
    year: meta.year,
    admissionType: '정시',
    track: '정시',
    scoreUnit:
      kind === 'grade'
        ? '학생부/수능 등급'
        : kind === 'percentile'
          ? '백분위'
          : kind === 'converted'
            ? '대학 환산점수'
            : '미상',
    scoreKind: kind,
    source: meta.source,
    sourceNote: `업로드 · ${notes.join('; ')}${skipNote}`,
    majors: allMajors,
  }
}

export function parseJsonFile(text: string, filename: string): AdmissionDataset[] {
  const data = JSON.parse(text) as unknown
  if (Array.isArray(data)) {
    return data.filter((d): d is AdmissionDataset => {
      return (
        d &&
        typeof d === 'object' &&
        typeof (d as AdmissionDataset).university === 'string' &&
        Array.isArray((d as AdmissionDataset).majors)
      )
    }).map(normalizeDataset)
  }

  if (data && typeof data === 'object' && Array.isArray((data as { universities?: unknown }).universities)) {
    return ((data as { universities: AdmissionDataset[] }).universities).map(normalizeDataset)
  }

  if (
    data &&
    typeof data === 'object' &&
    typeof (data as AdmissionDataset).university === 'string' &&
    Array.isArray((data as AdmissionDataset).majors)
  ) {
    return [normalizeDataset(data as AdmissionDataset)]
  }

  throw new Error(`지원하지 않는 JSON 형식입니다: ${filename}`)
}

function normalizeDataset(d: AdmissionDataset): AdmissionDataset {
  const meta = parseFilename(d.source || `${d.university}_${d.year} ${d.admissionType}`)
  const admissionType = d.admissionType || meta.admissionType || '정시'
  const university = d.university || meta.university
  const year = d.year || meta.year
  const id = d.id || `${university}-${year}-${admissionType}`
  return {
    ...d,
    id,
    university,
    year,
    admissionType,
    track: d.track || admissionType,
    scoreUnit: d.scoreUnit || '미상',
    source: d.source || meta.source,
    sourceNote: d.sourceNote || '업로드 JSON',
    majors: d.majors ?? [],
  }
}

export type UploadResult = {
  datasets: AdmissionDataset[]
  skipped: string[]
  errors: string[]
}

export async function parseUploadFiles(files: FileList | File[]): Promise<UploadResult> {
  const list = Array.from(files)
  const datasets: AdmissionDataset[] = []
  const skipped: string[] = []
  const errors: string[] = []

  for (const file of list) {
    const name = file.name
    try {
      if (/\.pdf$/i.test(name)) {
        skipped.push(`${name} (PDF는 브라우저에서 자동 분석이 어렵습니다. xlsx 또는 JSON으로 올려 주세요)`)
        continue
      }
      if (/\.json$/i.test(name)) {
        const text = await file.text()
        const parsed = parseJsonFile(text, name).filter((d) => d.admissionType !== '수시')
        if (parsed.length === 0) skipped.push(`${name} (수시만 있거나 데이터 없음)`)
        else datasets.push(...parsed)
        continue
      }
      if (/\.xlsx?$/i.test(name)) {
        const buf = await file.arrayBuffer()
        datasets.push(await parseXlsxFile(buf, name))
        continue
      }
      skipped.push(`${name} (지원 형식: .xlsx / .json)`)
    } catch (e) {
      errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return { datasets, skipped, errors }
}
