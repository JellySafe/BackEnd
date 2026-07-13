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

# 컨테이너 내부 포트(플랫폼이 PORT 환경변수로 덮어씀)
EXPOSE 3000

CMD ["node", "dist/main.js"]
