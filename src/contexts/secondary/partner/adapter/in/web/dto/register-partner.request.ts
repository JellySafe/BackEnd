import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

/** [2차] POST /admin/partners 요청 (EX-001). */
export class RegisterPartnerRequest {
  @IsString()
  @MaxLength(50)
  partnerCode!: string;

  @IsString()
  @MaxLength(150)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  businessNo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  contactName?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  contactEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  planCode?: string;
}
