import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { NOTIFICATION_TARGETS, NotificationTarget } from '../../../../domain/notification-enums';

/**
 * ADM-010 GET /admin/notification-templates 쿼리 파라미터.
 */
export class ListTemplatesQuery {
  @ApiPropertyOptional({
    enum: NOTIFICATION_TARGETS,
    example: 'operator',
    description:
      '받는 사람별 문구 템플릿만 골라 받는다. admin(관리자) / operator(운영자) / public(관광객). 알림 발송 화면에서 대상을 고르면 그에 맞는 템플릿 목록을 채울 때 쓴다. 생략하면 전부.',
  })
  @IsOptional()
  @IsIn(NOTIFICATION_TARGETS as readonly string[])
  targetType?: NotificationTarget;
}
