import { ValidationError } from '@shared/kernel/domain-error';

/**
 * 브라우저가 발급한 Web Push 구독 정보 (표준 PushSubscription).
 *
 * 프론트가 `registration.pushManager.subscribe({ applicationServerKey })` 로 받은 객체를
 * `subscription.toJSON()` 한 것과 같은 모양이다. 우리는 이 값을
 * notification_consents.push_subscription_json 에 그대로 저장한다.
 *
 * endpoint 가 300자를 넘는 일이 흔해 기존 device_token(VARCHAR 255)에는 담기지 않는다.
 * (그래서 JSON 컬럼을 따로 둔다)
 */
export interface WebPushSubscription {
  /** 푸시 서비스(FCM/Mozilla autopush/WNS)가 발급한 구독 URL. 사실상의 수신자 주소 = 민감정보. */
  endpoint: string;
  keys: {
    /** 브라우저의 P-256 공개키(base64url). 페이로드 암호화에 쓴다. */
    p256dh: string;
    /** 브라우저의 auth secret(base64url, 16바이트). */
    auth: string;
  };
}

/** endpoint 길이 상한. 실제 값은 200~400자 수준이며, 비정상적으로 긴 입력을 막는 안전장치다. */
const MAX_ENDPOINT_LENGTH = 2000;

/** notification_dispatches.recipient 는 VARCHAR(255) 다. 마스킹 결과를 이 안에 가둔다. */
const MAX_RECIPIENT_LENGTH = 255;

/** 마스킹 시 남길 endpoint 꼬리 길이. 같은 사용자의 여러 구독을 로그에서 구분할 정도만 남긴다. */
const ENDPOINT_TAIL_LENGTH = 6;

/**
 * 알 수 없는 입력(HTTP body / DB JSON 컬럼)을 WebPushSubscription 으로 검증·정규화한다.
 *
 * 브라우저가 주는 값을 그대로 신뢰하지 않는다. endpoint 는 https URL 이어야 하고
 * (푸시 서비스는 전부 https 다) 키 두 개가 모두 있어야 암호화가 가능하다.
 * 프레임워크에 의존하지 않는 순수 함수다.
 */
export function parseWebPushSubscription(input: unknown): WebPushSubscription {
  if (input === null || typeof input !== 'object') {
    throw new ValidationError('PUSH_SUB_INVALID', '푸시 구독 정보가 올바르지 않습니다.');
  }

  const raw = input as { endpoint?: unknown; keys?: unknown };
  const endpoint = typeof raw.endpoint === 'string' ? raw.endpoint.trim() : '';

  if (endpoint === '') {
    throw new ValidationError('PUSH_SUB_ENDPOINT_REQUIRED', '푸시 구독 endpoint 가 필요합니다.');
  }
  if (endpoint.length > MAX_ENDPOINT_LENGTH) {
    throw new ValidationError('PUSH_SUB_ENDPOINT_TOO_LONG', '푸시 구독 endpoint 가 너무 깁니다.', {
      length: endpoint.length,
    });
  }
  if (!isHttpsUrl(endpoint)) {
    throw new ValidationError(
      'PUSH_SUB_ENDPOINT_INVALID',
      '푸시 구독 endpoint 는 https URL 이어야 합니다.',
    );
  }

  const keys = (raw.keys ?? {}) as { p256dh?: unknown; auth?: unknown };
  const p256dh = typeof keys.p256dh === 'string' ? keys.p256dh.trim() : '';
  const auth = typeof keys.auth === 'string' ? keys.auth.trim() : '';

  if (p256dh === '' || auth === '') {
    throw new ValidationError(
      'PUSH_SUB_KEYS_REQUIRED',
      '푸시 구독 키(p256dh, auth)가 모두 필요합니다.',
    );
  }

  return { endpoint, keys: { p256dh, auth } };
}

/** 검증 없이 참/거짓만 알고 싶을 때 (DB 에 들어있는 과거 행이 깨졌는지 확인 등). */
export function isWebPushSubscription(input: unknown): input is WebPushSubscription {
  try {
    parseWebPushSubscription(input);
    return true;
  } catch {
    return false;
  }
}

/**
 * endpoint 를 발송 이력에 남길 수 있게 마스킹한다.
 *
 * endpoint 는 그 자체가 "이 사용자에게 푸시를 보낼 수 있는 권한"이다. 유출되면
 * 제3자가 우리 사용자에게 알림을 보낼 수 있으므로(VAPID 키 없이도 일부 서비스는 허용)
 * notification_dispatches.recipient 에 원문을 그대로 쓰지 않는다.
 *
 * 호스트(어느 푸시 서비스인지)와 꼬리 6자(같은 사용자의 여러 기기 구분)만 남긴다.
 *   https://fcm.googleapis.com/fcm/send/abc...xyz123 → https://fcm.googleapis.com/***xyz123
 */
export function maskEndpoint(endpoint: string): string {
  const tail = (value: string): string => value.slice(-ENDPOINT_TAIL_LENGTH);

  let masked: string;
  try {
    const url = new URL(endpoint);
    // 경로의 마지막 조각(구독 식별자)에서 꼬리만 남긴다. 쿼리스트링은 통째로 버린다.
    const path = url.pathname.replace(/\/+$/, '');
    masked = `${url.origin}/***${tail(path)}`;
  } catch {
    // URL 로 파싱되지 않는 값이면(깨진 데이터) 꼬리만 남기고 전부 가린다.
    masked = `***${tail(endpoint)}`;
  }

  return masked.slice(0, MAX_RECIPIENT_LENGTH);
}

/** https URL 인지. 푸시 서비스 endpoint 는 예외 없이 https 다. */
function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}
