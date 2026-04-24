# TwelveLabs Pegasus 1.2 — Análisis de goles en AWS

Sube un `.mp4` a S3 y obtén automáticamente un JSON con los goles detectados por Pegasus 1.2.

## Prerequisitos

- Node.js 20+
- AWS CLI configurado (`aws configure`)
- Cuenta en [TwelveLabs Playground](https://playground.twelvelabs.io/) con un index Pegasus 1.2 creado y una API key

## Instalación

```bash
npm install
```

## Configuración

```bash
cp .env.example .env
```

Editar `.env` con los valores reales:

```
TWELVELABS_API_KEY=tlk_xxx
TWELVELABS_INDEX_ID=65abc...
```

## Deploy

```bash
npm run deploy
```

La primera vez hay que hacer bootstrap del CDK si no se hizo antes:

```bash
npx cdk bootstrap
```

## Uso

Subir un video al prefijo `input/` del bucket:

```bash
aws s3 cp partido.mp4 s3://twelvelabs-project/input/
```

Revisar el resultado en `output/` (puede tardar varios minutos):

```bash
aws s3 ls s3://twelvelabs-project/output/
aws s3 cp s3://twelvelabs-project/output/<archivo>.json .
```

## Ver logs

```bash
aws logs tail /aws/lambda/TwelvelabsProjectStack-AnalyzeVideoFunction --follow
```

## Limpieza

```bash
npm run destroy
```

## Limitaciones

- Pegasus acepta videos de hasta 1 hora / 2 GB. Para partidos completos, partir el video antes de subir.
- La Lambda tiene timeout de 15 minutos. Si el análisis tarda más, va a fallar.
- La API key vive en env var de Lambda en texto plano (suficiente para pruebas).
