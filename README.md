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
bun src/index.ts refresh --backup # Publicar novas tabelas completas e fazer backup
bun run backup         # Backup (pg_dump) para storage S3/R2 com retenção
bun run restore-drill  # Restaura o último backup num banco temporário e valida
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

bun run status                                   # estatísticas do banco
bun run classify                                 # classificar modelos sem segmento
bun run classify -- --dry-run                    # preview da classificação
```

## Monthly refresh

The public site reads `latest_prices`, which only includes reference tables with
`reference_tables.published_at IS NOT NULL`. Use the refresh command for the monthly publication
flow:

```bash
bun src/index.ts refresh --backup
```

`refresh` takes a session-level Postgres advisory lock named `fipe_refresh`. If another refresh is
already running, it logs that state and exits `0`, which is expected when a long crawl overlaps the
next cron tick. It publishes only official reference tables newer than the latest published month,
oldest first. Each candidate is crawled, then published only when checkpoint backlog is zero and its
price count is at least 90% of the previous published reference's price count. Failed crawl or
validation exits `1` without setting `published_at`, so the next run resumes from checkpoints.
If a materialized-view refresh fails after `published_at` is set, a later refresh run retries
`latest_prices` before reporting success.

Set `HC_REFRESH_URL` to enable best-effort healthchecks: `/start` after the advisory lock is
acquired, the base URL on success, and `/fail` on failure. Lock-held no-op ticks ping nothing, so a
wedged multi-day run shows up as a missed ping instead of being masked by daily "already running"
successes; configure the check with a generous grace period (>= 36h) since a catch-up crawl can run
for many hours. Healthcheck failures never fail the refresh. With `--backup`,
the existing backup job runs whenever any published reference has not yet been backed up, so
transient backup failures are retried on later cron ticks.

Intended Moor cron:

```cron
30 7 1-10 * * setsid nohup bun src/index.ts refresh --backup >/proc/1/fd/1 2>&1 </dev/null &
```

The command detaches because Moor kills cron execs after 10 minutes and a
catch-up crawl runs for hours (observed: exec timeout terminated the process
tree at 600000ms). The cron run itself always exits 0 immediately; completion
and failure are reported by the Healthchecks pings and by the DB markers
(`published_at`, `latest_prices_refreshed_at`, `backup_completed_at`), and
progress is visible in the container logs. The advisory lock makes a tick that
fires while a previous refresh is still running a silent no-op.

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
ANTHROPIC_API_KEY=       # Para classificação de segmentos via AI (opcional)
HC_REFRESH_URL=          # Healthchecks opcional para refresh mensal

# Backup para storage S3-compatível (opcional; usado por backup/restore-drill)
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_ENDPOINT=             # ex: https://<account>.r2.cloudflarestorage.com
R2_BUCKET=
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
