import type { Eligibility } from './score'
import type { Stream } from './stream'

export type ExportRow = {
  university: string
  year: number
  admissionType: string
  group?: string
  stream: Stream
  major: string
  track?: string
  field?: string
  campus?: string
  competition?: number | null
  quotaInitial?: number | null
  enrolled?: number | null
  cut?: number | null
  judge: { status: Eligibility }
}

export async function exportRowsToExcel(rows: ExportRow[], filename?: string) {
  const XLSX = await import('xlsx')
  const data = rows.map((r) => ({
    대학: r.university,
    연도: r.year,
    전형: r.admissionType,
    군: r.group || '',
    계열: r.stream,
    학과: r.major,
    전형명: r.track || '',
    단과대: r.field || '',
    캠퍼스: r.campus || '',
    경쟁률: r.competition ?? '',
    정원: r.quotaInitial ?? '',
    등록: r.enrolled ?? '',
    백분위: r.cut ?? '',
    지원가능여부: r.judge.status,
  }))

  const ws = XLSX.utils.json_to_sheet(data)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '입결')

  const stamp = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(wb, filename ?? `입결분석_${stamp}.xlsx`)
}
