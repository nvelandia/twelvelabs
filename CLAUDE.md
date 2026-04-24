# CLAUDE.md

Este archivo guía a Claude Code (claude.ai/code) para trabajar en este repositorio.

## Descripción del proyecto

Proyecto de prueba en **AWS CDK con TypeScript** para experimentar con **Pegasus 1.2 de TwelveLabs**. Cuando se sube un `.mp4` a un bucket S3, se dispara una Lambda que envía el video a TwelveLabs, le pregunta por los goles del partido, y guarda el JSON resultante en el mismo bucket.

Es un proyecto **exploratorio**: prioriza simplicidad sobre buenas prácticas de producción.

## Arquitectura

```
S3 (twelvelabs-project)
├── input/video.mp4  ──► trigger ──► Lambda ──► TwelveLabs API (Pegasus 1.2)
└── output/video.json ◄──────────────── guarda respuesta
```

## Stack técnico

- AWS CDK v2 con TypeScript
- Lambda en Node.js 20.x usando `NodejsFunction` (bundling automático con esbuild)
- AWS SDK v3 (`@aws-sdk/client-s3`)
- TwelveLabs: llamadas HTTP directas con `fetch` nativo de Node 20 (sin SDK, para tener una dependencia menos)
- `dotenv` para cargar variables de entorno en el CDK app
- npm

## Prerequisito manual: crear el index en TwelveLabs

Antes de deployar, hay que crear un **index** en TwelveLabs. Un index es el contenedor donde viven los videos dentro de la cuenta de TwelveLabs; se crea una sola vez y se reutiliza para todos los videos.

Pasos:
1. Crear cuenta en https://playground.twelvelabs.io/
2. Ir a "Indexes" → "Create index"
3. Elegir modelo **Pegasus 1.2**
4. Copiar el **Index ID** que genera (algo como `65abc123...`)
5. Copiar también la **API Key** desde el panel de API Keys

Esos dos valores van en un archivo `.env` en la raíz del proyecto (ver `.env.example`).

## Estructura del proyecto

```
.
├── CLAUDE.md
├── README.md
├── cdk.json
├── package.json
├── tsconfig.json
├── .gitignore
├── .env                          ← NO commitear (contiene credenciales)
├── .env.example                  ← sí commitear (plantilla vacía)
├── bin/
│   └── app.ts
├── lib/
│   └── twelvelabs-project-stack.ts
└── lambda/
    └── analyze-video/
        └── index.ts
```

## Configuración con `.env`

El proyecto usa un archivo `.env` en la raíz para las credenciales de TwelveLabs. Contenido:

```
TWELVELABS_API_KEY=tlk_xxx
TWELVELABS_INDEX_ID=65abc...
```

El entrypoint `bin/app.ts` carga el `.env` con `dotenv` al arrancar, y pasa los valores al stack como props. El stack los inyecta como variables de entorno de la Lambda.

```typescript
// bin/app.ts
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
```

**Importante**: `.env` debe estar en `.gitignore`. Commitear solo `.env.example` como plantilla.

## Stack CDK

### Bucket S3

- Nombre: `twelvelabs-project` (si está tomado globalmente, el CDK va a fallar; en ese caso, sufijar con account id).
- `blockPublicAccess: BLOCK_ALL`
- `removalPolicy: DESTROY` + `autoDeleteObjects: true` (es un proyecto de prueba, queremos que `cdk destroy` limpie todo).
- Trigger S3: `s3:ObjectCreated:*` con filtro de prefijo `input/` y sufijo `.mp4` → invoca la Lambda.
- Los "folders" `input/` y `output/` son prefijos, se crean solos al primer uso. No hace falta crearlos explícitamente.

### Lambda `analyze-video`

- Runtime: `Runtime.NODEJS_20_X`
- Construct: `NodejsFunction`
- Timeout: 15 minutos (máximo)
- Memoria: 512 MB
- Variables de entorno (inyectadas desde las props del stack, que a su vez vienen del `.env`):
  - `TWELVELABS_API_KEY`
  - `TWELVELABS_INDEX_ID`
  - `OUTPUT_BUCKET`: nombre del bucket
  - `OUTPUT_PREFIX`: `output/`
- Permisos: `s3:GetObject` sobre `input/*`, `s3:PutObject` sobre `output/*`.

## Lógica de la Lambda

Flujo simple, todo en un solo archivo `index.ts`:

