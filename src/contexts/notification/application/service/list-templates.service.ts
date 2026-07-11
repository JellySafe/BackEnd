import { Inject, Injectable } from '@nestjs/common';
import { ListTemplatesUseCase } from '../port/in/notification-use-cases';
import { NotificationTarget } from '../../domain/notification-enums';
import { TemplateQueryPort, TemplateRecord, TEMPLATE_QUERY } from '../port/out/template-query.port';

/**
 * ADM-010 알림 템플릿 목록 조회(active=true). 관리자 문구 관리 화면 보조.
 */
@Injectable()
export class ListTemplatesService implements ListTemplatesUseCase {
  constructor(@Inject(TEMPLATE_QUERY) private readonly templates: TemplateQueryPort) {}

  list(targetType?: NotificationTarget): Promise<TemplateRecord[]> {
    return this.templates.listActive(targetType);
  }
}
