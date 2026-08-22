import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CONTRACTS, buildCheckConstraintSql, constraintName } from './value-contracts';

/**
 * 여기서 지키려는 것은 **두 곳에 적힌 같은 목록이 어긋나지 않는 것**이다.
 *
 * 도메인은 소문자 union 으로, DB 는 CHECK 제약으로 같은 값 집합을 표현한다. 둘이 어긋나면
 * 증상은 "저장이 조용히 안 된다"(#22) 처럼 코드에서 아주 멀리 떨어진 곳에서 나타난다.
 * 그래서 목록을 손으로 두 번 적지 않고, DDL 을 도메인 enum 에서 생성한 뒤 그 결과가
 * 커밋된 파일과 같은지 여기서 확인한다.
 */
describe('값 계약 ↔ CHECK 제약', () => {
  const SQL_PATH = resolve(__dirname, 'sql/999-check-constraints.sql');

  describe('표 자체의 무결성', () => {
    it('제약 이름이 서로 겹치지 않는다 — MySQL 은 스키마 안에서 이름이 유일해야 한다', () => {
      const names = CONTRACTS.map(constraintName);
      expect(new Set(names).size).toBe(names.length);
    });

    it('(테이블, 컬럼) 조합이 중복되지 않는다', () => {
      const keys = CONTRACTS.map((c) => `${c.table}.${c.column}`);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it('값이 비어 있는 계약이 없다 — 빈 IN () 은 모든 행을 막는다', () => {
      for (const c of CONTRACTS) {
        expect(c.values.length).toBeGreaterThan(0);
      }
    });

    it('한 계약 안에서 값이 중복되지 않는다', () => {
      for (const c of CONTRACTS) {
        expect(new Set(c.values).size).toBe(c.values.length);
      }
    });

    it('값은 전부 소문자 계약이다 — DB 는 utf8mb4_bin 이라 대소문자가 다르면 다른 값이다', () => {
      for (const c of CONTRACTS) {
        for (const v of c.values) {
          // 위험도 지평(6h/24h/72h)처럼 숫자가 섞인 값도 있으므로 소문자 여부만 본다.
          expect(v).toBe(v.toLowerCase());
        }
      }
    });

    it('제약 이름이 MySQL 식별자 상한(64자) 안에 들어온다', () => {
      for (const c of CONTRACTS) {
        expect(constraintName(c).length).toBeLessThanOrEqual(64);
      }
    });
  });

  describe('커밋된 DDL 과의 일치', () => {
    it('생성 결과가 prisma/sql/999-check-constraints.sql 과 같다', () => {
      const committed = readFileSync(SQL_PATH, 'utf8').replace(/\r\n/g, '\n');
      const generated = buildCheckConstraintSql();

      // 다르면 도메인 enum 을 고치고 생성기를 안 돌린 것이다.
      expect(committed).toBe(generated);
    });

    it('모든 계약이 DDL 에 들어 있다', () => {
      const sql = buildCheckConstraintSql();
      for (const c of CONTRACTS) {
        expect(sql).toContain(`ALTER TABLE ${c.table}`);
        expect(sql).toContain(constraintName(c));
      }
    });
  });

  describe('생성된 SQL 의 형태', () => {
    it('값을 따옴표로 감싼다', () => {
      const sql = buildCheckConstraintSql();
      expect(sql).toContain("CHECK (role IN ('public', 'operator', 'admin'))");
    });

    it('위험 단계 계약이 네 단계 전부를 담는다 — 하나라도 빠지면 그 단계의 저장이 막힌다', () => {
      const sql = buildCheckConstraintSql();
      expect(sql).toContain(
        "ADD CONSTRAINT ck_risk_scores_risk_level CHECK (risk_level IN ('safe', 'caution', 'danger', 'severe'));",
      );
    });

    it('예측 지평 계약이 6h 를 포함한다 — 2차 확장에서 쓰는 값이라 빠뜨리기 쉽다', () => {
      const sql = buildCheckConstraintSql();
      expect(sql).toContain("CHECK (horizon IN ('now', '6h', '24h', '72h'))");
    });
  });
});
