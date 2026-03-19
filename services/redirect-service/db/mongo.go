package db

import (
	"context"
	"errors"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// ErrNotFound is returned when a slug does not exist in MongoDB.
var ErrNotFound = errors.New("slug not found")

const (
	dbName         = "urlshortener"
	collectionName = "urls"
)

// URLDocument mirrors the document shape stored in MongoDB.
type URLDocument struct {
	Slug    string `bson:"slug"`
	LongURL string `bson:"longUrl"`
}

// MongoClient wraps the official mongo driver client.
type MongoClient struct {
	client *mongo.Client
	coll   *mongo.Collection
}

// NewMongoClient dials MongoDB and returns a ready-to-use MongoClient.
func NewMongoClient(uri string) (*MongoClient, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	clientOpts := options.Client().ApplyURI(uri)
	client, err := mongo.Connect(ctx, clientOpts)
	if err != nil {
		return nil, err
	}
	if err := client.Ping(ctx, nil); err != nil {
		return nil, err
	}

	coll := client.Database(dbName).Collection(collectionName)
	return &MongoClient{client: client, coll: coll}, nil
}

// GetBySlug fetches a URL document by its slug.
func (m *MongoClient) GetBySlug(ctx context.Context, slug string) (*URLDocument, error) {
	var doc URLDocument
	err := m.coll.FindOne(ctx, bson.M{"slug": slug}).Decode(&doc)
	if err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &doc, nil
}

// Disconnect cleanly closes the MongoDB connection.
func (m *MongoClient) Disconnect(ctx context.Context) error {
	return m.client.Disconnect(ctx)
}
