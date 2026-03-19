package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"

	"redirect-service/cache"
	"redirect-service/db"
	"redirect-service/handlers"
	"redirect-service/queue"
)

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func main() {
	mongoURI := getEnv("MONGO_URI", "mongodb://localhost:27017")
	redisAddr := getEnv("REDIS_ADDR", "localhost:6379")
	rabbitURI := getEnv("RABBITMQ_URI", "amqp://guest:guest@localhost:5672/")
	port := getEnv("PORT", "8081")

	mongoClient, err := db.NewMongoClient(mongoURI)
	if err != nil {
		log.Fatalf("failed to connect to MongoDB: %v", err)
	}

	redisClient := cache.NewRedisClient(redisAddr)

	rabbitConn, err := queue.NewRabbitMQConnection(rabbitURI)
	if err != nil {
		log.Fatalf("failed to connect to RabbitMQ: %v", err)
	}
	defer rabbitConn.Close()

	r := gin.Default()

	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok", "service": "redirect-service"})
	})

	redirectHandler := handlers.NewRedirectHandler(redisClient, mongoClient, rabbitConn)
	r.GET("/:slug", redirectHandler.Redirect)

	srv := &http.Server{Addr: ":" + port, Handler: r}

	go func() {
		log.Printf("redirect-service listening on :%s", port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server error: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	srv.Shutdown(ctx)
	mongoClient.Disconnect(ctx)
	redisClient.Close()
	log.Println("redirect-service stopped")
}
