import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import * as path from 'path';

interface TwelvelabsProjectStackProps extends cdk.StackProps {
  twelvelabsApiKey: string;
  twelvelabsIndexId: string;
}

export class TwelvelabsProjectStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: TwelvelabsProjectStackProps) {
    super(scope, id, props);

    const bucket = new s3.Bucket(this, 'TwelvelabsBucket', {
      bucketName: 'twelvelabs-project',
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const analyzeVideoFn = new lambdaNodejs.NodejsFunction(this, 'AnalyzeVideoFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../lambda/analyze-video/index.ts'),
      handler: 'handler',
      timeout: cdk.Duration.minutes(15),
      memorySize: 512,
      environment: {
        TWELVELABS_API_KEY: props.twelvelabsApiKey,
        TWELVELABS_INDEX_ID: props.twelvelabsIndexId,
        OUTPUT_BUCKET: bucket.bucketName,
        OUTPUT_PREFIX: 'output/',
      },
      bundling: {
        externalModules: [],
      },
      // sin reintentos automáticos — cada fallo se investiga en los logs
      maxEventAge: cdk.Duration.hours(1),
      retryAttempts: 0,
    });

    bucket.addToResourcePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      principals: [analyzeVideoFn.grantPrincipal],
      actions: ['s3:GetObject'],
      resources: [bucket.arnForObjects('input/*')],
    }));

    bucket.grantPut(analyzeVideoFn, 'output/*');
    bucket.grantRead(analyzeVideoFn, 'input/*');

    bucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(analyzeVideoFn),
      { prefix: 'input/', suffix: '.mp4' },
    );
  }
}
