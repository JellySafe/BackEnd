// ⚠️ 이 import 가 있어야 `.env` 가 읽힌다.
//
// prisma.config.ts 를 두는 순간 Prisma 는 **환경변수 자동 로딩을 멈춘다**
// ("Prisma config detected, skipping environment variable loading"). package.json#prisma
// 시절에는 알아서 읽어 줬으므로, 이걸 빼면 `npx prisma studio` · `db pull` 같은 로컬 명령이
// DATABASE_URL 을 못 찾는다. CI 는 환경변수로 주니 티가 안 나고 **개발자만 막힌다.**
import 'dotenv/config';
import type { PrismaConfig } from 'prisma';

/**
 * Prisma 설정.
 *
 * ── 왜 package.json 에서 옮겼나 ─────────────────────────────────────────────────────
 * `package.json#prisma` 는 **Prisma 7 에서 제거된다.** 시드·생성을 돌릴 때마다 경고가
 * 떴는데, 미루면 Prisma 7 을 올릴 때 "시드가 안 돈다" 로 한꺼번에 터진다. 지금 옮겨 둔다.
 *
 * 시드는 `ts-node -r tsconfig-paths/register` 로 돈다. 시드가 `@shared`/`@contexts` 경로
 * 별칭을 쓰기 때문이다(prisma/seed.ts → 도메인 값 계약을 그대로 가져다 쓴다).
 * 별칭 등록을 빼면 시드가 모듈을 찾지 못한다.
 */
export default {
  schema: 'prisma/schema.prisma',
  migrations: {
    seed: 'ts-node -r tsconfig-paths/register prisma/seed.ts',
  },
} satisfies PrismaConfig;
