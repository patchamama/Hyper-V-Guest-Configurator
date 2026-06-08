FROM node:22-alpine

# Build tools needed to compile better-sqlite3 (native module)
RUN apk add --no-cache python3 make g++ wget ca-certificates icu-libs libstdc++

# PowerShell Core (musl build for Alpine) — allows PS endpoints to fail gracefully
RUN PWSH_VER=7.4.6 \
 && wget -q "https://github.com/PowerShell/PowerShell/releases/download/v${PWSH_VER}/powershell-${PWSH_VER}-linux-musl-x64.tar.gz" \
 && mkdir -p /opt/microsoft/powershell/7 \
 && tar zxf "powershell-${PWSH_VER}-linux-musl-x64.tar.gz" -C /opt/microsoft/powershell/7 \
 && chmod +x /opt/microsoft/powershell/7/pwsh \
 && ln -s /opt/microsoft/powershell/7/pwsh /usr/bin/pwsh \
 && rm "powershell-${PWSH_VER}-linux-musl-x64.tar.gz"

WORKDIR /app

# Install dependencies first (cached layer)
COPY package*.json ./
RUN npm ci --omit=dev

# Remove build tools after native modules are compiled
RUN apk del python3 make g++

COPY . .

EXPOSE 3000
CMD ["node", "web/server.js"]
