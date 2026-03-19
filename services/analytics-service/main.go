package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/gin-gonic/gin"

	"analytics-service/consumer"
	"analytics-service/db"
)

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func main() {
	rabbitURI := getEnv("RABBITMQ_URI", "amqp://guest:guest@localhost:5672/")
	postgresURI := getEnv("POSTGRES_URI", "postgres://analytics:analyticspass@localhost:5432/analytics?sslmode=disable")
	port := getEnv("PORT", "8082")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Connect PostgreSQL
	pg, err := db.New(ctx, postgresURI)
	if err != nil {
		log.Fatalf("failed to connect to PostgreSQL: %v", err)
	}
	defer pg.Close()
	log.Println("PostgreSQL connected and schema migrated")

	// Start RabbitMQ consumer
	cons, err := consumer.New(rabbitURI, pg)
	if err != nil {
		log.Fatalf("failed to create consumer: %v", err)
	}
	defer cons.Close()

	go func() {
		if err := cons.Start(ctx); err != nil {
			log.Printf("[Consumer] exited with error: %v", err)
		}
	}()

	// Health check endpoint
	r := gin.Default()
	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok", "service": "analytics-service"})
	})

	srv := &http.Server{Addr: ":" + port, Handler: r}
	go func() {
		log.Printf("analytics-service health endpoint on :%s", port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Printf("health server error: %v", err)
		}
	}()

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("analytics-service shutting down…")
	cancel()
	srv.Shutdown(context.Background())
	log.Println("analytics-service stopped")
}
