import { Injectable } from '@nestjs/common';
import { PrismaService } from '@shared/persistence/prisma/prisma.service';
import { Id } from '@shared/kernel/id';
import { User } from '../../../domain/user';
import { UserRepositoryPort } from '../../../application/port/out/user-repository.port';
import { toDomain, toPersistence } from './user.mapper';

/**
 * 사용자 영속성 어댑터 (Prisma). 쓰기·단순조회·로그인 시각 갱신 담당.
 */
@Injectable()
export class UserPrismaRepository implements UserRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async save(user: User): Promise<User> {
    const row = await this.prisma.user.create({ data: toPersistence(user) });
    return toDomain(row);
  }

  async findByEmail(email: string): Promise<User | null> {
    const row = await this.prisma.user.findUnique({ where: { email } });
    return row ? toDomain(row) : null;
  }

  async findById(id: Id): Promise<User | null> {
    const row = await this.prisma.user.findUnique({ where: { id: BigInt(id) } });
    return row ? toDomain(row) : null;
  }

  async updateLastLogin(id: Id, at: Date): Promise<void> {
    await this.prisma.user.update({
      where: { id: BigInt(id) },
      data: { lastLoginAt: at },
    });
  }
}
