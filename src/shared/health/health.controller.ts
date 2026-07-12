import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '@shared/persistence/prisma/prisma.service';
import { Public } from '@shared/auth/auth.decorators';

/**
 * 헬스체크 엔드포인트. 로드밸런서/오케스트레이터의 상태 확인용.
 * 인증 없이 접근 가능(@Public).
 */
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** 프로세스 생존 확인 (liveness). DB 를 확인하지 않는다. */
  @Public()
  @Get()
  liveness(): { status: string; uptime: number } {
    return { status: 'ok', uptime: Math.floor(process.uptime()) };
  }

  /** DB 연결까지 확인 (readiness). */
  @Public()
  @Get('ready')
  async readiness(): Promise<{ status: string; db: 'up' | 'down' }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', db: 'up' };
    } catch {
      return { status: 'degraded', db: 'down' };
    }
  }
}
