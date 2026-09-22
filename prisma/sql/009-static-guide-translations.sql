-- =====================================================================================
-- 009. static_guide_translations — 안내/고지 문구의 다국어 문안
--
-- `/public/guides` 가 언어 설정을 따르지 않아 **응급대처법이 한국어로만 나가고 있었다**(#94).
-- 그 글은 쏘인 직후에 읽는 글이고, 면책 문구는 책임 범위를 밝히는 문장이다 — 읽지 못하는
-- 사람에게는 고지가 이뤄지지 않은 것과 같다.
--
-- ── 왜 컬럼이 아니라 테이블인가 ────────────────────────────────────────────────────
-- title_en / body_en / title_zh … 로 늘리면 언어를 추가할 때마다 DDL 이 필요하고, 비어 있는
-- 칸과 "번역이 없음" 이 구분되지 않는다. 행으로 두면 없는 언어는 그냥 행이 없다.
--
-- ── ⚠️ source_hash — 낡은 번역을 내보내지 않기 위한 것 ─────────────────────────────
-- seed.ts 는 FIRST_AID 를 **재시드마다 강제로 덮어쓴다.** 국립수산과학원이 지침을 바꿨는데
-- 옛 문구가 남아 있으면 사람이 다칠 수 있기 때문이다(그 주석이 이미 코드에 있다).
--
-- 번역을 붙이면 그 위험이 그대로 옮겨온다 — 한국어만 갱신되고 영어가 옛 지침으로 남으면,
-- 외국인 방문객은 **현행과 반대되는 응급처치를 안내받는다.**
--
-- 그래서 번역 시점의 원문 해시를 함께 저장한다. 읽을 때 원문 해시가 다르면 그 번역은
-- **쓰지 않고 한국어로 떨어뜨린다.** 읽을 수 있지만 틀릴 수 있는 글보다, 기계번역이라도
-- 스스로 돌려 읽을 수 있는 현행 원문이 낫다.
--
-- 적용:
--   mysql -u root -p jellysafe < prisma/sql/009-static-guide-translations.sql
-- =====================================================================================

CREATE TABLE IF NOT EXISTS static_guide_translations (
  id          BIGINT       NOT NULL AUTO_INCREMENT,
  guide_id    BIGINT       NOT NULL,

  -- ko 는 여기 두지 않는다. 원문은 static_guides 에 있고, 여기 또 두면 둘이 갈라진다.
  locale      VARCHAR(10) COLLATE utf8mb4_bin NOT NULL,

  title       VARCHAR(200) NULL,
  body        TEXT         NOT NULL,

  -- 번역한 시점의 **원문(제목+본문) 해시**. 원문이 바뀌면 값이 달라져 번역이 무시된다.
  source_hash CHAR(64) COLLATE utf8mb4_bin NOT NULL,

  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uk_static_guide_translations_guide_locale (guide_id, locale),

  CONSTRAINT fk_static_guide_translations_guide
    FOREIGN KEY (guide_id) REFERENCES static_guides (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='안내/고지 문구 다국어 문안 — 원문이 바뀌면 source_hash 불일치로 무시된다';
