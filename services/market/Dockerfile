# Build: static binary, no cgo, symbols stripped.
FROM golang:1.27-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/market ./cmd/market

# Run: distroless has CA certs for HTTPS upstreams and nothing else, as a non-root user.
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/market /market
ENV MARKET_ADDR=:8081
EXPOSE 8081
ENTRYPOINT ["/market"]
