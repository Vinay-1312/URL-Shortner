#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { UrlShortenerStack } from "../lib/url-shortener-stack";

const app = new cdk.App();

new UrlShortenerStack(app, "UrlShortenerStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
  },
  description: "URL Shortener — ECS Fargate + DocumentDB + ElastiCache + RDS + SQS",
});
