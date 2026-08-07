import { useMemo, useRef, useState, type ChangeEvent } from 'react'
import bundleRaw from './data/processed/admissions.json'
import {
  fmt,
  type AdmissionsBundle,
  type AdmissionDataset,
  type MajorResult,
} from './lib/admission'
import {
  loadExtraUniversities,
  mergeUniversities,
  saveExtraUniversities,
  summarizeUpload,
  toBundle,
} from './lib/dataStore'
import { parseUploadFiles } from './lib/parseAdmissions'
import {
  DEFAULT_SCORE,
  PERCENTILE_RANGE,
  STANDARD_RANGE,
  clampPercentile,
  clampStandard,
  deriveScores,
  isPercentileInRange,
  isStandardInRange,
  judgeEligibility,
  percentileToGrade,
  standardKind,
  type Eligibility,
  type ScoreInput,
  type SubjectKey,
} from './lib/score'
import { classifyStream, STREAMS, type Stream } from './lib/stream'
import { exportRowsToExcel } from './lib/exportExcel'
import './App.css'

const bundled = bundleRaw as AdmissionsBundle

function buildLiveBundle(extras: AdmissionDataset[]): AdmissionsBundle {
  return toBundle(mergeUniversities(bundled.universities, extras))
}

type FlatRow = MajorResult & {
  university: string
  year: number
  admissionType: string
  scoreKind?: string
  univId: string
}

/** 표시·판정용 백분위: 평균 → 70% → 50% → 최저 */
function displayPercentile(r: {
  avg?: number | null
  cut70?: number | null
  cut50?: number | null
  min?: number | null
}): number | null {
  for (const v of [r.avg, r.cut70, r.cut50, r.min]) {
    if (v != null && Number.isFinite(v)) return v
  }
  return null
}

function flatten(universities: AdmissionDataset[]): FlatRow[] {
  const rows: FlatRow[] = []
  for (const u of universities) {
    for (const m of u.majors) {
      rows.push({
        ...m,
        university: u.university,
        year: u.year,
        admissionType: u.admissionType,
        scoreKind: m.scoreKind ?? u.scoreKind,
        univId: u.id,
      })
    }
  }
  return rows
}

