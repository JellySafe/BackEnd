import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '@shared/persistence/prisma/prisma.service';
import { Public } from '@shared/auth/auth.decorators';

/**
 * 헬스체크 엔드포인트. 로드밸런서/오케스트레이터의 상태 확인용.
 * 인증 없이 접근 가능(@Public).
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** 프로세스 생존 확인 (liveness). DB 를 확인하지 않는다. */
  @ApiOperation({
    summary: '[인프라] 서버 살아있음 확인 — 화면 연동 대상 아님',
    description: '프로세스가 떠 있는지만 본다(DB 확인 안 함). 로드밸런서/배포 헬스체크용. 인증 불필요.',
  })
  @Public()
  @Get()
  liveness(): { status: string; uptime: number } {
    return { status: 'ok', uptime: Math.floor(process.uptime()) };
  }

  /** DB 연결까지 확인 (readiness). */
  @ApiOperation({
    summary: '[인프라] DB 연결까지 확인 — 화면 연동 대상 아님',
    description: 'DB 까지 붙는지 확인한다(readiness). DB 가 죽으면 `{ status: "degraded", db: "down" }` 을 준다. 인증 불필요.',
  })
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
