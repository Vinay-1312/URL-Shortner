package handlers

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
	"go.mongodb.org/mongo-driver/mongo"

	"creation-service/counter"
	"creation-service/db"
	"creation-service/encoder"
)

const domain = "http://localhost:8000/r"

// ShortenHandler holds dependencies for the shorten endpoint.
type ShortenHandler struct {
	mongo *mongo.Client
	redis *redis.Client
}

// NewShortenHandler constructs a ShortenHandler.
func NewShortenHandler(mongoClient *mongo.Client, redisClient *redis.Client) *ShortenHandler {
	return &ShortenHandler{
		mongo: mongoClient,
		redis: redisClient,
	}
}

type shortenRequest struct {
	LongURL string `json:"longUrl" binding:"required,url"`
}

type shortenResponse struct {
	ShortURL  string `json:"shortUrl"`
	Slug      string `json:"slug"`
	CreatedAt string `json:"createdAt"`
}

// Shorten handles POST /api/shorten.
func (h *ShortenHandler) Shorten(c *gin.Context) {
	var req shortenRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	// Get next unique ID from Redis (atomic global counter)
	id, err := counter.Next(ctx, h.redis)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate ID"})
		return
	}

	slug := encoder.ToBase62(id)
	now := time.Now().UTC()

	record := db.URLRecord{
		Slug:      slug,
		LongURL:   req.LongURL,
		CreatedAt: now,
	}

	if err := db.InsertURL(ctx, h.mongo, record); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save URL"})
		return
	}

	c.JSON(http.StatusCreated, shortenResponse{
		ShortURL:  fmt.Sprintf("%s/%s", domain, slug),
		Slug:      slug,
		CreatedAt: now.Format(time.RFC3339),
	})
}
