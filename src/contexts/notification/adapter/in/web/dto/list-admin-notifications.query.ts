import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { NotificationTarget } from '../../../../domain/notification-enums';

/** 관리자 알림함이 다루는 대상(관광객 알림은 /public/alerts 소관). */
const ADMIN_TARGETS = ['admin', 'operator'] as const;

/**
 * ADM-010 GET /admin/notifications 쿼리 파라미터 (관리자 알림함 "받은 알림" 탭).
 * targetType 미지정 시 admin+operator 알림을 모두 조회한다.
 */
export class ListAdminNotificationsQuery {
  @ApiPropertyOptional({
    enum: ADMIN_TARGETS,
    example: 'operator',
    description:
      '받는 사람 필터. admin(관리자) 또는 operator(운영자) 알림만 골라 본다. 생략하면 둘 다. 관광객(public) 알림은 이 API 가 아니라 /public/alerts 소관이다.',
  })
  @IsOptional()
  @IsIn(ADMIN_TARGETS as readonly string[])
  targetType?: Extract<NotificationTarget, 'admin' | 'operator'>;

  @ApiPropertyOptional({
    example: 1,
    minimum: 1,
    description: '해변 필터. 특정 해변에 관한 알림만 본다(예: 1 = 협재해수욕장).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  beachId?: number;

  /** 'true' | true 면 미열람만 조회. */
  @ApiPropertyOptional({
    example: true,
    description: 'true 면 아직 안 읽은 알림만 본다(알림함의 "안 읽음" 탭). 생략하면 읽은 것까지 전부.',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  unreadOnly?: boolean;

  @ApiPropertyOptional({
    example: 1,
    default: 1,
    minimum: 1,
    description: '페이지 번호(1부터). 생략 시 1.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    example: 20,
    default: 20,
    minimum: 1,
    maximum: 100,
    description: '페이지당 개수. 생략 시 20, 100 을 넘겨도 100 으로 잘린다.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  size?: number;
}
