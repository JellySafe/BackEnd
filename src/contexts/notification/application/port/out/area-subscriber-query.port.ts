import { Id } from '@shared/kernel/id';

/** 해역 구독자 1명(EX-004). 유료 구독자는 로그인 계정이라 userId 로만 식별된다. */
export interface AreaSubscriber {
  userId: Id;
  /** 어느 구역 때문에 대상이 됐는지(로그·문구용). 이름이 없으면 null. */
  areaLabel: string | null;
}

/**
 * 해역 구독자 조회 아웃바운드 포트 (EX-004).
 *
 * 관심 해변(favorite)과 별개다. 관심 해변은 그 해변을 콕 집은 일반 사용자이고, 여기는
 * **자기 조업·양식 구역이 그 해변을 포함하는** 유료 구독자다. 둘은 대상도 근거도 다르므로
 * 조회를 나눠 두고, 알림 확산에서 합친다.
 */
export interface AreaSubscriberQueryPort {
  /**
   * 그 해변을 감시 중인 **활성 구독**의 구독자 목록.
   * 정지·해지·만료된 구독은 포함하지 않는다(활성 = 알림을 보내는 상태).
   */
  findByBeach(beachId: Id): Promise<AreaSubscriber[]>;
}

export const AREA_SUBSCRIBER_QUERY = Symbol('AREA_SUBSCRIBER_QUERY');
