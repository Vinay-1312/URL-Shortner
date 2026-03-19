import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecsPatterns from "aws-cdk-lib/aws-ecs-patterns";
import * as elasticache from "aws-cdk-lib/aws-elasticache";
import * as docdb from "aws-cdk-lib/aws-docdb";
import * as rds from "aws-cdk-lib/aws-rds";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as logs from "aws-cdk-lib/aws-logs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { Duration, RemovalPolicy } from "aws-cdk-lib";

export class UrlShortenerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ── VPC ─────────────────────────────────────────────────────────────────
    const vpc = new ec2.Vpc(this, "UrlShortenerVpc", {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        { name: "Public",   subnetType: ec2.SubnetType.PUBLIC,            cidrMask: 24 },
        { name: "Private",  subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
        { name: "Isolated", subnetType: ec2.SubnetType.PRIVATE_ISOLATED,  cidrMask: 24 },
      ],
    });

    // ── Security Groups ─────────────────────────────────────────────────────
    const albSg = new ec2.SecurityGroup(this, "AlbSg", { vpc, description: "ALB" });
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80),  "HTTP");
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "HTTPS");

    const ecsSg = new ec2.SecurityGroup(this, "EcsSg", { vpc, description: "ECS services" });
    ecsSg.addIngressRule(albSg, ec2.Port.allTcp(), "From ALB");

    const redisSg = new ec2.SecurityGroup(this, "RedisSg", { vpc, description: "ElastiCache Redis" });
    redisSg.addIngressRule(ecsSg, ec2.Port.tcp(6379), "From ECS");

    const docdbSg = new ec2.SecurityGroup(this, "DocDbSg", { vpc, description: "DocumentDB" });
    docdbSg.addIngressRule(ecsSg, ec2.Port.tcp(27017), "From ECS");

    const rdsSg = new ec2.SecurityGroup(this, "RdsSg", { vpc, description: "RDS PostgreSQL" });
    rdsSg.addIngressRule(ecsSg, ec2.Port.tcp(5432), "From ECS");

    // ── Secrets ─────────────────────────────────────────────────────────────
    const docdbSecret = new secretsmanager.Secret(this, "DocDbSecret", {
      secretName: "url-shortener/docdb",
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: "root" }),
        generateStringKey: "password",
        excludePunctuation: true,
      },
    });

    const rdsSecret = new secretsmanager.Secret(this, "RdsSecret", {
      secretName: "url-shortener/rds",
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: "analytics" }),
        generateStringKey: "password",
        excludePunctuation: true,
      },
    });

    // ── Amazon DocumentDB (MongoDB-compatible) ───────────────────────────────
    const docdbSubnetGroup = new docdb.CfnDBSubnetGroup(this, "DocDbSubnetGroup", {
      dbSubnetGroupDescription: "DocumentDB subnet group",
      subnetIds: vpc.isolatedSubnets.map((s) => s.subnetId),
    });

    const docdbCluster = new docdb.DatabaseCluster(this, "DocDbCluster", {
      masterUser: {
        username: "root",
        password: docdbSecret.secretValueFromJson("password"),
      },
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM),
      instances: 1,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroup: docdbSg,
      removalPolicy: RemovalPolicy.DESTROY, // change to RETAIN for production
      deletionProtection: false,
    });

    // ── ElastiCache Redis ────────────────────────────────────────────────────
    const redisSubnetGroup = new elasticache.CfnSubnetGroup(this, "RedisSubnetGroup", {
      description: "Redis subnet group",
      subnetIds: vpc.privateSubnets.map((s) => s.subnetId),
    });

    const redisCluster = new elasticache.CfnReplicationGroup(this, "RedisCluster", {
      replicationGroupDescription: "URL Shortener Redis",
      numCacheClusters: 2,
      cacheNodeType: "cache.t3.micro",
      engine: "redis",
      engineVersion: "7.0",
      automaticFailoverEnabled: true,
      cacheSubnetGroupName: redisSubnetGroup.ref,
      securityGroupIds: [redisSg.securityGroupId],
      atRestEncryptionEnabled: true,
      transitEncryptionEnabled: true,
    });

    const redisEndpoint = redisCluster.attrPrimaryEndPointAddress;
    const redisPort = redisCluster.attrPrimaryEndPointPort;

    // ── Amazon SQS (replaces RabbitMQ) ──────────────────────────────────────
    const clickEventsDlq = new sqs.Queue(this, "ClickEventsDlq", {
      queueName: "click-events-dlq",
      retentionPeriod: Duration.days(14),
    });

    const clickEventsQueue = new sqs.Queue(this, "ClickEventsQueue", {
      queueName: "click-events",
      visibilityTimeout: Duration.seconds(30),
      deadLetterQueue: {
        queue: clickEventsDlq,
        maxReceiveCount: 3,
      },
    });

    // ── RDS PostgreSQL ───────────────────────────────────────────────────────
    const analyticsDb = new rds.DatabaseInstance(this, "AnalyticsDb", {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16,
      }),
      credentials: rds.Credentials.fromSecret(rdsSecret),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      databaseName: "analytics",
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [rdsSg],
      removalPolicy: RemovalPolicy.DESTROY,
      deletionProtection: false,
      backupRetention: Duration.days(7),
    });

    // ── ECS Cluster ──────────────────────────────────────────────────────────
    const cluster = new ecs.Cluster(this, "Cluster", {
      vpc,
      containerInsights: true,
    });

    const logGroup = new logs.LogGroup(this, "ServiceLogs", {
      logGroupName: "/url-shortener/services",
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // ── ALB ──────────────────────────────────────────────────────────────────
    const alb = new elbv2.ApplicationLoadBalancer(this, "Alb", {
      vpc,
      internetFacing: true,
      securityGroup: albSg,
    });

    const listener = alb.addListener("HttpListener", {
      port: 80,
      defaultAction: elbv2.ListenerAction.fixedResponse(404, {
        contentType: "application/json",
        messageBody: '{"error":"not found"}',
      }),
    });

    // ── Helper: build common env vars ────────────────────────────────────────
    const docdbUri = `mongodb://root:${docdbSecret.secretValueFromJson("password").unsafeUnwrap()}@${docdbCluster.clusterEndpoint.hostname}:27017/urlshortener?tls=true&tlsCAFile=/etc/ssl/certs/ca-bundle.crt&replicaSet=rs0&readPreference=secondaryPreferred&retryWrites=false`;
    const redisAddr = `${redisEndpoint}:${redisPort}`;

    // ── Creation Service ─────────────────────────────────────────────────────
    const creationTaskDef = new ecs.FargateTaskDefinition(this, "CreationTaskDef", {
      cpu: 256,
      memoryLimitMiB: 512,
    });

    creationTaskDef.addContainer("creation-service", {
      // Replace with your ECR image URI after pushing
      image: ecs.ContainerImage.fromRegistry("your-account.dkr.ecr.us-east-1.amazonaws.com/creation-service:latest"),
      environment: {
        PORT:       "8080",
        MONGO_URI:  docdbUri,
        REDIS_ADDR: redisAddr,
      },
      portMappings: [{ containerPort: 8080 }],
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "creation", logGroup }),
      healthCheck: {
        command: ["CMD-SHELL", "wget -qO- http://localhost:8080/health || exit 1"],
        interval: Duration.seconds(15),
        timeout: Duration.seconds(5),
        retries: 3,
      },
    });

    const creationService = new ecs.FargateService(this, "CreationService", {
      cluster,
      taskDefinition: creationTaskDef,
      desiredCount: 2,
      securityGroups: [ecsSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    });

    listener.addTargets("CreationTarget", {
      priority: 10,
      conditions: [
        elbv2.ListenerCondition.httpRequestMethods(["POST"]),
        elbv2.ListenerCondition.pathPatterns(["/api/shorten"]),
      ],
      targets: [creationService],
      port: 8080,
      protocol: elbv2.ApplicationProtocol.HTTP,
      healthCheck: { path: "/health" },
    });

    // ── Redirect Service ─────────────────────────────────────────────────────
    const redirectTaskDef = new ecs.FargateTaskDefinition(this, "RedirectTaskDef", {
      cpu: 256,
      memoryLimitMiB: 512,
    });

    redirectTaskDef.addContainer("redirect-service", {
      image: ecs.ContainerImage.fromRegistry("your-account.dkr.ecr.us-east-1.amazonaws.com/redirect-service:latest"),
      environment: {
        PORT:          "8081",
        MONGO_URI:     docdbUri,
        REDIS_ADDR:    redisAddr,
        SQS_QUEUE_URL: clickEventsQueue.queueUrl,
      },
      portMappings: [{ containerPort: 8081 }],
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "redirect", logGroup }),
      healthCheck: {
        command: ["CMD-SHELL", "wget -qO- http://localhost:8081/health || exit 1"],
        interval: Duration.seconds(15),
        timeout: Duration.seconds(5),
        retries: 3,
      },
    });

    const redirectService = new ecs.FargateService(this, "RedirectService", {
      cluster,
      taskDefinition: redirectTaskDef,
      desiredCount: 2,
      securityGroups: [ecsSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    });

    // Grant redirect service permission to publish to SQS
    clickEventsQueue.grantSendMessages(redirectTaskDef.taskRole);

    listener.addTargets("RedirectTarget", {
      priority: 20,
      conditions: [
        elbv2.ListenerCondition.httpRequestMethods(["GET"]),
        elbv2.ListenerCondition.pathPatterns(["/r/*"]),
      ],
      targets: [redirectService],
      port: 8081,
      protocol: elbv2.ApplicationProtocol.HTTP,
      healthCheck: { path: "/health" },
    });

    // ── Analytics Service ────────────────────────────────────────────────────
    const analyticsTaskDef = new ecs.FargateTaskDefinition(this, "AnalyticsTaskDef", {
      cpu: 256,
      memoryLimitMiB: 512,
    });

    analyticsTaskDef.addContainer("analytics-service", {
      image: ecs.ContainerImage.fromRegistry("your-account.dkr.ecr.us-east-1.amazonaws.com/analytics-service:latest"),
      environment: {
        PORT:          "8082",
        SQS_QUEUE_URL: clickEventsQueue.queueUrl,
        POSTGRES_URI:  `postgres://analytics:${rdsSecret.secretValueFromJson("password").unsafeUnwrap()}@${analyticsDb.instanceEndpoint.hostname}:5432/analytics?sslmode=require`,
      },
      portMappings: [{ containerPort: 8082 }],
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "analytics", logGroup }),
    });

    const analyticsService = new ecs.FargateService(this, "AnalyticsService", {
      cluster,
      taskDefinition: analyticsTaskDef,
      desiredCount: 1,
      securityGroups: [ecsSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    });

    // Grant analytics service permission to consume from SQS
    clickEventsQueue.grantConsumeMessages(analyticsTaskDef.taskRole);

    // ── Auto Scaling ─────────────────────────────────────────────────────────
    const creationScaling = creationService.autoScaleTaskCount({ minCapacity: 2, maxCapacity: 10 });
    creationScaling.scaleOnCpuUtilization("CreationCpuScaling", {
      targetUtilizationPercent: 70,
      scaleInCooldown: Duration.seconds(60),
      scaleOutCooldown: Duration.seconds(30),
    });

    const redirectScaling = redirectService.autoScaleTaskCount({ minCapacity: 2, maxCapacity: 20 });
    redirectScaling.scaleOnCpuUtilization("RedirectCpuScaling", {
      targetUtilizationPercent: 70,
      scaleInCooldown: Duration.seconds(60),
      scaleOutCooldown: Duration.seconds(30),
    });

    // ── S3 + CloudFront (Frontend) ───────────────────────────────────────────
    const frontendBucket = new s3.Bucket(this, "FrontendBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const distribution = new cloudfront.Distribution(this, "FrontendCdn", {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(frontendBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      additionalBehaviors: {
        // API calls bypass CloudFront cache and go straight to ALB
        "/api/*": {
          origin: new origins.HttpOrigin(alb.loadBalancerDnsName, { protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        },
        "/r/*": {
          origin: new origins.HttpOrigin(alb.loadBalancerDnsName, { protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        },
      },
      defaultRootObject: "index.html",
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: "/index.html" },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: "/index.html" },
      ],
    });

    // ── Outputs ──────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, "CloudFrontUrl", {
      value: `https://${distribution.distributionDomainName}`,
      description: "Frontend URL",
    });

    new cdk.CfnOutput(this, "AlbDnsName", {
      value: alb.loadBalancerDnsName,
      description: "ALB DNS — API endpoint",
    });

    new cdk.CfnOutput(this, "SqsQueueUrl", {
      value: clickEventsQueue.queueUrl,
      description: "SQS click events queue",
    });

    new cdk.CfnOutput(this, "DocumentDbEndpoint", {
      value: docdbCluster.clusterEndpoint.hostname,
      description: "DocumentDB cluster endpoint",
    });

    new cdk.CfnOutput(this, "RdsEndpoint", {
      value: analyticsDb.instanceEndpoint.hostname,
      description: "RDS PostgreSQL endpoint",
    });
  }
}
