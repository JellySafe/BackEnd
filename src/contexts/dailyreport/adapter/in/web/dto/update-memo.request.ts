import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * FLOW-ADM-004 PATCH /admin/daily-reports/:id/memo 요청.
 */
export class UpdateMemoRequest {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  memo?: string | null;
}
