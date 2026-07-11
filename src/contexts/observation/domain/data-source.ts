import { Id } from '@shared/kernel/id';
import { SourceType, SyncStatus } from './observation-enums';

export interface DataSourceProps {
  id?: Id;
  sourceCode: string;
  name: string;
  provider: string | null;
  sourceType: SourceType;
  endpointUrl: string | null;
  isSample: boolean;
  syncIntervalMinutes: number | null;
  lastSyncedAt: Date | null;
  lastSyncStatus: SyncStatus | null;
  lastSyncMessage: string | null;
  isActive: boolean;
}

const MAX_MESSAGE_LEN = 500; // data_sources.last_sync_message VARCHAR(500)

/**
 * 데이터 소스 애그리거트 (SYS-001).
 * 수집 배치의 성공/부분성공/실패 결과를 캡슐화한다(lastSyncStatus 전이).
 * 프레임워크/ORM 에 의존하지 않는 순수 도메인 객체다.
 */
export class DataSource {
  private constructor(private props: DataSourceProps) {}

  static reconstitute(props: DataSourceProps): DataSource {
    return new DataSource(props);
  }

  /** 수집 성공: lastSyncedAt/상태 갱신, 메시지 제거. */
  markSyncSuccess(now: Date): void {
    this.props.lastSyncedAt = now;
    this.props.lastSyncStatus = 'success';
    this.props.lastSyncMessage = null;
  }

  /** 부분 성공(일부 결측/스킵). */
  markSyncPartial(now: Date, message: string): void {
    this.props.lastSyncedAt = now;
    this.props.lastSyncStatus = 'partial';
    this.props.lastSyncMessage = DataSource.clip(message);
  }

  /** 수집 실패: 시각은 갱신하되 상태=failed + 사유 저장. */
  markSyncFailed(now: Date, message: string): void {
    this.props.lastSyncedAt = now;
    this.props.lastSyncStatus = 'failed';
    this.props.lastSyncMessage = DataSource.clip(message);
  }

  private static clip(message: string): string {
    return message.length > MAX_MESSAGE_LEN ? message.slice(0, MAX_MESSAGE_LEN) : message;
  }

  get id(): Id | undefined {
    return this.props.id;
  }
  get sourceCode(): string {
    return this.props.sourceCode;
  }
  get sourceType(): SourceType {
    return this.props.sourceType;
  }
  get isSample(): boolean {
    return this.props.isSample;
  }
  get isActive(): boolean {
    return this.props.isActive;
  }

  /** 영속화용 스냅샷 (어댑터 전용). */
  snapshot(): Readonly<DataSourceProps> {
    return { ...this.props };
  }
}
