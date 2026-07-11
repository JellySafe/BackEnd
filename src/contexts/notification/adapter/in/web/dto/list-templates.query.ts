import { IsIn, IsOptional } from 'class-validator';
import { NOTIFICATION_TARGETS, NotificationTarget } from '../../../../domain/notification-enums';

/**
 * ADM-010 GET /admin/notification-templates 쿼리 파라미터.
 */
export class ListTemplatesQuery {
  @IsOptional()
  @IsIn(NOTIFICATION_TARGETS as readonly string[])
  targetType?: NotificationTarget;
}
