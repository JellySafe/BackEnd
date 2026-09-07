import { RiskLevel } from '@shared/kernel/risk-level';
import { parseKstDateKey } from '@shared/kernel/kst-date';
import {
  BeachDayFacts,
  NO_DATA_LABEL,
  summarizePublicDailyReport,
} from './public-daily-report';

/**
 * 공개 일간 리포트 요약 (이슈 #56).
 *
 * 이 화면은 시민이 "오늘 바다에 들어가도 되나" 를 판단하는 자리다. 그래서 여기서 지키는 것은
 * 숫자의 정확성보다 **한쪽으로 틀리지 않는 것**이다 — 모르는 것을 안전하다고 하거나, 위험했던
 * 사실을 반올림으로 지우지 않는 것.
 */
describe('공개 일간 리포트 요약', () => {
  const DATE = parseKstDateKey('2026-09-06');
  const NOW = new Date('2026-09-06T07:20:11.482Z');

  function beach(overrides: Partial<BeachDayFacts> & { beachId: number }): BeachDayFacts {
    return {
      name: `해변${overrides.beachId}`,
      region: '제주시',
      firstRiskLevel: null,
      lastRiskLevel: null,
      maxRiskLevel: null,
      reportCount: 0,
      toxicCount: 0,
      stingCount: 0,
      publicComment: null,
      ...overrides,
    };
  }

  /** 하루 내내 같은 단계였던 해변. */
  function steady(beachId: number, level: RiskLevel, name?: string): BeachDayFacts {
    return beach({
      beachId,
      name: name ?? `해변${beachId}`,
      firstRiskLevel: level,
      lastRiskLevel: level,
      maxRiskLevel: level,
    });
  }

  describe('전체 최고 등급', () => {
    it('해변들 중 가장 높은 단계를 고른다', () => {
      const report = summarizePublicDailyReport(
        DATE,
        [steady(1, 'safe'), steady(2, 'danger'), steady(3, 'caution')],
        NOW,
      );

      expect(report.maxRiskLevel).toBe('danger');
      expect(report.maxRiskLabel).toBe('위험');
    });

    it("산출 이력이 하나도 없으면 null 이고 '정보 없음' 이다", () => {
      // 여기서 'safe' 나 '낮음' 을 돌려주면 **아무것도 모르는 날이 안전한 날로 보인다.**
      const report = summarizePublicDailyReport(DATE, [beach({ beachId: 1 })], NOW);

      expect(report.maxRiskLevel).toBeNull();
      expect(report.maxRiskLabel).toBe(NO_DATA_LABEL);
    });

    it('해변이 하나도 없어도 터지지 않는다', () => {
      const report = summarizePublicDailyReport(DATE, [], NOW);

      expect(report.maxRiskLevel).toBeNull();
      expect(report.beachCount).toBe(0);
      expect(report.levelCounts.unknown).toBe(0);
    });

    it("safe 를 '안전' 이라고 쓰지 않는다 — 보장으로 읽히는 말은 쓰지 않는다", () => {
      const report = summarizePublicDailyReport(DATE, [steady(1, 'safe')], NOW);
      expect(report.maxRiskLabel).toBe('낮음');
    });
  });

  describe('등급별 해변 수', () => {
    it('각 해변의 그날 최고 등급으로 센다', () => {
      const report = summarizePublicDailyReport(
        DATE,
        [steady(1, 'safe'), steady(2, 'safe'), steady(3, 'danger')],
        NOW,
      );

      expect(report.levelCounts).toEqual({
        safe: 2,
        caution: 0,
        danger: 1,
        severe: 0,
        unknown: 0,
      });
    });

    it('낮에 위험했다가 내려간 해변도 위험 칸에 센다 — 그날 위험했다는 사실이 사라지면 안 된다', () => {
      const dropped = beach({
        beachId: 1,
        firstRiskLevel: 'danger',
        lastRiskLevel: 'safe',
        maxRiskLevel: 'danger',
      });

      const report = summarizePublicDailyReport(DATE, [dropped], NOW);

      expect(report.levelCounts.danger).toBe(1);
      expect(report.levelCounts.safe).toBe(0);
    });

    it('산출 이력이 없는 해변은 unknown 으로 센다 — safe 에 합치지 않는다', () => {
      const report = summarizePublicDailyReport(
        DATE,
        [steady(1, 'safe'), beach({ beachId: 2 }), beach({ beachId: 3 })],
        NOW,
      );

      expect(report.levelCounts.safe).toBe(1);
      expect(report.levelCounts.unknown).toBe(2);
    });

    it('0 인 등급도 키를 남긴다 — 없는 것과 못 받은 것을 화면이 구분해야 한다', () => {
      const report = summarizePublicDailyReport(DATE, [steady(1, 'caution')], NOW);

      expect(Object.keys(report.levelCounts).sort()).toEqual(
        ['caution', 'danger', 'safe', 'severe', 'unknown'].sort(),
      );
      expect(report.levelCounts.severe).toBe(0);
    });

    it('등급별 합계가 해변 수와 맞는다 — 어디로도 새지 않는다', () => {
      const facts = [steady(1, 'safe'), steady(2, 'severe'), beach({ beachId: 3 })];
      const report = summarizePublicDailyReport(DATE, facts, NOW);

      const sum = Object.values(report.levelCounts).reduce((a, b) => a + b, 0);
      expect(sum).toBe(report.beachCount);
      expect(sum).toBe(3);
    });
  });

  describe('등급이 오른 해변', () => {
    it('처음보다 마지막이 높으면 잡는다', () => {
      const raised = beach({
        beachId: 1,
        name: '함덕해수욕장',
        firstRiskLevel: 'caution',
        lastRiskLevel: 'danger',
        maxRiskLevel: 'danger',
      });

      const report = summarizePublicDailyReport(DATE, [raised], NOW);

      expect(report.raisedBeaches).toHaveLength(1);
      expect(report.raisedBeaches[0]).toMatchObject({
        beachId: 1,
        name: '함덕해수욕장',
        from: 'caution',
        to: 'danger',
        fromLabel: '주의',
        toLabel: '위험',
      });
    });

    it('내려간 해변은 잡지 않는다 — "오른 곳" 목록이지 "변한 곳" 목록이 아니다', () => {
      const dropped = beach({
        beachId: 1,
        firstRiskLevel: 'danger',
        lastRiskLevel: 'safe',
        maxRiskLevel: 'danger',
      });

      expect(summarizePublicDailyReport(DATE, [dropped], NOW).raisedBeaches).toEqual([]);
    });

    it('그대로인 해변은 잡지 않는다', () => {
      expect(summarizePublicDailyReport(DATE, [steady(1, 'danger')], NOW).raisedBeaches).toEqual([]);
    });

    it('산출이 한쪽만 있으면 변화로 보지 않는다', () => {
      const partial = beach({
        beachId: 1,
        firstRiskLevel: null,
        lastRiskLevel: 'danger',
        maxRiskLevel: 'danger',
      });

      expect(summarizePublicDailyReport(DATE, [partial], NOW).raisedBeaches).toEqual([]);
    });

    it('높은 등급부터 보여 준다 — 목록이 길면 아래쪽은 읽히지 않는다', () => {
      const facts = [
        beach({ beachId: 1, firstRiskLevel: 'safe', lastRiskLevel: 'caution', maxRiskLevel: 'caution' }),
        beach({ beachId: 2, firstRiskLevel: 'safe', lastRiskLevel: 'severe', maxRiskLevel: 'severe' }),
        beach({ beachId: 3, firstRiskLevel: 'safe', lastRiskLevel: 'danger', maxRiskLevel: 'danger' }),
      ];

      const report = summarizePublicDailyReport(DATE, facts, NOW);

      expect(report.raisedBeaches.map((b) => b.to)).toEqual(['severe', 'danger', 'caution']);
    });
  });

  describe('독성 의심 제보가 있었던 해변', () => {
    it('건수가 1 이상인 해변만 담는다', () => {
      const facts = [
        beach({ beachId: 1, toxicCount: 2, reportCount: 3 }),
        beach({ beachId: 2, toxicCount: 0, reportCount: 5 }),
      ];

      const report = summarizePublicDailyReport(DATE, facts, NOW);

      expect(report.toxicBeaches).toHaveLength(1);
      expect(report.toxicBeaches[0]).toMatchObject({ beachId: 1, toxicCount: 2 });
    });

    it('건수가 많은 곳부터 보여 준다', () => {
      const facts = [
        beach({ beachId: 1, toxicCount: 1 }),
        beach({ beachId: 2, toxicCount: 5 }),
        beach({ beachId: 3, toxicCount: 3 }),
      ];

      expect(
        summarizePublicDailyReport(DATE, facts, NOW).toxicBeaches.map((b) => b.toxicCount),
      ).toEqual([5, 3, 1]);
    });
  });

  describe('운영기관 코멘트', () => {
    it('공개 코멘트가 있는 해변만 담는다', () => {
      const facts = [
        beach({ beachId: 1, name: '협재해수욕장', publicComment: '오후 입수 통제 중입니다.' }),
        beach({ beachId: 2 }),
      ];

      const report = summarizePublicDailyReport(DATE, facts, NOW);

      expect(report.comments).toEqual([
        { beachId: 1, name: '협재해수욕장', comment: '오후 입수 통제 중입니다.' },
      ]);
    });

    it('공백만 있는 코멘트는 담지 않는다 — 빈 말풍선이 뜨면 안 된다', () => {
      const facts = [beach({ beachId: 1, publicComment: '   ' })];
      expect(summarizePublicDailyReport(DATE, facts, NOW).comments).toEqual([]);
    });

    it('앞뒤 공백을 다듬는다', () => {
      const facts = [beach({ beachId: 1, publicComment: '  안내  ' })];
      expect(summarizePublicDailyReport(DATE, facts, NOW).comments[0].comment).toBe('안내');
    });

    it('코멘트가 없으면 빈 배열이다 — null 이 아니다', () => {
      expect(summarizePublicDailyReport(DATE, [beach({ beachId: 1 })], NOW).comments).toEqual([]);
    });
  });

  describe('총계와 메타', () => {
    it('제보 수를 해변 전체로 더한다', () => {
      const facts = [
        beach({ beachId: 1, reportCount: 3, toxicCount: 1, stingCount: 0 }),
        beach({ beachId: 2, reportCount: 4, toxicCount: 2, stingCount: 1 }),
      ];

      expect(summarizePublicDailyReport(DATE, facts, NOW).totals).toEqual({
        reportCount: 7,
        toxicCount: 3,
        stingCount: 1,
      });
    });

    it('기준 일자를 KST 달력 날짜로 돌려준다', () => {
      expect(summarizePublicDailyReport(DATE, [], NOW).reportDate).toBe('2026-09-06');
    });

    it('요약을 만든 시각을 담는다 — 캐시된 값인지 화면이 알 수 있어야 한다', () => {
      expect(summarizePublicDailyReport(DATE, [], NOW).generatedAt).toBe(NOW.toISOString());
    });

    it('대상 해변 수를 담는다', () => {
      const facts = [steady(1, 'safe'), steady(2, 'safe')];
      expect(summarizePublicDailyReport(DATE, facts, NOW).beachCount).toBe(2);
    });
  });
});
