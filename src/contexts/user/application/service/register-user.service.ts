import { Inject, Injectable } from '@nestjs/common';
import { ConflictError } from '@shared/kernel/domain-error';
import { User } from '../../domain/user';
import {
  RegisterUserCommand,
  RegisterUserResult,
  RegisterUserUseCase,
} from '../port/in/user-use-cases';
import { UserRepositoryPort, USER_REPOSITORY } from '../port/out/user-repository.port';

/**
 * AUTH-001 관리자/운영자 계정 등록.
 * 이메일 중복은 ConflictError, 비밀번호 해시/role 검증은 User 애그리거트가 담당한다.
 */
@Injectable()
export class RegisterUserService implements RegisterUserUseCase {
  constructor(@Inject(USER_REPOSITORY) private readonly repository: UserRepositoryPort) {}

  async register(command: RegisterUserCommand): Promise<RegisterUserResult> {
    const email = command.email.trim().toLowerCase();
    const existing = await this.repository.findByEmail(email);
    if (existing) {
      throw new ConflictError('USER_EMAIL_DUPLICATE', '이미 등록된 이메일입니다.', { email });
    }

    const user = User.register({
      email,
      password: command.password,
      name: command.name,
      role: command.role,
      organization: command.organization ?? null,
      managedRegion: command.managedRegion ?? null,
    });

    const saved = await this.repository.save(user);
    return { userId: saved.id!, email: saved.email, role: saved.role };
  }
}
