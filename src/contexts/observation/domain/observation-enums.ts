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
