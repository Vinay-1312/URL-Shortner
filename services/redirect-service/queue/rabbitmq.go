package queue

import (
	"encoding/json"
	"fmt"
	"log"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
)

const (
	exchangeName = "url_events"
	exchangeType = "direct"
	routingKey   = "click"
	queueName    = "click_events"
)

// ClickEvent is the message payload published on every redirect.
type ClickEvent struct {
	Slug      string `json:"slug"`
	LongURL   string `json:"longUrl"`
	ClickedAt string `json:"clickedAt"`
	IPAddress string `json:"ipAddress"`
	UserAgent string `json:"userAgent"`
	Referrer  string `json:"referrer"`
}

// RabbitMQConnection manages a single AMQP connection and channel.
type RabbitMQConnection struct {
	conn    *amqp.Connection
	channel *amqp.Channel
}

// NewRabbitMQConnection dials RabbitMQ, declares the exchange and queue, binds them.
func NewRabbitMQConnection(uri string) (*RabbitMQConnection, error) {
	var conn *amqp.Connection
	var err error

	// Retry up to 5 times with backoff to tolerate slow RabbitMQ startup
	for attempt := 1; attempt <= 5; attempt++ {
		conn, err = amqp.Dial(uri)
		if err == nil {
			break
		}
		log.Printf("[RabbitMQ] connection attempt %d/5 failed: %v", attempt, err)
		time.Sleep(time.Duration(attempt*2) * time.Second)
	}
	if err != nil {
		return nil, fmt.Errorf("could not connect to RabbitMQ after 5 attempts: %w", err)
	}

	ch, err := conn.Channel()
	if err != nil {
		conn.Close()
		return nil, fmt.Errorf("failed to open channel: %w", err)
	}

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

	log.Printf("[RabbitMQ] connected — exchange=%q queue=%q routingKey=%q", exchangeName, queueName, routingKey)
	return &RabbitMQConnection{conn: conn, channel: ch}, nil
}

// Publish serialises a ClickEvent and sends it to the exchange.
func (r *RabbitMQConnection) Publish(event ClickEvent) error {
	body, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("failed to marshal click event: %w", err)
	}

	return r.channel.Publish(
		exchangeName,
		routingKey,
		false,
		false,
		amqp.Publishing{
			ContentType:  "application/json",
			DeliveryMode: amqp.Persistent,
			Body:         body,
		},
	)
}

// Close shuts down the channel and connection gracefully.
func (r *RabbitMQConnection) Close() {
	if r.channel != nil {
		r.channel.Close()
	}
	if r.conn != nil {
		r.conn.Close()
	}
}
