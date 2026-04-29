# CLAUDE.md

Contexto del proyecto para Claude Code.

## Descripción

Proyecto exploratorio en **AWS CDK con TypeScript** que analiza videos de fútbol usando **Pegasus 1.5 de TwelveLabs**. Cuando se sube un `.mp4` al bucket S3, una Lambda genera una URL prefirmada del video, la envía a TwelveLabs para análisis temporal de goles (`time_based_metadata`), y guarda el resultado JSON en el mismo bucket.

Prioriza simplicidad sobre buenas prácticas de producción.

## Arquitectura

```
S3 (twelvelabs-project)
├── input/video.mp4  ──► trigger ──► Lambda ──► TwelveLabs API (Pegasus 1.5)
└── output/video.json ◄──────────────────────── guarda respuesta
```

## Stack técnico

- AWS CDK v2 con TypeScript
- Lambda Node.js 20.x con `NodejsFunction` (bundling con esbuild)
- AWS SDK v3 (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`)
- TwelveLabs: llamadas HTTP directas con `fetch` nativo (sin SDK)
- `dotenv` para variables de entorno en el CDK app

## Estructura

```
.
├── bin/app.ts                          ← entrypoint CDK, carga .env
├── lib/twelvelabs-project-stack.ts     ← stack: S3 + Lambda
└── lambda/analyze-video/index.ts       ← handler de la Lambda
```

## Configuración

Solo requiere `TWELVELABS_API_KEY` en `.env`. No se usa index ni asset_id.

## Flujo de la Lambda

1. Parsear evento S3 → obtener `bucket` y `key`
2. Generar URL prefirmada con `getSignedUrl` (1 hora)
3. `POST /v1.3/analyze/tasks` con body:
   ```json
   {
     "video": { "type": "url", "url": "<presigned_url>" },
     "model_name": "pegasus1.5",
     "analysis_mode": "time_based_metadata",
     "response_format": {
       "type": "segment_definitions",
       "segment_definitions": [{
         "id": "goals",
         "description": "Detect every goal scored...",
         "fields": [
           { "name": "team", "type": "string", "enum": ["home", "away", "unknown"] },
           { "name": "description", "type": "string" },
           { "name": "scorer", "type": "string" }
         ]
       }]
     }
   }
   ```
   → devuelve `{ task_id }`
4. Polling: `GET /v1.3/analyze/tasks/{task_id}` cada 10s hasta `status === "ready"` (timeout 12 min)
5. Parsear `task.result.data` (es un JSON string) con `JSON.parse()`
6. Guardar en `output/<nombre>-<timestamp>.json`

**Importante**: NO incluir `prompt`. El modo `time_based_metadata` no lo soporta y devuelve 400.

## Estructura del output

```json
{
  "source_video": "input/partido.mp4",
  "analyzed_at": "2026-04-28T18:30:00Z",
  "twelvelabs_task_id": "...",
  "model": "pegasus1.5",
  "analysis_mode": "time_based_metadata",
  "result": {
    "goals": [
      {
        "start_time": 118,
        "end_time": 135,
        "metadata": { "team": "home", "description": "...", "scorer": "..." }
      }
    ]
  }
}
```

## Lambda config

- Timeout: 15 min (máximo de Lambda)
- Memoria: 1024 MB
- Variables de entorno: `TWELVELABS_API_KEY`, `OUTPUT_BUCKET`, `OUTPUT_PREFIX`

## Comandos

```bash
npm run build    # tsc
npm run deploy   # cdk deploy
npm run destroy  # cdk destroy
npm run synth    # cdk synth
```

## Limitaciones conocidas

- Pegasus acepta videos de hasta 1 hora / 2 GB — partidos completos pueden exceder esto
- Lambda timeout de 15 min — si el análisis tarda más, falla (solución: Step Functions)
- API key en env var en texto plano — suficiente para pruebas, no para producción
- Si `finish_reason === "length"`, el JSON puede estar truncado
