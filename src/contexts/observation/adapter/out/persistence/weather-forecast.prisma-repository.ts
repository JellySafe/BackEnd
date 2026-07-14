import { Injectable } from '@nestjs/common';
import { PrismaService } from '@shared/persistence/prisma/prisma.service';
import { Id } from '@shared/kernel/id';
import { ForecastReading } from '../../../domain/weather-forecast';
import { ForecastRepositoryPort } from '../../../application/port/out/forecast-repository.port';
import { forecastToPersistence } from './observation.mapper';

/** 동시 upsert 수. 6시간마다 12해변 × 15구간 ≈ 180행이라 넉넉히 잡을 필요가 없다. */
const UPSERT_CONCURRENCY = 8;

/**
 * 기상 예보 영속성 어댑터 (Prisma).
 *
 * 관측(createMany + skipDuplicates)과 달리 **upsert** 다.
 * 같은 대상 시각(target_at)의 예보는 6시간마다 다시 발표되고, 그때마다 값이 갱신된다.
 * "이미 있으니 건너뛴다"로 처리하면 사흘 전 발표가 영원히 남아 예보가 아니라 화석이 된다.
 */
@Injectable()
export class WeatherForecastPrismaRepository implements ForecastRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async upsertMany(readings: ForecastReading[], sourceId: Id | null): Promise<number> {
    if (readings.length === 0) {
      return 0;
    }

    let saved = 0;
    for (let i = 0; i < readings.length; i += UPSERT_CONCURRENCY) {
      const chunk = readings.slice(i, i + UPSERT_CONCURRENCY);
      await Promise.all(chunk.map((reading) => this.upsertOne(reading, sourceId)));
      saved += chunk.length;
    }
    return saved;
  }

  private upsertOne(reading: ForecastReading, sourceId: Id | null): Promise<unknown> {
    const values = forecastToPersistence(reading, sourceId);
    return this.prisma.weatherForecast.upsert({
      where: {
        uk_weather_forecasts_target: {
          beachId: BigInt(reading.beachId),
          targetAt: reading.targetAt,
        },
      },
      create: {
        beachId: BigInt(reading.beachId),
        targetAt: reading.targetAt,
        ...values,
      },
      update: values,
    });
  }

  async findLatestBaseAt(): Promise<Date | null> {
    const row = await this.prisma.weatherForecast.aggregate({ _max: { baseAt: true } });
    return row._max.baseAt ?? null;
  }

  /**
   * 지난 예보 파기. 대상 시각(target_at)이 지난 예보는 더 이상 예보가 아니다.
   * 위험도 산출은 미래 구간만 읽으므로(risk-input.kysely-query) 지워도 산출 입력이 사라지지 않는다.
   */
  async purgeOlderThan(cutoff: Date): Promise<number> {
    const res = await this.prisma.weatherForecast.deleteMany({
      where: { targetAt: { lt: cutoff } },
    });
    return res.count;
  }
}
