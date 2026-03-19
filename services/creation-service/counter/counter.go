package counter

import (
	"context"

	"github.com/redis/go-redis/v9"
)

const globalCounterKey = "url:global_counter"

// NewRedisClient creates a Redis client from an address string (host:port).
func NewRedisClient(addr string) *redis.Client {
	return redis.NewClient(&redis.Options{
		Addr: addr,
	})
}

// Next atomically increments the global counter and returns the new value.
func Next(ctx context.Context, client *redis.Client) (int64, error) {
	return client.Incr(ctx, globalCounterKey).Result()
}
