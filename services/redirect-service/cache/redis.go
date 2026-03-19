package cache

import (
	"context"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	cacheTTL  = 5 * time.Minute
	keyPrefix = "url:"
)

// RedisClient wraps go-redis with URL-shortener-specific helpers.
type RedisClient struct {
	client *redis.Client
}

// NewRedisClient creates a connected Redis client.
func NewRedisClient(addr string) *RedisClient {
	rdb := redis.NewClient(&redis.Options{
		Addr:         addr,
		DialTimeout:  5 * time.Second,
		ReadTimeout:  3 * time.Second,
		WriteTimeout: 3 * time.Second,
	})
	return &RedisClient{client: rdb}
}

func cacheKey(slug string) string {
	return keyPrefix + slug
}

// Get retrieves the long URL for a slug. Returns ("", redis.Nil) on cache miss.
func (r *RedisClient) Get(ctx context.Context, slug string) (string, error) {
	return r.client.Get(ctx, cacheKey(slug)).Result()
}

// Set stores the long URL for a slug with a 5-minute TTL.
func (r *RedisClient) Set(ctx context.Context, slug, longURL string) error {
	return r.client.Set(ctx, cacheKey(slug), longURL, cacheTTL).Err()
}

// ResetTTL refreshes the TTL of an existing key to 5 minutes (sliding expiration).
func (r *RedisClient) ResetTTL(ctx context.Context, slug string) error {
	return r.client.Expire(ctx, cacheKey(slug), cacheTTL).Err()
}

// Close shuts down the underlying Redis connection.
func (r *RedisClient) Close() error {
	return r.client.Close()
}
