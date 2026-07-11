import { Injectable } from '@nestjs/common';
import { KyselyService } from '@shared/persistence/kysely/kysely.service';
import { Page, PageRequest, offsetOf, toPage } from '@shared/kernel/pagination';
import { UserRole } from '../../../domain/user-enums';
import {
  UserListFilter,
  UserListItem,
  UserQueryPort,
} from '../../../application/port/out/user-query.port';

/**
 * 사용자 목록 조회 어댑터 (Kysely). role/isActive 필터 + 페이지네이션.
 * 비밀번호 해시는 선택하지 않는다.
 */
@Injectable()
export class UserKyselyQuery implements UserQueryPort {
  constructor(private readonly db: KyselyService) {}

  async list(filter: UserListFilter, page: PageRequest): Promise<Page<UserListItem>> {
    let base = this.db.selectFrom('users as u');

    if (filter.role) base = base.where('u.role', '=', filter.role);
    if (filter.isActive !== undefined) {
      base = base.where('u.is_active', '=', filter.isActive ? 1 : 0);
    }

    const countRow = await base
      .select((eb) => eb.fn.countAll<number>().as('cnt'))
      .executeTakeFirst();
    const total = Number(countRow?.cnt ?? 0);

    const rows = await base
      .select([
        'u.id as userId',
        'u.email as email',
        'u.name as name',
        'u.role as role',
        'u.organization as organization',
        'u.managed_region as managedRegion',
        'u.is_active as isActive',
        'u.last_login_at as lastLoginAt',
        'u.created_at as createdAt',
      ])
      .orderBy('u.created_at', 'desc')
      .limit(page.size)
      .offset(offsetOf(page))
      .execute();

    const items: UserListItem[] = rows.map((row) => ({
      userId: Number(row.userId),
      email: row.email,
      name: row.name,
      role: row.role as UserRole,
      organization: row.organization ?? null,
      managedRegion: row.managedRegion ?? null,
      isActive: Number(row.isActive) === 1,
      lastLoginAt: row.lastLoginAt === null ? null : new Date(row.lastLoginAt),
      createdAt: new Date(row.createdAt),
    }));

    return toPage(items, total, page);
  }
}
