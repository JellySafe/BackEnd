import { AiResult, ReportStatus } from './report-enums';

/**
 * 제보 결과 안내 문구 생성 (USR-005, GUIDE-001).
 * AI-001: '독성 확정' 표현 금지. '의심' 까지만. 관리자 확인 전 참고 정보임을 고지.
 */
export function buildGuideMessage(status: ReportStatus, aiResult: AiResult | null): string {
  if (status === 'received' || status === 'ai_processing') {
    return 'AI 판별 중입니다. 잠시 후 결과를 확인해주세요.';
  }
  if (status === 'rejected') {
    return '검토 결과 위험도 반영 대상이 아닙니다. 현장 안전 안내를 우선 확인해주세요.';
  }

  switch (aiResult) {
    case 'toxic_suspected':
      return '독성 해파리로 의심됩니다. 정확한 확인 전까지 입수를 주의하고 현장 안전요원의 안내를 따라주세요.';
    case 'normal':
      return '일반 해파리로 보입니다. 현장 안전 안내를 확인하고 주의해주세요.';
    case 'unknown':
    default:
      return '사진만으로 판별이 어렵습니다. 관리자 확인 후 안내되며, 현장 안전 안내를 우선 확인해주세요.';
  }
}
