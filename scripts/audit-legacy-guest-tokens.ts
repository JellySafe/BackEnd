/**
 * 레거시 게스트 토큰 감사/정리 스크립트.
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────────────────
 * 게스트 신원이 "클라이언트가 지어낸 임의 문자열"에서 "서버가 서명해 발급한 토큰"으로 바뀌었다
 * (shared/auth/guest-token.ts). 그래서 예전 방식으로 만들어진 행들은 **주인이 API 로 다시
 * 접근할 수 없는 상태**가 된다 — 앱이 새 토큰을 발급받는 순간 그 사람은 새 사람이 된다.
 *
 * 그 행들을 그냥 두면 두 가지가 남는다:
 *   1) 아무도 열어볼 수 없는 관심 해변·알림이 계속 쌓인다(알림 확산이 매 주기 대상에 넣는다).
 *   2) 푸시 구독은 **여전히 살아 있다.** 발송은 토큰을 검증하지 않으므로, 기존 사용자는
 *      앱을 다시 열기 전까지 알림을 계속 받는다. 이건 의도한 동작이다 — 안전 알림을
 *      마이그레이션을 이유로 끊지 않는다.
 *
 * 그래서 **기본은 조회만 한다.** 무엇이 얼마나 있는지 먼저 보고, 지울지는 사람이 정한다.
 *
 * ── 사용법 ───────────────────────────────────────────────────────────────────────────
 *   조회:  npx ts-node -r tsconfig-paths/register scripts/audit-legacy-guest-tokens.ts
 *   정리:  npx ts-node -r tsconfig-paths/register scripts/audit-legacy-guest-tokens.ts --delete
 *
 * `--delete` 는 관심 해변과 알림만 지우고 **푸시 구독은 건드리지 않는다**(위 2번 이유).
 * 구독까지 정리하려면 `--delete-push` 를 함께 준다.
 */
import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import { verifyGuestToken } from '../src/shared/auth/guest-token';

const prisma = new PrismaClient();

/** 서버가 발급한 형식·서명인지. 아니면 레거시(또는 위조) 토큰이다. */
function isLegacy(token: string | null, secret: string): boolean {
  if (token === null || token.trim() === '') return false; // 로그인 사용자 행(user_id 로 식별)
  return !verifyGuestToken(token, secret);
}

async function main(): Promise<void> {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET 이 필요하다. 운영 DB 를 볼 때는 그 환경의 값을 그대로 써야 한다.');
  }

  const shouldDelete = process.argv.includes('--delete');
  const shouldDeletePush = process.argv.includes('--delete-push');

  const [favorites, notifications, pushConsents] = await Promise.all([
    prisma.favoriteBeach.findMany({ where: { userToken: { not: null } }, select: { id: true, userToken: true } }),
    prisma.notification.findMany({ where: { targetUserToken: { not: null } }, select: { id: true, targetUserToken: true } }),
    prisma.notificationConsent.findMany({ where: { userToken: { not: null } }, select: { id: true, userToken: true } }),
  ]);

  const legacyFavorites = favorites.filter((r) => isLegacy(r.userToken, secret));
  const legacyNotifications = notifications.filter((r) => isLegacy(r.targetUserToken, secret));
  const legacyPush = pushConsents.filter((r) => isLegacy(r.userToken, secret));

  const distinctTokens = new Set(
    [
      ...legacyFavorites.map((r) => r.userToken),
      ...legacyNotifications.map((r) => r.targetUserToken),
      ...legacyPush.map((r) => r.userToken),
    ].filter((t): t is string => t !== null),
  );

  console.log('── 레거시 게스트 토큰 감사 ──────────────────────────────');
  console.log(`관심 해변    : ${legacyFavorites.length} / ${favorites.length} 행`);
  console.log(`알림         : ${legacyNotifications.length} / ${notifications.length} 행`);
  console.log(`푸시 구독    : ${legacyPush.length} / ${pushConsents.length} 행`);
  console.log(`고유 토큰 수 : ${distinctTokens.size} (= 영향받는 기기 수의 근사)`);

  if (!shouldDelete) {
    console.log('');
    console.log('조회만 했다. 지우려면 --delete 를 붙인다(푸시 구독까지면 --delete-push 도).');
    console.log('⚠️ 푸시 구독은 지우지 않는 편을 권한다 — 기존 사용자가 앱을 다시 열기 전까지');
    console.log('   위험 알림을 계속 받는 유일한 경로다.');
    return;
  }

  const removedFavorites = await prisma.favoriteBeach.deleteMany({
    where: { id: { in: legacyFavorites.map((r) => r.id) } },
  });
  const removedNotifications = await prisma.notification.deleteMany({
    where: { id: { in: legacyNotifications.map((r) => r.id) } },
  });
  console.log('');
  console.log(`관심 해변 ${removedFavorites.count}행, 알림 ${removedNotifications.count}행 삭제`);

  if (shouldDeletePush) {
    const removedPush = await prisma.notificationConsent.deleteMany({
      where: { id: { in: legacyPush.map((r) => r.id) } },
    });
    console.log(`푸시 구독 ${removedPush.count}행 삭제 — 해당 기기는 이제 알림을 받지 않는다`);
  } else {
    console.log('푸시 구독은 그대로 뒀다(기존 사용자의 알림 수신 유지).');
  }
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
