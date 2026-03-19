package handlers

import (
	"context"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"redirect-service/cache"
	"redirect-service/db"
	"redirect-service/queue"
)

// RedirectHandler holds all service dependencies.
type RedirectHandler struct {
	cache  *cache.RedisClient
	mongo  *db.MongoClient
	rabbit *queue.RabbitMQConnection
}

// NewRedirectHandler constructs a RedirectHandler.
func NewRedirectHandler(c *cache.RedisClient, m *db.MongoClient, r *queue.RabbitMQConnection) *RedirectHandler {
	return &RedirectHandler{cache: c, mongo: m, rabbit: r}
}

// Redirect handles GET /:slug
// Flow: Redis cache → MongoDB fallback → publish click event → 302 redirect
func (h *RedirectHandler) Redirect(c *gin.Context) {
	slug := c.Param("slug")
	ctx := context.Background()

	var longURL string

	// 1. Try Redis cache
	cached, err := h.cache.Get(ctx, slug)
	if err == nil && cached != "" {
		// Cache HIT — reset TTL for sliding expiration
		longURL = cached
		if err := h.cache.ResetTTL(ctx, slug); err != nil {
			log.Printf("[WARN] failed to reset TTL for slug %q: %v", slug, err)
		}
	} else {
		// 2. Cache MISS — query MongoDB
		doc, err := h.mongo.GetBySlug(ctx, slug)
		if err != nil {
			if errors.Is(err, db.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "slug not found"})
				return
			}
			log.Printf("[ERROR] MongoDB lookup failed for slug %q: %v", slug, err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
			return
		}
		longURL = doc.LongURL

		// Populate cache with 5-minute TTL
		if err := h.cache.Set(ctx, slug, longURL); err != nil {
			log.Printf("[WARN] failed to cache slug %q: %v", slug, err)
		}
	}

	// 3. Publish click event to RabbitMQ (non-fatal)
	event := queue.ClickEvent{
		Slug:      slug,
		LongURL:   longURL,
		ClickedAt: time.Now().UTC().Format(time.RFC3339),
		IPAddress: resolveIP(c),
		UserAgent: c.Request.Header.Get("User-Agent"),
		Referrer:  c.Request.Header.Get("Referer"),
	}
	if err := h.rabbit.Publish(event); err != nil {
		log.Printf("[WARN] failed to publish click event for slug %q: %v", slug, err)
	}

	// 4. HTTP 302 redirect
	c.Redirect(http.StatusFound, longURL)
}

// resolveIP extracts the real client IP from X-Forwarded-For or RemoteAddr.
func resolveIP(c *gin.Context) string {
	if xff := c.Request.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.SplitN(xff, ",", 2)
		if ip := strings.TrimSpace(parts[0]); ip != "" {
			return ip
		}
	}
	addr := c.Request.RemoteAddr
	if idx := strings.LastIndex(addr, ":"); idx != -1 {
		return addr[:idx]
	}
	return addr
}
