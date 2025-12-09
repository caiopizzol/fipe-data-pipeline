# FIPE Data Pipeline

Coleta dados de preços de veículos da Tabela FIPE oficial e armazena em PostgreSQL para análise histórica.

## Configuração

```bash
cp .env.example .env
npm install
docker compose up -d
npm run db:push
```

## Uso

```bash
npm run crawl                                    # Coleta todos os dados de 2025
npm run crawl -- --reference 328                 # Mês específico
npm run crawl -- --reference 328 --brand 59      # Marca específica (59 = VW)
npm run crawl -- --classify                      # Classifica novos modelos por segmento (requer ANTHROPIC_API_KEY)
npm run status                                   # Estatísticas do banco
npm run db:shell                                 # Terminal PostgreSQL
```

### Classificação de Segmentos (Opcional)

Classifica modelos por tipo de carroceria (SUV, Sedã, Hatch, etc.) usando IA.

```bash
npm run classify                                 # Classifica todos os modelos sem segmento
npm run classify -- --dry-run                    # Mostra o que seria classificado
npm run classify -- --model 123                  # Classifica modelo específico por ID
```

Requer `ANTHROPIC_API_KEY` no `.env`.

## Fonte de Dados

Dados oficiais da FIPE em `veiculos.fipe.org.br`. Que incluem:

- Tabelas de referência (snapshots mensais desde 2001)
- Marcas, modelos, anos
- Preços por tipo de combustível

## Schema

```
reference_tables → brands → models → model_years → prices
```

Cada registro de preço vincula um veículo (modelo + ano + combustível) a um mês de referência.
