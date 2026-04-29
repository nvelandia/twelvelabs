import 'dotenv/config';
import * as cdk from 'aws-cdk-lib';
import { TwelvelabsProjectStack } from '../lib/twelvelabs-project-stack';

const apiKey = process.env.TWELVELABS_API_KEY;

if (!apiKey) {
  throw new Error('Falta TWELVELABS_API_KEY en .env');
}

const app = new cdk.App();
new TwelvelabsProjectStack(app, 'TwelvelabsProjectStack', {
  twelvelabsApiKey: apiKey,
});
