# ──────────────────────────────────────────────────────────────────────────────
# ShuffleDNS + MassDNS — Multi-stage build
# Tag: ghcr.io/zebbern/shuffledns-massdns:latest
#
# Build:
#   docker build -t ghcr.io/zebbern/shuffledns-massdns:latest docker/shuffledns-massdns/
# ──────────────────────────────────────────────────────────────────────────────

# Stage 1: Build ShuffleDNS (Go)
FROM golang:1.24-alpine AS shuffledns-builder

RUN apk add --no-cache git \
  && go install -v github.com/projectdiscovery/shuffledns/cmd/shuffledns@latest

# Stage 2: Build MassDNS (C)
FROM alpine:3.20 AS massdns-builder

RUN apk add --no-cache build-base git \
  && git clone --depth 1 https://github.com/blechschmidt/massdns.git /massdns \
  && cd /massdns \
  && make

# Stage 3: Minimal runtime
FROM alpine:3.20

LABEL org.opencontainers.image.title="shuffledns-massdns" \
      org.opencontainers.image.description="ShuffleDNS + MassDNS subdomain enumeration" \
      org.opencontainers.image.source="https://github.com/zebbern/Sentris"

# Install only runtime dependencies (ca-certs for HTTPS, bind-tools for DNS utils)
RUN apk add --no-cache ca-certificates bind-tools

# Copy binaries from build stages
COPY --from=shuffledns-builder /go/bin/shuffledns /usr/local/bin/shuffledns
COPY --from=massdns-builder /massdns/bin/massdns /usr/local/bin/massdns

# Provide a default resolvers.txt
RUN printf '%s\n' \
      '1.1.1.1' \
      '1.0.0.1' \
      '8.8.8.8' \
      '8.8.4.4' \
      '9.9.9.9' \
      '149.112.112.112' \
      '208.67.222.222' \
      '208.67.220.220' \
    > /etc/resolvers.txt

# Create non-root user
RUN addgroup -S scanner && adduser -S scanner -G scanner
USER scanner

ENTRYPOINT ["shuffledns"]
CMD ["--help"]
