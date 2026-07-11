import { User as PrismaUser, Prisma } from '@prisma/client';
import { toId } from '@shared/kernel/id';
import { User } from '../../../domain/user';
import { UserRole } from '../../../domain/user-enums';

/** Prisma row → 도메인 애그리거트 */
export function toDomain(row: PrismaUser): User {
  return User.reconstitute({
    id: toId(row.id),
    role: row.role as UserRole,
    email: row.email,
    passwordHash: row.passwordHash,
    name: row.name,
    organization: row.organization,
    managedRegion: row.managedRegion,
    isActive: row.isActive,
    lastLoginAt: row.lastLoginAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

/** 도메인 애그리거트 → Prisma create 데이터 (id/타임스탬프 제외) */
export function toPersistence(user: User): Prisma.UserUncheckedCreateInput {
  const s = user.snapshot();
  return {
    role: s.role,
    email: s.email,
    passwordHash: s.passwordHash,
    name: s.name,
    organization: s.organization,
    managedRegion: s.managedRegion,
    isActive: s.isActive,
    lastLoginAt: s.lastLoginAt,
  };
}