function App() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [extras, setExtras] = useState<AdmissionDataset[]>(() => loadExtraUniversities())
  const [uploadMsg, setUploadMsg] = useState('')
  const [uploading, setUploading] = useState(false)

  const liveBundle = useMemo(() => buildLiveBundle(extras), [extras])

  const allRows = useMemo(
    () => flatten(liveBundle.universities).filter((r) => r.admissionType !== '수시'),
    [liveBundle],
  )
  const [scoreInput, setScoreInput] = useState<ScoreInput>(DEFAULT_SCORE)
  const [query, setQuery] = useState('')
  const [univFilter, setUnivFilter] = useState('전체')
  const [streamFilter, setStreamFilter] = useState<'전체' | Stream>('전체')
  const [eligFilter, setEligFilter] = useState<'전체' | Eligibility>('전체')

  const derived = useMemo(() => deriveScores(scoreInput), [scoreInput])

  const universities = useMemo(() => {
    const names = Array.from(new Set(allRows.map((r) => r.university))).sort((a, b) =>
      a.localeCompare(b, 'ko'),
    )
    return ['전체', ...names]
  }, [allRows])

  async function onUploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploading(true)
    setUploadMsg('')
    try {
      const result = await parseUploadFiles(files)
      if (result.datasets.length > 0) {
        const uploadedOnly = mergeUniversities(extras, result.datasets)
        setExtras(uploadedOnly)
        saveExtraUniversities(uploadedOnly)

        const first = result.datasets[0]
        setUnivFilter(first.university)
        setEligFilter('전체')
        setQuery('')

        const withCut = result.datasets.reduce(
          (n, d) => n + d.majors.filter((m) => displayPercentile(m) != null).length,
          0,
        )
        const total = result.datasets.reduce((n, d) => n + d.majors.length, 0)
        const parts = [
          summarizeUpload(result.datasets),
          `표시가능 ${withCut}/${total}건`,
        ]
        if (withCut === 0) {
          parts.push('평균·70%·50%·최저 점수를 읽지 못했습니다. 엑셀 열 이름을 확인해 주세요.')
        }
        if (result.skipped.length) parts.push(`건너뜀: ${result.skipped.join(' / ')}`)
        if (result.errors.length) parts.push(`오류: ${result.errors.join(' / ')}`)
        setUploadMsg(parts.join(' · '))
      } else {
        const parts = ['반영된 데이터가 없습니다.']
        if (result.skipped.length) parts.push(result.skipped.join(' / '))
        if (result.errors.length) parts.push(result.errors.join(' / '))
        setUploadMsg(parts.join(' '))
      }
    } catch (e) {
      setUploadMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const rows = useMemo(() => {
    let list = allRows.filter((r) => {
      if (displayPercentile(r) == null) return false
      if (univFilter !== '전체' && r.university !== univFilter) return false
      const stream = classifyStream(r)
      if (streamFilter !== '전체' && stream !== streamFilter) return false
      if (query.trim()) {
        const q = query.trim().toLowerCase()
        const hay = `${r.university} ${r.major} ${r.campus ?? ''} ${r.track ?? ''} ${r.field ?? ''} ${stream}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })

    const enriched = list.map((r) => {
      const cut = displayPercentile(r)
      const stream = classifyStream(r)
      const judge = judgeEligibility(derived, cut, r.scoreKind)
      return { ...r, cut, stream, judge }
    })

    let filtered = enriched
    if (eligFilter !== '전체') {
      filtered = enriched.filter((r) => r.judge.status === eligFilter)
    }

    return filtered.sort((a, b) => {
      const order: Record<Eligibility, number> = {
        가능: 0,
        적정: 1,
        소신: 2,
        어려움: 3,
        확인필요: 4,
      }
      const d = order[a.judge.status] - order[b.judge.status]
      if (d !== 0) return d
      return (b.cut ?? -1) - (a.cut ?? -1)
    })
  }, [allRows, derived, query, univFilter, streamFilter, eligFilter])

  const counts = useMemo(() => {
    const base = allRows.filter((r) => {
      if (displayPercentile(r) == null) return false
      if (univFilter !== '전체' && r.university !== univFilter) return false
      if (streamFilter !== '전체' && classifyStream(r) !== streamFilter) return false
      return true
    })
    const c: Record<Eligibility, number> = {
      가능: 0,
      적정: 0,
      소신: 0,
      어려움: 0,
      확인필요: 0,
    }
    for (const r of base) {
      const cut = displayPercentile(r)
      c[judgeEligibility(derived, cut, r.scoreKind).status]++
    }
    return c
  }, [allRows, derived, univFilter, streamFilter])

  const streamCounts = useMemo(() => {
    const base = allRows.filter((r) => {
      if (displayPercentile(r) == null) return false
      if (univFilter !== '전체' && r.university !== univFilter) return false
      if (query.trim()) {
        const q = query.trim().toLowerCase()
        const hay = `${r.university} ${r.major} ${r.campus ?? ''} ${r.track ?? ''} ${r.field ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
    const c: Record<Stream, number> = {
      경상: 0,
      인문: 0,
      자연: 0,
      공학: 0,
      예체능: 0,
      기타: 0,
    }
    for (const r of base) c[classifyStream(r)]++
    return c
  }, [allRows, univFilter, query])

  async function onExportExcel() {
    if (rows.length === 0) {
      setUploadMsg('저장할 목록이 없습니다. 필터를 확인하거나 자료를 업로드해 주세요.')
      return
    }
    try {
      await exportRowsToExcel(rows)
      setUploadMsg(`엑셀 저장 완료 · ${rows.length}건`)
    } catch (e) {
      setUploadMsg(e instanceof Error ? e.message : String(e))
    }
  }

  function setStandard(key: SubjectKey, raw: string) {
    if (raw === '') {
      setScoreInput((prev) => ({
        ...prev,
        standard: { ...prev.standard, [key]: null },
      }))
      return
    }
    const n = Number(raw)
    if (!Number.isFinite(n)) return
    setScoreInput((prev) => ({
      ...prev,
      standard: { ...prev.standard, [key]: n },
    }))
  }

  function commitStandard(key: SubjectKey) {
    setScoreInput((prev) => {
      const cur = prev.standard[key]
      if (cur == null || !Number.isFinite(cur)) {
        return { ...prev, standard: { ...prev.standard, [key]: null } }
      }
      return { ...prev, standard: { ...prev.standard, [key]: clampStandard(key, cur) } }
    })
  }

  function setPercentile(key: SubjectKey, raw: string) {
    if (raw === '') {
      setScoreInput((prev) => ({
        ...prev,
        percentile: { ...prev.percentile, [key]: null },
      }))
      return
    }
    const n = Number(raw)
    if (!Number.isFinite(n)) return
    setScoreInput((prev) => ({
      ...prev,
      percentile: { ...prev.percentile, [key]: n },
    }))
  }

  function commitPercentile(key: SubjectKey) {
    setScoreInput((prev) => {
      const cur = prev.percentile[key]
      if (cur == null || !Number.isFinite(cur)) {
        return { ...prev, percentile: { ...prev.percentile, [key]: null } }
      }
      return {
        ...prev,
        percentile: { ...prev.percentile, [key]: clampPercentile(cur) },
      }
    })
  }

  function setGrade(key: SubjectKey, raw: string) {
    if (raw === '') {
      setScoreInput((prev) => ({
        ...prev,
        grade: { ...prev.grade, [key]: null },
      }))
      return
    }
    const n = Number(raw)
    if (!Number.isFinite(n)) return
    setScoreInput((prev) => ({
      ...prev,
      grade: { ...prev.grade, [key]: n },
    }))
  }

  function commitGrade(key: SubjectKey) {
    setScoreInput((prev) => {
      const cur = prev.grade[key]
      if (cur == null || !Number.isFinite(cur)) {
        return { ...prev, grade: { ...prev.grade, [key]: null } }
      }
      const clamped = Math.min(9, Math.max(1, Math.round(cur)))
      return { ...prev, grade: { ...prev.grade, [key]: clamped } }
    })
  }

  function isGradeInRange(value: number | null | undefined): boolean {
    return value != null && Number.isInteger(value) && value >= 1 && value <= 9
  }

  function gradeInputProps(key: SubjectKey, label: string) {
    const value = scoreInput.grade[key]
    const invalid = value != null && !isGradeInRange(value)
    return {
      inputMode: 'numeric' as const,
      step: 1,
      min: 1,
      max: 9,
      value: value ?? '',
      className: invalid ? 'invalid' : undefined,
      title: '등급 1~9',
      'aria-label': label,
      onChange: (e: ChangeEvent<HTMLInputElement>) => setGrade(key, e.target.value),
      onBlur: () => commitGrade(key),
    }
  }

  function standardInputProps(key: SubjectKey) {
    const kind = standardKind(key)
    const range = kind ? STANDARD_RANGE[kind] : null
    const value = scoreInput.standard[key]
    const invalid = value != null && !isStandardInRange(key, value)
    return {
      inputMode: 'numeric' as const,
      step: 1,
      min: range?.min,
      max: range?.max,
      value: value ?? '',
      className: invalid ? 'invalid' : undefined,
      title: range
        ? `모의고사 표준점수 범위 ${range.min}~${range.max} (본수능과 동일, 정수)`
        : undefined,
      onChange: (e: ChangeEvent<HTMLInputElement>) => setStandard(key, e.target.value),
      onBlur: () => commitStandard(key),
    }
  }

  function percentileInputProps(key: SubjectKey) {
    const value = scoreInput.percentile[key]
    const invalid = value != null && !isPercentileInRange(value)
    return {
      inputMode: 'decimal' as const,
      step: 0.01,
      min: PERCENTILE_RANGE.min,
      max: PERCENTILE_RANGE.max,
      value: value ?? '',
      className: invalid ? 'invalid' : undefined,
      title: `성적표 백분위 ${PERCENTILE_RANGE.min}~${PERCENTILE_RANGE.max}`,
      onChange: (e: ChangeEvent<HTMLInputElement>) => setPercentile(key, e.target.value),
      onBlur: () => commitPercentile(key),
    }
  }

  const koreanAutoGrade = isPercentileInRange(scoreInput.percentile.korean)
    ? percentileToGrade(scoreInput.percentile.korean!)
    : null
  const mathAutoGrade = isPercentileInRange(scoreInput.percentile.math)
    ? percentileToGrade(scoreInput.percentile.math!)
    : null
  const inq1AutoGrade = isPercentileInRange(scoreInput.percentile.inquiry1)
    ? percentileToGrade(scoreInput.percentile.inquiry1!)
    : null
  const inq2AutoGrade = isPercentileInRange(scoreInput.percentile.inquiry2)
    ? percentileToGrade(scoreInput.percentile.inquiry2!)
    : null

  return (
    <div className="page">
      <div className="bg-grid" aria-hidden />

      <header className="top compact">
        <div className="brand">
          <h1>2025-26 학년도 입결 분석</h1>
        </div>
        <div className="header-actions">
          <div className="upload-bar header-upload">
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.json,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              multiple
              hidden
              onChange={(e) => void onUploadFiles(e.target.files)}
            />
            <button
              type="button"
              className="upload-btn"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? '분석 중…' : '정시 자료 업로드'}
            </button>
          </div>
          <button
            type="button"
            className="export-btn"
            disabled={rows.length === 0}
            onClick={() => void onExportExcel()}
          >
            엑셀 저장
          </button>
        </div>
      </header>
      {uploadMsg && <p className="upload-msg">{uploadMsg}</p>}

      <main>
        <section className="panel score-panel">
          <div className="score-panel-head">
            <div className="score-panel-title">
              <div>
                <h2>모의고사 성적 입력</h2>
                <p>
                  국어·수학·탐구는 표준점수와 백분위, 한국사·영어는 표준점수란에 등급(1~9)을
                  입력합니다.
                  <br />
                  새 정시 입결은 <strong>정시 자료 업로드</strong>(xlsx/json)로 반영할 수 있습니다.
                  수시·정시가 한 파일에 있으면 정시 시트만 가져옵니다.
                </p>
              </div>
              <div className="converted-pill" aria-live="polite">
                <span>환산 백분위 (국30·수30·영20·탐20)</span>
                <strong>
                  {derived.convertedPercentile != null
                    ? derived.convertedPercentile.toFixed(2)
                    : '—'}
                </strong>
              </div>
            </div>
          </div>

          <div className="score-table-wrap">
            <table className="score-table">
              <thead>
                <tr>
                  <th>구분</th>
                  <th>한국사</th>
                  <th>
                    국어
                    <span className="elective-text">({scoreInput.koreanElective})</span>
                  </th>
                  <th>
                    수학
                    <span className="elective-text">({scoreInput.mathElective})</span>
                  </th>
                  <th>영어</th>
                  <th>{scoreInput.inquiry1Name}</th>
                  <th>{scoreInput.inquiry2Name}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th>표준점수</th>
                  <td>
                    <input {...gradeInputProps('history', '한국사 등급')} />
                  </td>
                  <td>
                    <input {...standardInputProps('korean')} aria-label="국어 표준점수" />
                  </td>
                  <td>
                    <input {...standardInputProps('math')} aria-label="수학 표준점수" />
                  </td>
                  <td>
                    <input {...gradeInputProps('english', '영어 등급')} />
                  </td>
                  <td>
                    <input {...standardInputProps('inquiry1')} aria-label="탐구1 표준점수" />
                  </td>
                  <td>
                    <input {...standardInputProps('inquiry2')} aria-label="탐구2 표준점수" />
                  </td>
                </tr>
                <tr>
                  <th>백분위</th>
                  <td className="muted">—</td>
                  <td>
                    <input {...percentileInputProps('korean')} aria-label="국어 백분위" />
                  </td>
                  <td>
                    <input {...percentileInputProps('math')} aria-label="수학 백분위" />
                  </td>
                  <td className="muted">—</td>
                  <td>
                    <input {...percentileInputProps('inquiry1')} aria-label="탐구1 백분위" />
                  </td>
                  <td>
                    <input {...percentileInputProps('inquiry2')} aria-label="탐구2 백분위" />
                  </td>
                </tr>
                <tr>
                  <th>등급</th>
                  <td className="num">{scoreInput.grade.history ?? '—'}</td>
                  <td className="num">{koreanAutoGrade ?? '—'}</td>
                  <td className="num">{mathAutoGrade ?? '—'}</td>
                  <td className="num">{scoreInput.grade.english ?? '—'}</td>
                  <td className="num">{inq1AutoGrade ?? '—'}</td>
                  <td className="num">{inq2AutoGrade ?? '—'}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel list-panel">
          <div className="toolbar">
            <label className="field grow">
              <span>검색</span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="대학·학과"
              />
            </label>
            <label className="field">
              <span>대학</span>
              <select value={univFilter} onChange={(e) => setUnivFilter(e.target.value)}>
                {universities.map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>계열</span>
              <select
                value={streamFilter}
                onChange={(e) => setStreamFilter(e.target.value as typeof streamFilter)}
              >
                <option value="전체">전체</option>
                {STREAMS.map((s) => (
                  <option key={s} value={s}>
                    {s} ({streamCounts[s]})
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>지원가능</span>
              <select
                value={eligFilter}
                onChange={(e) => setEligFilter(e.target.value as typeof eligFilter)}
              >
                <option value="전체">전체</option>
                <option value="가능">가능</option>
                <option value="적정">적정</option>
                <option value="소신">소신</option>
                <option value="어려움">어려움</option>
                <option value="확인필요">확인필요</option>
              </select>
            </label>
          </div>

          <div className="stream-chips">
            <button
              type="button"
              className={`stream-chip ${streamFilter === '전체' ? 'on' : ''}`}
              onClick={() => setStreamFilter('전체')}
            >
              전체
            </button>
            {STREAMS.map((s) => (
              <button
                key={s}
                type="button"
                className={`stream-chip stream-${s} ${streamFilter === s ? 'on' : ''}`}
                onClick={() => setStreamFilter(streamFilter === s ? '전체' : s)}
              >
                {s}
                <span>{streamCounts[s]}</span>
              </button>
            ))}
            <div className="band-summary inline">
              {(Object.keys(counts) as Eligibility[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`band-chip status-${k} ${eligFilter === k ? 'on' : ''}`}
                  onClick={() => setEligFilter(eligFilter === k ? '전체' : k)}
                >
                  <strong>{k}</strong>
                  <span>{counts[k]}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="table-frame">
            <div className="table-wrap">
              <table className="result-table">
              <thead>
                <tr>
                  <th>대학</th>
                  <th>군</th>
                  <th>계열</th>
                  <th>학과</th>
                  <th>캠퍼스</th>
                  <th>경쟁률</th>
                  <th>정원</th>
                  <th>등록</th>
                  <th>백분위</th>
                  <th>지원 가능여부</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="empty-row">
                      표시할 입결이 없습니다. 평균·70%·50%·최저 중 하나라도 있으면 여기에
                      나타납니다.
                    </td>
                  </tr>
                ) : (
                  rows.map((r, i) => (
                  <tr
                    key={`${r.univId}-${r.major}-${r.track}-${i}`}
                    className={`row-status-${r.judge.status}`}
                  >
                    <td>
                      <div className="major-cell">
                        <strong>{r.university}</strong>
                        <span>
                          {r.year} {r.admissionType}
                        </span>
                      </div>
                    </td>
                    <td>{r.group || '—'}</td>
                    <td>
                      <span className={`stream-tag stream-${r.stream}`}>{r.stream}</span>
                    </td>
                    <td>
                      <div className="major-cell">
                        <strong>{r.major}</strong>
                        <span>{r.track || r.field || '—'}</span>
                      </div>
                    </td>
                    <td>{r.campus || '—'}</td>
                    <td className="num">{fmt(r.competition)}</td>
                    <td className="num">{fmt(r.quotaInitial, 0)}</td>
                    <td className="num">{fmt(r.enrolled, 0)}</td>
                    <td className="num emph">{fmt(r.cut)}</td>
                    <td className="elig-cell">
                      <span className={`badge status-${r.judge.status}`}>{r.judge.status}</span>
                    </td>
                  </tr>
                  ))
                )}
              </tbody>
            </table>
            </div>
          </div>
        </section>
      </main>

      <footer className="foot" aria-hidden />
    </div>
  )
}

export default App
