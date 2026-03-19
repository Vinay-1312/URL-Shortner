package consumer

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"

	"analytics-service/db"
	"analytics-service/parser"
)

const (
	exchangeName = "url_events"
	exchangeType = "direct"
	routingKey   = "click"
	queueName    = "click_events"
)

// clickMessage matches the JSON payload published by the redirect service.
type clickMessage struct {
	Slug      string `json:"slug"`
	LongURL   string `json:"longUrl"`
	ClickedAt string `json:"clickedAt"`
	IPAddress string `json:"ipAddress"`
	UserAgent string `json:"userAgent"`
	Referrer  string `json:"referrer"`
}

// Consumer listens to RabbitMQ and writes click events to PostgreSQL.
type Consumer struct {
	conn    *amqp.Connection
	channel *amqp.Channel
	pg      *db.PostgresDB
}

// New dials RabbitMQ, declares topology, and returns a Consumer.
func New(uri string, pg *db.PostgresDB) (*Consumer, error) {
	var conn *amqp.Connection
	var err error

	for attempt := 1; attempt <= 5; attempt++ {
		conn, err = amqp.Dial(uri)
		if err == nil {
			break
		}
		log.Printf("[RabbitMQ] connection attempt %d/5 failed: %v", attempt, err)
		time.Sleep(time.Duration(attempt*2) * time.Second)
	}
	if err != nil {
		return nil, fmt.Errorf("could not connect to RabbitMQ: %w", err)
	}

	ch, err := conn.Channel()
	if err != nil {
		conn.Close()
		return nil, fmt.Errorf("failed to open channel: %w", err)
	}

	// Declare topology (idempotent — matches what redirect-service declares)
	if err := ch.ExchangeDeclare(exchangeName, exchangeType, true, false, false, false, nil); err != nil {
		ch.Close()
		conn.Close()
		return nil, fmt.Errorf("failed to declare exchange: %w", err)
	}

	if _, err := ch.QueueDeclare(queueName, true, false, false, false, nil); err != nil {
		ch.Close()
		conn.Close()
		return nil, fmt.Errorf("failed to declare queue: %w", err)
	}

	if err := ch.QueueBind(queueName, routingKey, exchangeName, false, nil); err != nil {
		ch.Close()
		conn.Close()
		return nil, fmt.Errorf("failed to bind queue: %w", err)
	}

	// Prefetch one message at a time
	if err := ch.Qos(1, 0, false); err != nil {
		ch.Close()
		conn.Close()
		return nil, fmt.Errorf("failed to set QoS: %w", err)
	}

	log.Printf("[Consumer] ready — queue=%q", queueName)
	return &Consumer{conn: conn, channel: ch, pg: pg}, nil
}

// Start begins consuming messages. Blocks until ctx is cancelled.
func (c *Consumer) Start(ctx context.Context) error {
	msgs, err := c.channel.Consume(queueName, "", false, false, false, false, nil)
	if err != nil {
		return fmt.Errorf("failed to start consuming: %w", err)
	}

	log.Println("[Consumer] waiting for messages…")

	for {
		select {
		case <-ctx.Done():
			log.Println("[Consumer] shutting down")
			return nil

		case msg, ok := <-msgs:
			if !ok {
				return fmt.Errorf("message channel closed unexpectedly")
			}
			c.process(msg)
		}
	}
}

func (c *Consumer) process(msg amqp.Delivery) {
	var payload clickMessage
	if err := json.Unmarshal(msg.Body, &payload); err != nil {
		log.Printf("[Consumer] failed to unmarshal message: %v — nacking", err)
		msg.Nack(false, false) // discard malformed message
		return
	}

	clickedAt, err := time.Parse(time.RFC3339, payload.ClickedAt)
	if err != nil {
		clickedAt = time.Now().UTC()
	}

	ua := parser.Parse(payload.UserAgent)

	record := db.ClickRecord{
		Slug:           payload.Slug,
		LongURL:        payload.LongURL,
		ClickedAt:      clickedAt,
		IPAddress:      payload.IPAddress,
		UserAgent:      payload.UserAgent,
		Referrer:       payload.Referrer,
		Browser:        ua.Browser,
		BrowserVersion: ua.BrowserVersion,
		OS:             ua.OS,
		DeviceType:     ua.DeviceType,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := c.pg.InsertClick(ctx, record); err != nil {
		log.Printf("[Consumer] failed to insert click for slug %q: %v — requeueing", payload.Slug, err)
		msg.Nack(false, true) // requeue
		return
	}

	msg.Ack(false)
	log.Printf("[Consumer] recorded click — slug=%q device=%s browser=%s", payload.Slug, ua.DeviceType, ua.Browser)
}

// Close shuts down the AMQP channel and connection.
func (c *Consumer) Close() {
	if c.channel != nil {
		c.channel.Close()
	}
	if c.conn != nil {
		c.conn.Close()
	}
}
