/**
 * 엔터티 식별자 공용 타입.
 * DB 는 BIGINT, Prisma 는 bigint, Kysely/mysql2 는 number 로 다룬다.
 * 도메인은 number 로 통일하고, 영속성 어댑터의 매퍼가 경계에서 변환한다.
 */
export type Id = number;

/** Prisma 의 bigint(또는 number) 를 도메인 Id(number)로. */
export function toId(value: bigint | number): Id {
  return typeof value === 'bigint' ? Number(value) : value;
}

/** 도메인 Id(number) 를 Prisma 가 요구하는 bigint 로. */
export function toBigInt(value: Id | bigint): bigint {
  return typeof value === 'number' ? BigInt(value) : value;
}
