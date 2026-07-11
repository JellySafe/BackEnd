import { DataSource as PrismaDataSource, ObservationStation as PrismaStation, Prisma } from '@prisma/client';
import { toId } from '@shared/kernel/id';
import { DataSource } from '../../../domain/data-source';
import { StationInfo } from '../../../domain/station';
import { ObservationReading, OccurrenceReading } from '../../../domain/observation';
import { SourceType, StationType, SyncStatus } from '../../../domain/observation-enums';

/** number → Decimal (nullable) */
function numToDec(n: number | null): Prisma.Decimal | null {
  return n === null ? null : new Prisma.Decimal(n);
}

// ----- DataSource -----

export function dataSourceToDomain(row: PrismaDataSource): DataSource {
  return DataSource.reconstitute({
    id: toId(row.id),
    sourceCode: row.sourceCode,
    name: row.name,
    provider: row.provider,
    sourceType: row.sourceType as SourceType,
    endpointUrl: row.endpointUrl,
    isSample: row.isSample,
    syncIntervalMinutes: row.syncIntervalMinutes,
    lastSyncedAt: row.lastSyncedAt,
    lastSyncStatus: row.lastSyncStatus === null ? null : (row.lastSyncStatus as SyncStatus),
    lastSyncMessage: row.lastSyncMessage,
    isActive: row.isActive,
  });
}

/** 도메인 → Prisma update 데이터 (수집 결과 필드만). */
export function dataSourceToSyncUpdate(source: DataSource): Prisma.DataSourceUncheckedUpdateInput {
  const s = source.snapshot();
  return {
    lastSyncedAt: s.lastSyncedAt,
    lastSyncStatus: s.lastSyncStatus,
    lastSyncMessage: s.lastSyncMessage,
  };
}

// ----- Station -----

export function stationToInfo(row: PrismaStation): StationInfo {
  return {
    id: toId(row.id),
    sourceId: toId(row.sourceId),
    stationCode: row.stationCode,
    name: row.name,
    stationType: row.stationType as StationType,
    lat: row.lat.toNumber(),
    lng: row.lng.toNumber(),
    isActive: row.isActive,
  };
}

// ----- Observation -----

export function observationToCreate(
  reading: ObservationReading,
): Prisma.ObservationCreateManyInput {
  return {
    stationId: BigInt(reading.stationId),
    observedAt: reading.observedAt,
    waterTemp: numToDec(reading.waterTemp),
    salinity: numToDec(reading.salinity),
    waveHeight: numToDec(reading.waveHeight),
    currentDirection: reading.currentDirection,
    currentSpeed: numToDec(reading.currentSpeed),
    windDirection: reading.windDirection,
    windSpeed: numToDec(reading.windSpeed),
    airTemp: numToDec(reading.airTemp),
    precipitation: numToDec(reading.precipitation),
    qualityFlag: reading.qualityFlag,
  };
}

// ----- Occurrence -----

export function occurrenceToCreate(
  sourceId: number,
  reading: OccurrenceReading,
): Prisma.JellyfishOccurrenceCreateManyInput {
  return {
    sourceId: BigInt(sourceId),
    externalId: reading.externalId,
    occurredAt: reading.occurredAt,
    region: reading.region,
    lat: numToDec(reading.lat),
    lng: numToDec(reading.lng),
    species: reading.species,
    isToxic: reading.isToxic,
    densityLevel: reading.densityLevel,
    alertLevel: reading.alertLevel,
    description: reading.description,
  };
}
