import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

/** [2차] POST /admin/partners 요청 (EX-001). */
export class RegisterPartnerRequest {
  @ApiProperty({
    example: 'JEJU_MARINE',
    maxLength: 50,
    description: '파트너를 식별하는 고유 코드. 연동 시 이 값으로 파트너를 특정한다.',
  })
  @IsString()
  @MaxLength(50)
  partnerCode!: string;

  @ApiProperty({
    example: '제주해양관광',
    maxLength: 150,
    description: '파트너 업체명. 관리자 목록에 표시된다.',
  })
  @IsString()
  @MaxLength(150)
  name!: string;

  @ApiPropertyOptional({
    example: '123-45-67890',
    maxLength: 30,
    description: '사업자등록번호.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  businessNo?: string;

  @ApiPropertyOptional({
    example: '김담당',
    maxLength: 100,
    description: '파트너 측 담당자 이름.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  contactName?: string;

  @ApiPropertyOptional({
    example: 'partner@example.com',
    format: 'email',
    maxLength: 255,
    description: '담당자 연락 이메일.',
  })
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  contactEmail?: string;

  @ApiPropertyOptional({
    example: 'basic',
    maxLength: 30,
    description: '적용할 요금제 코드. 2차 확장 골격이라 아직 정해진 코드 체계가 없는 자유 문자열이다.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  planCode?: string;
}
