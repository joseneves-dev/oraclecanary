FROM node:22-alpine

WORKDIR /app

# The Kamino SDKs pin conflicting peer versions of @solana/kit; the lockfile already records the
# resolved tree, so install it as recorded.
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src

USER node
CMD ["npm", "start"]
