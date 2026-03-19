FROM golang:1.22-alpine AS builder

RUN apk add --no-cache git ca-certificates

WORKDIR /app

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -mod=mod -trimpath -ldflags="-s -w" -o redirect-service .

FROM alpine:3.19

RUN apk add --no-cache ca-certificates

COPY --from=builder /app/redirect-service /redirect-service

EXPOSE 8081

ENTRYPOINT ["/redirect-service"]
