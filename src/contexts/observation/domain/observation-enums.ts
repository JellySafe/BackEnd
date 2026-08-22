/**
 * observation 컨텍스트 값 계약 (소문자). DB VARCHAR+CHECK 와 1:1 대응한다.
 * (SYS-001 데이터 수집 / SYS-002 관측소-해수욕장 매핑)
 */

// 데이터 소스 유형 (SHEET3 데이터 소스: 해파리 출현/속보, 해양, 기상, 해변 위치)
export const SOURCE_TYPES = ['jellyfish', 'marine', 'weather', 'beach'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

// 관측소 유형 (해양/기상)
export const STATION_TYPES = ['marine', 'weather'] as const;
export type StationType = (typeof STATION_TYPES)[number];

// 관측치 품질 플래그 (결측/이상치 처리, RISK-005)
export const QUALITY_FLAGS = ['normal', 'missing', 'outlier'] as const;
export type QualityFlag = (typeof QUALITY_FLAGS)[number];

// 해파리 출현 밀도 (03_Data_AI)
export const DENSITY_LEVELS = ['low', 'medium', 'high'] as const;
export type DensityLevel = (typeof DENSITY_LEVELS)[number];

// 인근 해역 속보 경보 단계 (NEARBY_ALERT)
export const ALERT_LEVELS = ['none', 'attention', 'caution', 'warning'] as const;
export type AlertLevel = (typeof ALERT_LEVELS)[number];

// 수집 배치 결과 상태 (data_sources.last_sync_status)
export const SYNC_STATUSES = ['success', 'partial', 'failed'] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];

export function isSourceType(v: unknown): v is SourceType {
  return typeof v === 'string' && (SOURCE_TYPES as readonly string[]).includes(v);
}
export function isStationType(v: unknown): v is StationType {
  return typeof v === 'string' && (STATION_TYPES as readonly string[]).includes(v);
}

/**
 * 밀도 값 계약 검사.
 *
 * 이 컨텍스트 밖(groundtruth 의 현장 관측)에서도 같은 값 집합을 쓴다. 목록을 따로 적으면
 * 어긋나므로 판별도 여기 하나만 둔다 — 밀도는 v3 위험도의 축이라 어긋나면 점수가 통째로
 * 빗나간다(risk-factors.ts).
 */
export function isDensityLevel(v: unknown): v is DensityLevel {
  return typeof v === 'string' && (DENSITY_LEVELS as readonly string[]).includes(v);
}
