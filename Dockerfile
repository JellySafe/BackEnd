# =====================================================================================
#  JellySafe Backend - 멀티스테이지 Docker 빌드
#  Fly.io / Render / Cloud Run 등 컨테이너 플랫폼 공통.
#
#  - builder: 의존성 설치 + Prisma 클라이언트 생성 + nest build
#  - runner : 프로덕션 의존성만 + 빌드 산출물(dist) + Prisma 엔진
#  - node:22-slim(Debian) 사용. Prisma 엔진이 요구하는 openssl 을 설치한다.
#    (Alpine 을 쓰면 musl 타깃을 schema.prisma binaryTargets 에 추가해야 하므로 slim 채택)
# =====================================================================================

# ---- builder ----
FROM node:22-slim AS builder
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

# 의존성 레이어 캐시: package 파일 + prisma 스키마 먼저 복사
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

# Prisma 클라이언트 + Kysely 타입 생성
RUN npx prisma generate

# 소스 복사 후 빌드
COPY . .
RUN npm run build

# ---- runner ----
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

# 프로덕션 의존성만 설치
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# 빌드 산출물과 생성된 Prisma 클라이언트/엔진 복사
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# -------------------------------------------------------------------------------------
#  비 root 실행
#
#  기본값은 root 다. 그 상태에서 앱이 뚫리면 공격자가 컨테이너 안에서 무엇이든 할 수 있고,
#  커널/런타임 취약점과 겹치면 호스트로 넘어갈 발판이 된다. 이 앱은 파일 업로드를 받고
#  외부에서 받은 PDF·이미지를 파싱하므로(nifs-report.parser, pdf-parse) 입력면이 넓은 편이다.
#  node 이미지는 uid/gid 1000 의 `node` 사용자를 이미 갖고 있으니 그걸 쓴다.
#
#  ⚠️ 소유권은 **업로드 디렉터리만** 넘긴다
#  앱이 쓰는 곳은 UPLOAD_DIR(기본 ./uploads → /app/uploads) 하나뿐이다. dist 와 node_modules 는
#  읽기만 하므로 root 소유(기본 권한으로 읽기·실행 가능)로 둔다 — 앱이 자기 코드를 덮어쓸 수
#  없는 편이 오히려 안전하다.
#
#  `chown -R /app` 을 쓰지 않는 이유가 하나 더 있다. 레이어는 파일 메타데이터만 바뀌어도
#  **그 파일 전체를 다시 담는다.** node_modules 까지 재귀 chown 하면 이미지에 482MB 짜리
#  중복 레이어가 생기고(1.29GB → 1.77GB) 빌드에 100초가 더 붙는다. 실제로 측정한 값이다.
#
#  ⚠️ 여기에 **영구 볼륨을 마운트하면 그 디렉터리는 root 소유로 덮인다.** 그 경우 앱은
#  EACCES 로 기동에 실패한다(main.ts 가 무엇을 해야 하는지 알려주는 메시지를 낸다).
#  볼륨을 쓸 거라면 둘 중 하나다:
#    1) STORAGE_DRIVER=s3 로 바꾼다 — 머신을 늘릴 거라면 어차피 필요한 선택이다.
#    2) 첫 배포 때 한 번 `fly ssh console -C 'chown -R 1000:1000 /data'` 로 소유권을 넘긴다.
# -------------------------------------------------------------------------------------
RUN mkdir -p /app/uploads && chown node:node /app/uploads

USER node

# 컨테이너 내부 포트(플랫폼이 PORT 환경변수로 덮어씀)
EXPOSE 3000

# exec 형식이라 node 가 PID 1 이 된다 — 셸이 끼면 SIGTERM 이 node 까지 가지 않아
# enableShutdownHooks(main.ts)가 돌지 않는다.
CMD ["node", "dist/main.js"]
