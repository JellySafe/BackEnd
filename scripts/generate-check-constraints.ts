/**
 * 값 계약 CHECK 제약 DDL 생성기.
 *
 * 실행: npm run sql:check-constraints
 * 산출: prisma/sql/003-check-constraints.sql
 *
 * 도메인 enum 을 고쳤으면 이걸 다시 돌린다. 안 돌리면 CI 가 잡는다
 * (prisma/value-contracts.spec.ts 가 커밋된 파일과 표를 대조한다).
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildCheckConstraintSql } from '../prisma/value-contracts';

const OUTPUT = resolve(__dirname, '../prisma/sql/003-check-constraints.sql');

writeFileSync(OUTPUT, buildCheckConstraintSql(), 'utf8');
console.log(`[generate-check-constraints] 생성 완료: ${OUTPUT}`);
