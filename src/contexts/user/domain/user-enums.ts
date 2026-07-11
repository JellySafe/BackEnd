/**
 * user 컨텍스트 값 계약 (소문자). DB users.role VARCHAR(20) 과 1:1 대응한다. (G-002)
 */

// 사용자 권한 등급 (G-002 역할별 권한)
//  - public   : 일반 사용자(비로그인/익명). 계정 등록 대상이 아니다.
//  - operator : 운영자(현장/지역 담당).
//  - admin    : 관리자(전체 권한).
export const USER_ROLES = ['public', 'operator', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

// 계정 등록(AUTH-001)이 허용되는 역할. public 은 익명이라 제외한다.
export const REGISTRABLE_ROLES = ['operator', 'admin'] as const;
export type RegistrableRole = (typeof REGISTRABLE_ROLES)[number];

export function isUserRole(v: unknown): v is UserRole {
  return typeof v === 'string' && (USER_ROLES as readonly string[]).includes(v);
}

export function isRegistrableRole(v: unknown): v is RegistrableRole {
  return typeof v === 'string' && (REGISTRABLE_ROLES as readonly string[]).includes(v);
}
