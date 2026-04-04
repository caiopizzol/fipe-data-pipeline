<p align="center">
  <img src="https://fipe.chat/favicon.svg" width="80" height="80" alt="fipe.chat">
</p>

<h1 align="center">FIPE Data Pipeline</h1>

<p align="center">
  Coleta e processa dados históricos de preços de veículos da Tabela FIPE para PostgreSQL.
  <br>
  Parte do <a href="https://fipe.chat">fipe.chat</a> — os dados que a FIPE tem, a clareza que ela nunca deu.
</p>

<p align="center">
  <a href="https://github.com/caiopizzol/fipe-data-pipeline/releases"><img src="https://img.shields.io/github/v/release/caiopizzol/fipe-data-pipeline" alt="Release"></a>
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/bun-1.x-f472b6" alt="Bun"></a>
  <a href="https://biomejs.dev"><img src="https://img.shields.io/badge/biome-linter-60a5fa" alt="Biome"></a>
</p>

## Requisitos

- [Bun](https://bun.sh) — `brew install oven-sh/bun/bun`
- Docker

## Início Rápido

```bash
cp .env.example .env
docker compose up -d   # PostgreSQL
bun install            # dependências
bun run db:push        # schema
bun run crawl          # crawl
```

## Comandos

```bash
bun install            # Instalar dependências
bun run db:push        # Criar/atualizar schema
bun run crawl          # Executar crawler
bun run status         # Estatísticas do banco
bun run classify       # Classificar modelos via AI
bun run lint           # Verificar código
bun run format         # Formatar código
bun run typecheck      # Verificar tipos
```

## Uso

```bash
bun run crawl                                    # ano atual, todos os meses
bun run crawl -- --year 2024                     # ano específico
bun run crawl -- --year 2020-2024                # range de anos
bun run crawl -- --year 2020,2022,2024           # anos específicos
bun run crawl -- --month 1-6                     # range de meses
bun run crawl -- --year 2023-2024 --month 1,6,12 # combinar filtros
bun run crawl -- --brand 59                      # marca específica (59 = VW)
bun run crawl -- --brand 21,22,59                # múltiplas marcas
bun run crawl -- --brand 59 --model 5940         # modelo específico
bun run crawl -- --reference 328                 # tabela de referência específica
bun run crawl -- --classify                      # classificar modelos novos via AI
bun run crawl -- --force                         # re-buscar tudo
ALLOWED_BRANDS=21,22,23 bun run crawl            # limitar marcas via env

bun run status                                   # estatísticas do banco
bun run classify                                 # classificar modelos sem segmento
bun run classify -- --dry-run                    # preview da classificação
```

## Docker

```bash
docker build -t fipe-crawler .
docker run -d --name fipe --env-file .env fipe-crawler

docker exec fipe bun src/index.ts crawl --brand 25 --year 2024 --month 6
docker exec fipe bun src/index.ts status
```

## Configuração

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5433/fipe
RATE_LIMIT_MS=800        # Delay mínimo entre requests (ms)
MAX_THROTTLE_MS=5000     # Delay máximo quando rate limited (ms)
MAX_RETRIES=3
ALLOWED_BRANDS=          # Códigos FIPE de marcas, separados por vírgula (opcional)
ANTHROPIC_API_KEY=       # Para classificação de segmentos via AI (opcional)
```

## Schema

```mermaid
flowchart LR
    reference_tables --> prices
    brands --> models --> model_years --> prices
```

Schema SQL completo em [`initial.sql`](./initial.sql).

## Fonte de Dados

Estes dados são **públicos e oficiais**, disponibilizados pela Fundação Instituto de Pesquisas Econômicas (FIPE).

| | |
|---|---|
| **Fonte** | [veiculos.fipe.org.br](https://veiculos.fipe.org.br) |
| **Atualização** | Mensal (desde 2001) |
| **Cobertura** | Carros, motos, caminhões e utilitários |
| **Uso** | Referência para seguros, financiamentos, IPVA e negociação de veículos |

A Tabela FIPE é a referência de preço médio de veículos mais utilizada no Brasil. Os dados são coletados mensalmente junto a concessionárias, revendedoras e fabricantes em todo o país.

## Contribuidores

<a href="https://github.com/caiopizzol"><img src="https://github.com/caiopizzol.png" width="50" height="50" alt="caiopizzol" title="Caio Pizzol" /></a>
