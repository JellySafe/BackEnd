import { Id } from '@shared/kernel/id';
import { ValidationError } from '@shared/kernel/domain-error';

export interface BeachProps {
  id?: Id;
  name: string;
  region: string;
  lat: number;
  lng: number;
  facingDirection: number | null; // 해변 정면 방위각 0~359 (선택)
  priority: number; // 노출/정렬 우선순위 (작을수록 먼저)
  vulnerabilityScore: number; // 지형 취약도 0~100
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

/** 신규 해변 등록 입력 (ADM-005). */
export interface NewBeachInput {
  name: string;
  region: string;
  lat: number;
  lng: number;
  facingDirection?: number | null;
  priority?: number;
  vulnerabilityScore?: number;
}

/** 해변 마스터 수정 입력. undefined 인 필드는 변경하지 않는다. */
export interface BeachUpdate {
  name?: string;
  region?: string;
  lat?: number;
  lng?: number;
  facingDirection?: number | null;
  priority?: number;
  vulnerabilityScore?: number;
  isActive?: boolean;
}

const DEFAULT_PRIORITY = 99;
const DEFAULT_VULNERABILITY = 0;

/**
 * 해변 마스터 애그리거트 (ADM-005).
 * 좌표/방위/취약도의 물리적 유효 범위를 캡슐화한다.
 * 프레임워크/ORM 에 의존하지 않는 순수 도메인 객체다.
 */
export class Beach {
  private constructor(private props: BeachProps) {}

  // --- 팩토리 ---

  /** 신규 해변 등록. isActive=true 로 시작한다. */
  static create(input: NewBeachInput): Beach {
    const props: BeachProps = {
      name: input.name?.trim(),
      region: input.region?.trim(),
      lat: input.lat,
      lng: input.lng,
      facingDirection: input.facingDirection ?? null,
      priority: input.priority ?? DEFAULT_PRIORITY,
      vulnerabilityScore: input.vulnerabilityScore ?? DEFAULT_VULNERABILITY,
      isActive: true,
    };
    Beach.validate(props);
    return new Beach(props);
  }

  /** DB 등 영속 저장소에서 복원. 불변식 검증 없이 그대로 재구성한다. */
  static reconstitute(props: BeachProps): Beach {
    return new Beach(props);
  }

  // --- 변경 ---

  /** 마스터 정보 수정. 제공된 필드만 병합 후 전체 불변식을 재검증한다. */
  applyUpdate(patch: BeachUpdate): void {
    const next: BeachProps = { ...this.props };
    if (patch.name !== undefined) next.name = patch.name.trim();
    if (patch.region !== undefined) next.region = patch.region.trim();
    if (patch.lat !== undefined) next.lat = patch.lat;
    if (patch.lng !== undefined) next.lng = patch.lng;
    if (patch.facingDirection !== undefined) next.facingDirection = patch.facingDirection;
    if (patch.priority !== undefined) next.priority = patch.priority;
    if (patch.vulnerabilityScore !== undefined) next.vulnerabilityScore = patch.vulnerabilityScore;
    if (patch.isActive !== undefined) next.isActive = patch.isActive;
    Beach.validate(next);
    this.props = next;
  }

  private static validate(p: BeachProps): void {
    if (!p.name) {
      throw new ValidationError('BEACH_NAME_REQUIRED', '해변 이름이 필요합니다.');
    }
    if (!p.region) {
      throw new ValidationError('BEACH_REGION_REQUIRED', '지역이 필요합니다.');
    }
    if (!Number.isFinite(p.lat) || p.lat < -90 || p.lat > 90) {
      throw new ValidationError('BEACH_LAT_RANGE', '위도는 -90 ~ 90 범위여야 합니다.', { lat: p.lat });
    }
    if (!Number.isFinite(p.lng) || p.lng < -180 || p.lng > 180) {
      throw new ValidationError('BEACH_LNG_RANGE', '경도는 -180 ~ 180 범위여야 합니다.', { lng: p.lng });
    }
    if (!Number.isFinite(p.vulnerabilityScore) || p.vulnerabilityScore < 0 || p.vulnerabilityScore > 100) {
      throw new ValidationError('BEACH_VULNERABILITY_RANGE', '취약도 점수는 0 ~ 100 범위여야 합니다.', {
        vulnerabilityScore: p.vulnerabilityScore,
      });
    }
    if (
      p.facingDirection !== null &&
      (!Number.isInteger(p.facingDirection) || p.facingDirection < 0 || p.facingDirection > 359)
    ) {
      throw new ValidationError('BEACH_FACING_DIRECTION_RANGE', '방위각은 0 ~ 359 범위의 정수여야 합니다.', {
        facingDirection: p.facingDirection,
      });
    }
    if (!Number.isInteger(p.priority) || p.priority < 0) {
      throw new ValidationError('BEACH_PRIORITY_RANGE', '우선순위는 0 이상의 정수여야 합니다.', {
        priority: p.priority,
      });
    }
  }

  // --- 조회 ---

  get id(): Id | undefined {
    return this.props.id;
  }
  get name(): string {
    return this.props.name;
  }
  get isActive(): boolean {
    return this.props.isActive;
  }

  /** 영속화/표현용 스냅샷 (어댑터·서비스 전용). */
  snapshot(): Readonly<BeachProps> {
    return { ...this.props };
  }
}
