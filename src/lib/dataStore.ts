import type { AdmissionDataset, AdmissionsBundle } from './admission'

const STORAGE_KEY = 'admission-helper:extra-universities'

export function loadExtraUniversities(): AdmissionDataset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isDataset)
  } catch {
    return []
  }
}

export function saveExtraUniversities(list: AdmissionDataset[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
}

export function clearExtraUniversities() {
  localStorage.removeItem(STORAGE_KEY)
}

function isDataset(v: unknown): v is AdmissionDataset {
  if (!v || typeof v !== 'object') return false
  const d = v as AdmissionDataset
  return typeof d.id === 'string' && typeof d.university === 'string' && Array.isArray(d.majors)
}

/** 업로드 데이터로 기존 동일 id를 덮어쓰고 병합 */
export function mergeUniversities(
  base: AdmissionDataset[],
  incoming: AdmissionDataset[],
): AdmissionDataset[] {
  const map = new Map<string, AdmissionDataset>()
  for (const u of base) map.set(u.id, u)
  for (const u of incoming) {
    if (u.admissionType === '수시') continue
    map.set(u.id, u)
  }
  return Array.from(map.values()).sort((a, b) => {
    const byUniv = a.university.localeCompare(b.university, 'ko')
    if (byUniv !== 0) return byUniv
    return b.year - a.year
  })
}

export function toBundle(universities: AdmissionDataset[]): AdmissionsBundle {
  const filtered = universities.filter((u) => u.admissionType !== '수시')
  return {
    generatedAt: new Date().toISOString(),
    universityCount: filtered.length,
    majorCount: filtered.reduce((n, u) => n + u.majors.length, 0),
    universities: filtered,
  }
}

export function summarizeUpload(datasets: AdmissionDataset[]): string {
  const majors = datasets.reduce((n, d) => n + d.majors.length, 0)
  const names = datasets.map((d) => d.university).join(', ')
  return `${datasets.length}개 대학 · ${majors}개 모집단위 반영${names ? ` (${names})` : ''}`
}
