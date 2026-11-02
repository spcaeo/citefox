# Image for running CiteFox's Electron/Playwright e2e suite in Docker, so no
# app windows open on the developer's screen. Use `npm run test:e2e:docker`
# (scripts/e2e-docker.mjs), which builds this image once and reuses it.
#
# The image holds only system packages, Node, and a non-root user. The source
# is copied into a fresh container on every run, so one image serves any
# branch or working tree.

FROM ubuntu:24.04

ARG NODE_VERSION=24.19.0
ARG TARGETARCH

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

# Electron runtime libraries, a virtual display (xvfb), a private D-Bus session
# with gnome-keyring as the Secret Service (@napi-rs/keyring), busctl
# (systemd), fonts for screenshots and PDFs, and git/rsync for tooling.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl xz-utils git rsync \
      libgtk-3-0 libnss3 libxss1 libasound2t64 libgbm1 libxshmfence1 \
      libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 \
      libxdamage1 libxrandr2 libpango-1.0-0 libcairo2 \
      xvfb xauth dbus-x11 gnome-keyring libsecret-tools systemd \
      fonts-noto-core fonts-noto-color-emoji fonts-liberation2 \
 && rm -rf /var/lib/apt/lists/*

# Node from the official nodejs.org tarball, matching .nvmrc.
RUN set -eux; \
    arch="${TARGETARCH:-$(dpkg --print-architecture)}"; \
    case "$arch" in \
      amd64|x64) node_arch=x64 ;; \
      arm64|aarch64) node_arch=arm64 ;; \
      *) echo "unsupported architecture: $arch" >&2; exit 1 ;; \
    esac; \
    base="https://nodejs.org/dist/v${NODE_VERSION}"; \
    file="node-v${NODE_VERSION}-linux-${node_arch}.tar.xz"; \
    curl -fsSLO "$base/$file"; \
    curl -fsSL "$base/SHASUMS256.txt" | grep " $file\$" | sha256sum -c -; \
    tar -xJf "$file" -C /usr/local --strip-components=1 --no-same-owner; \
    rm "$file"; \
    node --version; npm --version

# Electron refuses to run as root without --no-sandbox, so tests run as a
# normal user. The cache directories exist up front so the named volumes that
# scripts/e2e-docker.mjs mounts there start out owned by this user.
RUN userdel -r ubuntu 2>/dev/null || true; \
    useradd --create-home --uid 1000 --shell /bin/bash citefox; \
    mkdir -p /home/citefox/app /home/citefox/.npm /home/citefox/.cache; \
    chown -R citefox:citefox /home/citefox

USER citefox
WORKDIR /home/citefox/app

CMD ["sleep", "infinity"]
