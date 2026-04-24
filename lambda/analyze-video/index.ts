import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { S3Event } from 'aws-lambda';

const s3 = new S3Client({});

const TWELVELABS_API_KEY = process.env.TWELVELABS_API_KEY!;
const TWELVELABS_INDEX_ID = process.env.TWELVELABS_INDEX_ID!;
const OUTPUT_BUCKET = process.env.OUTPUT_BUCKET!;
const OUTPUT_PREFIX = process.env.OUTPUT_PREFIX!;

const TWELVELABS_BASE = 'https://api.twelvelabs.io/v1.3';
const POLL_INTERVAL_MS = 10_000;
const POLL_TIMEOUT_MS = 12 * 60 * 1000;

async function tlFetch(path: string, options: RequestInit = {}): Promise<Response> {
  return fetch(`${TWELVELABS_BASE}${path}`, {
    ...options,
    headers: {
      'x-api-key': TWELVELABS_API_KEY,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
}

async function uploadToTwelveLabs(videoUrl: string): Promise<string> {
  const res = await tlFetch('/tasks', {
    method: 'POST',
    body: JSON.stringify({
      index_id: TWELVELABS_INDEX_ID,
      video_url: videoUrl,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`TwelveLabs task creation failed (${res.status}): ${body}`);
  }

  const data = await res.json() as { _id: string };
  console.log('Task created:', data._id);
  return data._id;
}

async function pollUntilReady(taskId: string): Promise<string> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const res = await tlFetch(`/tasks/${taskId}`);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`TwelveLabs poll failed (${res.status}): ${body}`);
    }

    const data = await res.json() as { status: string; video_id?: string };
    console.log(`Task ${taskId} status: ${data.status}`);

    if (data.status === 'ready') {
      if (!data.video_id) throw new Error('Task ready but no video_id returned');
      return data.video_id;
    }

    if (data.status === 'failed') {
      throw new Error(`TwelveLabs task ${taskId} failed`);
    }

    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error(`Polling timeout after ${POLL_TIMEOUT_MS / 1000}s for task ${taskId}`);
}

async function analyzeWithPegasus(videoId: string): Promise<unknown> {
  const prompt = [
    'Analyze this soccer match video.',
    'Identify every goal scored.',
    'Return ONLY a valid JSON object with this schema:',
    '{ "goals": [{ "timestamp_start_seconds": number, "timestamp_end_seconds": number,',
    '"team": "home" | "away" | "unknown", "description": string }], "total_goals": number }.',
    'Do not include any text outside the JSON.',
  ].join(' ');

  const res = await tlFetch('/analyze', {
    method: 'POST',
    body: JSON.stringify({ video_id: videoId, prompt }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`TwelveLabs analyze failed (${res.status}): ${body}`);
  }

  const data = await res.json() as { data?: string };
  const rawText = data.data ?? JSON.stringify(data);

  try {
    return JSON.parse(rawText);
  } catch {
    console.log('Could not parse Pegasus response as JSON, saving raw text');
    return rawText;
  }
}

export async function handler(event: S3Event): Promise<void> {
  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));

    if (!key.endsWith('.mp4')) {
      console.log(`Skipping non-mp4 key: ${key}`);
      continue;
    }

    console.log(`Processing s3://${bucket}/${key}`);

    try {
      const presignedUrl = await getSignedUrl(
        s3,
        new GetObjectCommand({ Bucket: bucket, Key: key }),
        { expiresIn: 3600 },
      );

      const taskId = await uploadToTwelveLabs(presignedUrl);
      const videoId = await pollUntilReady(taskId);
      const result = await analyzeWithPegasus(videoId);

      const videoName = key.replace(/^input\//, '').replace(/\.mp4$/, '');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const outputKey = `${OUTPUT_PREFIX}${videoName}-${timestamp}.json`;

      const output = {
        source_video: key,
        analyzed_at: new Date().toISOString(),
        twelvelabs_video_id: videoId,
        twelvelabs_task_id: taskId,
        result,
      };

      await s3.send(new PutObjectCommand({
        Bucket: OUTPUT_BUCKET,
        Key: outputKey,
        Body: JSON.stringify(output, null, 2),
        ContentType: 'application/json',
      }));

      console.log(`Result saved to s3://${OUTPUT_BUCKET}/${outputKey}`);
    } catch (err) {
      console.error(`Error processing ${key}:`, err);
      throw err;
    }
  }
}