1. **Parsear evento S3** → sacar `bucket` y `key`.
2. **Generar URL prefirmada** del video con `getSignedUrl` (1 hora de expiración). Esto es para que TwelveLabs pueda descargarlo sin credenciales.
3. **Subir video a TwelveLabs**: `POST https://api.twelvelabs.io/v1.3/tasks` con body:
   ```json
   {
     "index_id": "...",
     "video_url": "<url prefirmada>"
   }
   ```
   Header: `x-api-key: <API_KEY>`. Devuelve un `_id` (task id).
4. **Polling** del estado: `GET /v1.3/tasks/{task_id}` cada 10 segundos hasta que `status === "ready"`. Loguear en cada intento. Timeout razonable (ej. 12 minutos).
5. Cuando esté listo, la respuesta trae un `video_id`.
6. **Llamar a Pegasus**: `POST /v1.3/analyze` con body:
   ```json
   {
     "video_id": "...",
     "prompt": "Analyze this soccer match video. Identify every goal scored. Return ONLY a valid JSON object with this schema: { \"goals\": [{ \"timestamp_start_seconds\": number, \"timestamp_end_seconds\": number, \"team\": \"home\" | \"away\" | \"unknown\", \"description\": string }], \"total_goals\": number }. Do not include any text outside the JSON."
   }
   ```
7. **Parsear respuesta**. Pegasus devuelve texto; intentar `JSON.parse`. Si falla, guardar el texto crudo igual (no perder la respuesta por un error de parseo).
8. **Guardar en S3** en `output/<nombre-video>-<timestamp>.json`:
   ```json
   {
     "source_video": "input/partido.mp4",
     "analyzed_at": "2026-04-24T18:30:00Z",
     "twelvelabs_video_id": "...",
     "twelvelabs_task_id": "...",
     "result": { ... } 
   }
   ```

Verificar en docs de TwelveLabs el endpoint exacto y versión de API vigentes (https://docs.twelvelabs.io/), porque pueden haber cambiado nombres de campos.

## Comandos esperados (`package.json`)

- `npm run build` → `tsc`
- `npm run deploy` → `cdk deploy`
- `npm run destroy` → `cdk destroy`
- `npm run synth` → `cdk synth`

## Dependencias esperadas (`package.json`)

```json
{
  "dependencies": {
    "aws-cdk-lib": "^2.x",
    "constructs": "^10.x",
    "dotenv": "^16.x"
  },
  "devDependencies": {
    "@aws-sdk/client-s3": "^3.x",
    "@aws-sdk/s3-request-presigner": "^3.x",
    "@types/aws-lambda": "^8.x",
    "@types/node": "^20.x",
    "aws-cdk": "^2.x",
    "esbuild": "^0.x",
    "typescript": "^5.x"
  }
}
```

Nota: los SDKs de AWS (`@aws-sdk/*`) y los tipos se usan solo dentro del código de la Lambda. Van en `devDependencies` porque `NodejsFunction` los bundlea con esbuild en tiempo de deploy.

## `.gitignore` requerido

```
node_modules/
cdk.out/
*.js
*.d.ts
.env
```

## Convenciones mínimas

- TypeScript strict.
- Logs con `console.log` simple, sin estructurar (es un proyecto de prueba).
- Manejo básico de errores: `try/catch` en el handler, loguear y re-tirar.

## README.md requerido

Cubrir:
1. Prerequisitos: Node 20+, AWS CLI configurado, cuenta TwelveLabs con index + API key.
2. Instalación: `npm install`.
3. Configuración: copiar `.env.example` a `.env` y completar con los valores reales.
4. Deploy: `npm run deploy`.
5. Uso: `aws s3 cp partido.mp4 s3://twelvelabs-project/input/` y después revisar `s3://twelvelabs-project/output/`.
6. Ver logs: `aws logs tail /aws/lambda/<nombre-funcion> --follow`.
7. Limpieza: `npm run destroy`.

## Qué NO hacer

- No commitear `.env` con credenciales reales. Solo `.env.example`.
- No hacer el bucket público.
- No procesar archivos que no sean `.mp4` (el filtro ya lo limita, pero validar por defensa).
- No reaccionar a eventos de `output/` (evitar loops).

## Limitaciones conocidas (documentar en README)

- Pegasus acepta videos de hasta 1 hora / 2 GB. Partidos completos de fútbol pueden exceder esto → partir el video antes de subirlo.
- La Lambda tiene timeout de 15 min. Si el análisis tarda más, va a fallar. En ese caso, re-arquitecturar con Step Functions (fuera del alcance de esta prueba).
- La API key viaja en env var de la Lambda en texto plano. Suficiente para pruebas, no para producción.
