import { ConfigService } from '@nestjs/config';
import { CompositeCollectorAdapter } from './composite-collector.adapter';
import { KhoaBuoyCollector } from './khoa-buoy.collector';
import { KmaSeaObsCollector } from './kma-sea-obs.collector';
import { MockCollectorAdapter } from './mock-collector.adapter';
import { NifsJellyfishCollector } from './nifs-jellyfish.collector';
import { DataSource } from '../../../domain/data-source';
import { ObservationReading, OccurrenceReading } from '../../../domain/observation';
import { StationInfo } from '../../../domain/station';

/**
 * mock 폴백의 **환경 게이트**를 고정한다.
 *
 * ── 왜 이 테스트가 필요한가 ──────────────────────────────────────────────────────────
 * 폴백은 원래 환경과 무관하게 늘 켜져 있었다. 그래서 운영에서 기상청/KHOA/NIFS 가 죽으면
 * 해시로 만들어 낸 수온·파고·**독성 고밀도 해파리 출현**이 실데이터와 구분 표시 없이 저장되고,
 * 30분 뒤 위험도 산출이 그걸 그대로 읽어 시민에게 보여줬다.
 *
 * 게다가 mock 이 늘 결과를 채워 주는 바람에, "수집기가 0건을 반환하는 상태가 이어지는가" 로
 * 조용한 고장을 잡는 sync-health 판정까지 무력화됐다(fetched 가 영원히 0 이 아니게 된다).
 *
 * 이 테스트가 지키는 것은 한 문장이다:
 * **운영에서는 실패가 실패로 드러나고, 가짜 값이 만들어지지 않는다.**
 */
describe('CompositeCollectorAdapter — mock 폴백 게이트', () => {
  const source = { sourceCode: 'KMA_SEA_OBS', sourceType: 'marine' } as unknown as DataSource;
  const jellyfishSource = { sourceCode: 'NIFS', sourceType: 'jellyfish' } as unknown as DataSource;

  const station: StationInfo = {
    id: 1,
    sourceId: 1,
    stationCode: '22101',
    name: '제주',
    stationType: 'marine',
    lat: 33.5,
    lng: 126.5,
    isActive: true,
  };

  /** 환경변수만 바꿔 끼우는 최소 ConfigService. */
  function configOf(env: Record<string, string>): ConfigService {
    return { get: (key: string) => env[key] } as unknown as ConfigService;
  }

  function build(env: Record<string, string>, overrides: Partial<Record<string, unknown>> = {}) {
    const mockReading = { stationId: 1 } as unknown as ObservationReading;
    const mockOccurrence = { externalId: 'mock-1' } as unknown as OccurrenceReading;

    const mock = {
      collectObservations: jest.fn().mockResolvedValue([mockReading]),
      collectOccurrences: jest.fn().mockResolvedValue([mockOccurrence]),
    } as unknown as MockCollectorAdapter;

    const kma = {
      isConfigured: true,
      supports: () => true,
      collectObservations: jest.fn().mockRejectedValue(new Error('KMA 503')),
      ...(overrides.kma ?? {}),
    } as unknown as KmaSeaObsCollector;

    const khoa = {
      isConfigured: false,
      supports: () => false,
      collectObservations: jest.fn().mockResolvedValue([]),
    } as unknown as KhoaBuoyCollector;

    const nifs = {
      isConfigured: true,
      collectOccurrences: jest.fn().mockRejectedValue(new Error('NIFS 타임아웃')),
      ...(overrides.nifs ?? {}),
    } as unknown as NifsJellyfishCollector;

    return {
      adapter: new CompositeCollectorAdapter(configOf(env), mock, nifs, khoa, kma),
      mock,
    };
  }

  describe('운영 (NODE_ENV=production)', () => {
    const PROD = { NODE_ENV: 'production' };

    it('실 수집기가 실패하면 예외를 올린다 — 소스가 failed 로 기록되게', async () => {
      const { adapter, mock } = build(PROD);

      await expect(adapter.collectObservations(source, [station])).rejects.toThrow('KMA 503');
      // 가짜 관측치가 단 한 건도 만들어지지 않아야 한다.
      expect(mock.collectObservations).not.toHaveBeenCalled();
    });

    it('NIFS 실패도 예외로 올린다 — 가짜 해파리 출현이 위험도에 섞이지 않게', async () => {
      const { adapter, mock } = build(PROD);

      await expect(adapter.collectOccurrences(jellyfishSource)).rejects.toThrow('NIFS 타임아웃');
      expect(mock.collectOccurrences).not.toHaveBeenCalled();
    });

    it('NIFS 인증키가 없으면 설정 오류로 본다 — 조용한 0건은 "출현 없음"과 구분되지 않는다', async () => {
      const { adapter, mock } = build(PROD, { nifs: { isConfigured: false } });

      await expect(adapter.collectOccurrences(jellyfishSource)).rejects.toThrow(/NIFS_API_KEY/);
      expect(mock.collectOccurrences).not.toHaveBeenCalled();
    });

    it('실연동 수집기가 없는 관측소는 건너뛴다 — 0건이면 sync-health 가 잡는다', async () => {
      const { adapter, mock } = build(PROD, { kma: { isConfigured: false, supports: () => false } });

      await expect(adapter.collectObservations(source, [station])).resolves.toEqual([]);
      expect(mock.collectObservations).not.toHaveBeenCalled();
    });

    it('MOCK_COLLECTOR_FALLBACK=true 로 명시하면 운영에서도 켤 수 있다 (탈출구)', async () => {
      const { adapter, mock } = build({ ...PROD, MOCK_COLLECTOR_FALLBACK: 'true' });

      await expect(adapter.collectObservations(source, [station])).resolves.toHaveLength(1);
      expect(mock.collectObservations).toHaveBeenCalled();
    });
  });

  describe('개발/CI', () => {
    it('NODE_ENV 미설정이면 폴백이 켜진다 — 인증키 없이도 화면이 돈다', async () => {
      const { adapter, mock } = build({});

      await expect(adapter.collectObservations(source, [station])).resolves.toHaveLength(1);
      expect(mock.collectObservations).toHaveBeenCalled();
    });

    it('development 에서 NIFS 가 실패하면 mock 으로 대체한다', async () => {
      const { adapter, mock } = build({ NODE_ENV: 'development' });

      await expect(adapter.collectOccurrences(jellyfishSource)).resolves.toHaveLength(1);
      expect(mock.collectOccurrences).toHaveBeenCalled();
    });

    it('MOCK_COLLECTOR_FALLBACK=false 면 개발에서도 끌 수 있다', async () => {
      const { adapter, mock } = build({ NODE_ENV: 'development', MOCK_COLLECTOR_FALLBACK: 'false' });

      await expect(adapter.collectObservations(source, [station])).rejects.toThrow('KMA 503');
      expect(mock.collectObservations).not.toHaveBeenCalled();
    });
  });

  it('실 수집기가 정상적으로 0건을 반환하면 폴백하지 않는다 — "출현 없음"은 유효한 사실이다', async () => {
    const { adapter, mock } = build(
      { NODE_ENV: 'development' },
      { kma: { collectObservations: jest.fn().mockResolvedValue([]) } },
    );

    await expect(adapter.collectObservations(source, [station])).resolves.toEqual([]);
    expect(mock.collectObservations).not.toHaveBeenCalled();
  });
});
