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
  @IsOptional()
  @IsIn(ADMIN_TARGETS as readonly string[])
  targetType?: Extract<NotificationTarget, 'admin' | 'operator'>;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  beachId?: number;

  /** 'true' | true 면 미열람만 조회. */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  unreadOnly?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  size?: number;
}
