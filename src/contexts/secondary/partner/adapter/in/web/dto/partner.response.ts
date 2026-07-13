import { ApiProperty } from '@nestjs/swagger';

/** [2차] 파트너 뷰. PartnerView 미러링. */
export class PartnerViewResponse {
  @ApiProperty({ example: 1 }) partnerId!: number;
  @ApiProperty({ example: 'PARTNER-001' }) partnerCode!: string;
  @ApiProperty({ example: '해양연구소' }) name!: string;
  @ApiProperty({ example: 'active', enum: ['active', 'suspended', 'terminated'] })
  partnerStatus!: string;
}

/** [2차] POST /admin/partners 응답. */
export class RegisterPartnerResponse {
  @ApiProperty({ example: '[2차] EX-001 파트너 연동 골격' }) note!: string;
  @ApiProperty({ type: PartnerViewResponse }) partner!: PartnerViewResponse;
}

/** [2차] GET /admin/partners 응답. */
export class ListPartnersResponse {
  @ApiProperty({ example: '[2차] EX-001 파트너 연동 골격' }) note!: string;
  @ApiProperty({ type: [PartnerViewResponse] }) partners!: PartnerViewResponse[];
}
