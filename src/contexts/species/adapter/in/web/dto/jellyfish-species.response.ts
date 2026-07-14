import { ApiProperty } from '@nestjs/swagger';
import { TOXICITY_LEVELS } from '../../../../domain/species-enums';

/**
 * 해파리 종 정보 응답 (JellyfishSpeciesView 미러).
 * 예시값은 전부 실제 시드 데이터(노무라입깃해파리)다 — 이 프로젝트 관례.
 */
export class JellyfishSpeciesResponse {
  @ApiProperty({ example: 8, description: '종 PK' })
  id!: number;

  @ApiProperty({ example: '노무라입깃해파리', description: '국명' })
  koreanName!: string;

  @ApiProperty({ example: 'Nemopilema nomurai', nullable: true, description: '학명' })
  scientificName!: string | null;

  @ApiProperty({
    enum: TOXICITY_LEVELS,
    example: 'strong',
    nullable: true,
    description:
      '독성 등급. strong(강독성) / mild(약독성) / harmless(무해성).\n' +
      '**null 은 "독성 없음"이 아니라 "국립수산과학원이 등급을 발표하지 않았다"는 뜻이다.** ' +
      '화면에는 "등급 미공표" 로 표시하고, 무해하다고 단정하지 마라.',
  })
  toxicity!: string | null;

  @ApiProperty({
    example:
      '대형해파리로 우산의 직경이 150cm, 무게가 100kg 을 넘는다. 우산은 연한 갈색이고, 구완의 촉수는 진한 갈색을 띤다.',
    nullable: true,
    description: '형태 특징(국립수산과학원 원문). 원문이 없는 종은 null — 앱에서 해당 항목을 숨긴다.',
  })
  features!: string | null;

  @ApiProperty({
    example: '6월말 제주에서 출현, 8월 중순에는 우리나라 전역에서 출현하며 12월 초순까지 서식한다.',
    nullable: true,
    description: '출현 시기/해역(국립수산과학원 원문). 원문이 없는 종은 null.',
  })
  appearanceSeason!: string | null;

  @ApiProperty({
    example: '통증과 홍반을 동반한 채찍 모양의 상처',
    nullable: true,
    description:
      '쏘였을 때 나타나는 **증상**. ⚠️ 처치법이 아니다. ' +
      '응급처치는 종에 상관없이 `GET /public/guides` 의 `FIRST_AID` 문구(현행 통합 지침) 하나만 안내한다.',
  })
  stingSymptom!: string | null;

  @ApiProperty({
    example: 'https://www.nifs.go.kr/portal/cmmn/images/jely/j8.jpg',
    nullable: true,
    description: '종 사진 URL(원본 직접 링크). 미등록이면 null.',
  })
  imageUrl!: string | null;

  @ApiProperty({
    example: '국립수산과학원',
    nullable: true,
    description:
      '이미지 출처. **imageUrl 을 화면에 띄울 때 이 문구를 반드시 함께 표시해야 한다** ' +
      '(공공저작물 출처 표시 의무). 사진만 쓰고 출처를 빼면 안 된다.',
  })
  imageSource!: string | null;

  @ApiProperty({
    example: 'https://www.nifs.go.kr/portal/me/jelyC/actionJelyFishInfo.do',
    nullable: true,
    description: '출처 원문 페이지 URL. 출처 표기를 링크로 걸 때 쓴다.',
  })
  imageSourceUrl!: string | null;

  @ApiProperty({ example: 8, description: '노출 순서' })
  displayOrder!: number;
}
