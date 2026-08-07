export type Stream = '경상' | '인문' | '자연' | '공학' | '예체능' | '기타'

export const STREAMS: Stream[] = ['경상', '인문', '자연', '공학', '예체능', '기타']

function norm(s: string): string {
  return s.replace(/\s+/g, '').toLowerCase()
}

/** 단과대·학과명·전형명으로 계열 추정 */
export function classifyStream(parts: {
  major?: string | null
  field?: string | null
  track?: string | null
}): Stream {
  const text = norm([parts.field, parts.major, parts.track].filter(Boolean).join(' '))
  if (!text) return '기타'

  // 예체능 우선 (예체능 공학/디자인이 공학에 잡히지 않게)
  if (
    /예체능|예능|체능|예술|미술|음악|무용|체육|스포츠|디자인|연기|연극|영화|무용|조형|패션|만화|애니/.test(
      text,
    )
  ) {
    // 산업디자인공학 등은 공학 쪽이 맞을 수 있으나 UI 단순화를 위해 예체능 유지
    if (!/디자인공학|스포츠과학부.*자연/.test(text)) return '예체능'
  }

  if (
    /경상|상경|경영|경제|무역|회계|금융|세무|마케팅|물류|관광경영|호텔경영|벤처|창업|부동산/.test(
      text,
    )
  ) {
    return '경상'
  }

  if (
    /공학|공과|기계|전자|전기|화학공|토목|건축공|산업공|신소재|항공|자동차|로봇|반도체공|컴퓨터공|소프트웨어|정보통신|환경공|에너지공|조선|원자력|도시공|고분자/.test(
      text,
    ) ||
    (/ai|it융합|정보대학/.test(text) && /공|컴퓨터|소프트|데이터|인공지능|반도체/.test(text))
  ) {
    return '공학'
  }

  if (
    /자연|이학|수학|물리|화학|생물|생명|지구|천문|통계|환경과|수산|해양|농|산림|간호|의예|치의|한의|약학|수의|보건|임상|방사선|치위생|물리치료|작업치료|식품영양|바이오/.test(
      text,
    )
  ) {
    return '자연'
  }

  if (
    /인문|사회|문과|국어|국문|영문|중문|일문|불어|독문|노어|스페인|철학|사학|史|문헌|심리|사회복|행정|정치|언론|미디어|신문|법학|경찰|소방|아동|유아|교육|사범|역사|문화인류|국제학|공공인재/.test(
      text,
    )
  ) {
    return '인문'
  }

  // 단과대 힌트
  if (/공대|공과대학|공학대학/.test(text)) return '공학'
  if (/자연대|자연과학|이과대학/.test(text)) return '자연'
  if (/경상|경영대|상경/.test(text)) return '경상'
  if (/인문대|사회대|문과/.test(text)) return '인문'
  if (/예대|체대|예술대/.test(text)) return '예체능'

  return '기타'
}
