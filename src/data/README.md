# 데이터 추출

## 원본
`src/data/result/` — 대학별 입시결과 파일 (xlsx/pdf)

## 실행
```bash
npm run extract
# 또는
python scripts/extract_admissions.py
```

## 산출물
- `src/data/processed/admissions.json` — 앱이 읽는 정규화 데이터
- `src/data/processed/extract_report.json` — 파일별 추출 성공/실패 리포트

## 공통 스키마 (모집단위)
`major`, `track`, `campus`, `group`, `field`, `quotaInitial`, `applicants`, `competition`, `enrolled`, `cut50/70/80/90/100`, `avg/max/min`, `scoreKind`

## 한계
- PDF 중 표 인식 실패 파일은 `extract_report.json`에 `empty`로 남음
- 대학마다 점수 단위(등급/백분위/환산점)가 다르므로 진단 시 단위를 맞춰 입력
