import { RiskLevel } from '@shared/kernel/risk-level';

/**
 * 위험 단계별 일반 사용자 안전 안내 문구 (USR-002).
 * AI-001: '독성 확정' 등 단정 표현 금지. 현장 안전요원 안내 우선을 고지한다.
 */
export function buildSafetyGuide(level: RiskLevel): string {
  switch (level) {
    case 'severe':
      return '심각 단계입니다. 입수를 삼가고 해수욕장 통제 안내와 현장 안전요원의 지시를 따라주세요.';
    case 'danger':
      return '위험 단계입니다. 입수를 자제하고 방문 전 현장 안전 안내를 반드시 확인해주세요.';
    case 'caution':
      return '주의 단계입니다. 입수 시 해파리 출현에 유의하고 현장 안전 안내를 확인해주세요.';
    case 'safe':
    default:
      return '현재 특이사항은 없습니다. 그래도 현장 안전 안내를 확인하고 물놀이하세요.';
  }
}
