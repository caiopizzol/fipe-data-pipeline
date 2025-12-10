# FIPE Data Pipeline

[![GitHub Release](https://img.shields.io/github/v/release/caiopizzol/fipe-data-pipeline)](https://github.com/caiopizzol/fipe-data-pipeline/releases)

Crawler em TypeScript que coleta dados históricos de preços de veículos da Tabela FIPE e armazena em PostgreSQL.

## O Problema

A FIPE publica preços de veículos todo mês desde 2001, mas:

- **Não existe API oficial** - o site é só consulta manual
- **5 níveis de hierarquia** - mês de referência → marca → modelo → ano/combustível → preço
- **Escala massiva** - 320+ tabelas de referência, 90+ marcas, milhares de modelos
- **Alternativas pagas** - existem, mas sem garantia de confiabilidade dos dados

## Features

- **Throttling inteligente** - 200ms entre requests + retry com backoff exponencial
- **Fallback hierárquico** - se um modelo falha, continua com os outros
- **Upserts idempotentes** - pode rodar de novo sem duplicar dados
- **Classificação por segmento** - categoriza modelos (SUV, Sedã, Hatch, etc.) usando Claude

## Quick Start

```bash
# Sobe o banco
docker compose up -d

# Instala dependências
pnpm install

# Aplica schema
pnpm db:push

# Crawla dados de 2025
pnpm crawl
```

## Uso

```bash
# Crawl completo do ano atual
pnpm crawl

# Filtrar por referência específica
pnpm crawl -- --reference 328

# Filtrar por ano e mês
pnpm crawl -- --year 2024 --month 6

# Filtrar por marca (59 = Volkswagen)
pnpm crawl -- --brand 59

# Filtrar por modelo específico (requer --brand)
pnpm crawl -- --brand 59 --model 5940

# Classificar modelos durante o crawl
pnpm crawl -- --classify

# Ver estatísticas do banco
pnpm status

# Classificar todos os modelos sem segmento
pnpm classify

# Dry-run da classificação
pnpm classify -- --dry-run

# Filtrar por lista de marcas (via env)
ALLOWED_BRANDS=21,22,23 pnpm crawl  # Fiat, Ford, Chevrolet
```

## Docker

```bash
# Build
docker build -t fipe-crawler .

# Ver ajuda
docker run --rm fipe-crawler

# Crawl com filtros
docker run --rm --env-file .env fipe-crawler crawl --brand 25 --year 2024 --month 6

# Crawl completo do ano atual
docker run --rm --env-file .env fipe-crawler crawl
```

## Arquitetura

```
src/
├── fipe/
│   ├── client.ts          # HTTP client com throttling
│   └── schemas.ts         # Validação Zod
├── crawler/
│   └── processor.ts       # Orquestração do crawl
├── db/
│   ├── schema.ts          # Drizzle ORM
│   └── repository.ts      # Upserts
└── classifier/
    └── segment-classifier.ts  # Claude API
```

## Stack

- Node.js 22 + TypeScript
- Drizzle ORM
- PostgreSQL 16
- Zod (validação runtime)

## Schema

```mermaid
flowchart LR
    reference_tables --> prices
    brands --> models --> model_years --> prices
```

**Exemplo:**

| reference_tables | brands     | models   | model_years | prices    |
| ---------------- | ---------- | -------- | ----------- | --------- |
| Jan/2025 (#328)  | Volkswagen | Gol 1.0  | 2020 Flex   | R$ 45.000 |
|                  |            |          | 2021 Flex   | R$ 48.000 |
|                  |            | Polo 1.6 | 2022 Flex   | R$ 72.000 |
| Fev/2025 (#329)  | Volkswagen | Gol 1.0  | 2020 Flex   | R$ 44.500 |

Cada preço vincula um veículo (modelo + ano + combustível) a um mês de referência.

Schema SQL completo em [`initial.sql`](./initial.sql).

## Dados

Fonte oficial: `veiculos.fipe.org.br`

- Tabelas de referência (snapshots mensais desde 2001)
- Marcas, modelos, anos
- Preços por tipo de combustível

## Demo

Veja os dados em ação: [fipe.chat](https://fipe.chat)

## Licença

MIT
