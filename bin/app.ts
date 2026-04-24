import 'dotenv/config';
import * as cdk from 'aws-cdk-lib';
import { TwelvelabsProjectStack } from '../lib/twelvelabs-project-stack';

const apiKey = process.env.TWELVELABS_API_KEY;
const indexId = process.env.TWELVELABS_INDEX_ID;

if (!apiKey || !indexId) {
  throw new Error('Faltan TWELVELABS_API_KEY y/o TWELVELABS_INDEX_ID en .env');
}

const app = new cdk.App();
new TwelvelabsProjectStack(app, 'TwelvelabsProjectStack', {
  twelvelabsApiKey: apiKey,
  twelvelabsIndexId: indexId,
});
