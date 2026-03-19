package db

import (
	"context"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

const (
	dbName         = "urlshortener"
	collectionName = "urls"
)

// URLRecord is the document stored in MongoDB.
type URLRecord struct {
	Slug      string    `bson:"slug"`
	LongURL   string    `bson:"longUrl"`
	CreatedAt time.Time `bson:"createdAt"`
}

// NewMongoClient creates and verifies a MongoDB client connection.
func NewMongoClient(ctx context.Context, uri string) (*mongo.Client, error) {
	clientOpts := options.Client().ApplyURI(uri)
	client, err := mongo.Connect(ctx, clientOpts)
	if err != nil {
		return nil, err
	}
	if err := client.Ping(ctx, nil); err != nil {
		return nil, err
	}
	return client, nil
}

// InsertURL persists a URLRecord into the urls collection.
func InsertURL(ctx context.Context, client *mongo.Client, record URLRecord) error {
	coll := client.Database(dbName).Collection(collectionName)
	_, err := coll.InsertOne(ctx, record)
	return err
}

// GetBySlug retrieves a URLRecord by its slug. Returns mongo.ErrNoDocuments if not found.
func GetBySlug(ctx context.Context, client *mongo.Client, slug string) (*URLRecord, error) {
	coll := client.Database(dbName).Collection(collectionName)
	var record URLRecord
	err := coll.FindOne(ctx, bson.M{"slug": slug}).Decode(&record)
	if err != nil {
		return nil, err
	}
	return &record, nil
}
