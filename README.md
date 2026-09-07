<p align="center">
  <img src="https://fipe.chat/favicon.svg" width="80" height="80" alt="fipe.chat">
</p>

# FIPE Data Pipeline

Coleta preços históricos de carros da [Tabela FIPE](https://veiculos.fipe.org.br) e salva no
PostgreSQL. É o pipeline de dados do [fipe.chat](https://fipe.chat).

Hoje, a coleta usa o tipo 1 da FIPE (carros). Motos e caminhões não estão incluídos.

<p align="center">
  <a href="https://github.com/caiopizzol/fipe-data-pipeline/releases"><img src="https://img.shields.io/github/v/release/caiopizzol/fipe-data-pipeline" alt="Release"></a>
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/bun-1.x-f472b6" alt="Bun"></a>
  <a href="https://vite.plus"><img src="https://img.shields.io/badge/Vite%2B-tooling-646cff" alt="Vite+"></a>
</p>

## Começar

Com [Bun](https://bun.sh) e Docker instalados, crie um banco local vazio:

```sh
cp .env.example .env
# Edite .env: remova HC_REFRESH_URL= se não usar Healthchecks.
bun install --frozen-lockfile
docker compose up -d --wait
docker compose exec -T postgres psql -U postgres -d fipe -v ON_ERROR_STOP=1 < initial.sql
bun run status
```

`initial.sql` cria tabelas e `latest_prices`; o banco local usa a porta 5433. Para bancos existentes,
veja [migrations/](migrations/). `bun run db:push` atualiza tabelas, mas não cria a view.

## Coletar dados

```sh
bun run crawl                                              # ano atual
bun run crawl -- --year 2020-2024 --month 1,6,12            # período
bun run crawl -- --brand 59 --model 5940 --reference 328    # recorte específico
bun run status                                             # totais no banco
```

`--year` e `--month` aceitam listas e intervalos; `--brand` e `--model`, listas por vírgula.
`--model` exige `--brand`. `--reference` tem prioridade sobre ano e mês.

A coleta retoma o progresso salvo. `--force` limpa os checkpoints da referência e refaz a coleta.
`status` mostra totais, não garante completude.

## Publicar novos meses

```sh
bun src/index.ts refresh
bun src/index.ts refresh --backup   # também faz backup; exige configuração R2
```

`crawl` salva dados, mas não publica um novo mês. O site lê `latest_prices`, que só usa referências
com `published_at` preenchido.

`refresh` processa os novos meses em ordem. Publica quando não há checkpoints pendentes e a
contagem de preços chega a 90% do mês publicado anterior. O primeiro mês não tem esse mínimo.
Isso não garante que todos os veículos foram coletados.

Falhas na coleta ou validação retornam código 1 sem publicar o mês. A próxima execução retoma
o trabalho, incluindo a view e backups pendentes (`--backup`). Outro refresh ativo causa uma saída
com código 0. Essa trava não bloqueia um `crawl` separado.

## Classificar e fazer backup

```sh
bun run classify -- --dry-run       # listar modelos sem segmento
bun run classify                   # classificar esses modelos com IA
bun run crawl -- --classify         # classificar modelos novos durante a coleta
bun run backup                     # salvar dump no R2/S3
bun run restore-drill              # testar a restauração do último dump diário
```

A classificação é opcional e usa `ANTHROPIC_API_KEY`. Os rótulos são gerados por IA, não pela FIPE.

O backup mantém 14 dumps diários e 12 mensais, em `daily/` e `monthly/`. O restore drill recria
`fipe_restore_drill`, restaura o dump, verifica se há preços e remove o banco. Reserve esse nome.

## Configurar

Defina as variáveis no `.env`. Só `DATABASE_URL` é obrigatória para a coleta.

| Variável                                                               | Uso                                                                                   |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                         | Conexão PostgreSQL.                                                                   |
| `RATE_LIMIT_MS`, `MAX_THROTTLE_MS`, `MAX_RETRIES`                      | Intervalo inicial, limite após throttling e tentativas. Padrões: `800`, `5000` e `3`. |
| `FIPE_PROXY`                                                           | URL de proxy opcional para a FIPE. Omita se não usar.                                 |
| `ANTHROPIC_API_KEY`                                                    | Chave para classificação com IA.                                                      |
| `HC_REFRESH_URL`                                                       | URL opcional do Healthchecks para o refresh.                                          |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, `R2_BUCKET` | Configure todas para backup e restore drill em storage compatível com S3.             |

## Rodar em Docker

A imagem inclui os clientes PostgreSQL e AWS necessários para backup. Fora dela, instale `pg_dump`,
`pg_restore`, `psql` e `aws` para usar esses comandos.

```sh
docker build -t fipe-crawler .
docker run -d --name fipe --env-file .env fipe-crawler
docker exec fipe bun src/index.ts status
```

`DATABASE_URL` deve ser acessível pelo container; `localhost` aponta para ele mesmo.
A imagem aguarda comandos e não inicia a coleta sozinha.

## Agendar atualizações

Use cron ou o agendador do seu ambiente para executar `bun src/index.ts refresh` na raiz do projeto,
com as variáveis de ambiente configuradas. Adicione `--backup` se usar R2/S3.

A coleta pode levar horas. Configure o tempo limite do job para permitir sua conclusão e acompanhe
os logs. Execuções sobrepostas de `refresh` são ignoradas enquanto outra estiver ativa.

Para monitorar o job, configure `HC_REFRESH_URL`: ele envia `/start` ao começar, a URL base no
sucesso e `/fail` na falha. Uma execução ignorada não envia ping. Falhas no monitoramento não
interrompem a coleta. Ajuste a tolerância do alerta para coletas longas (pelo menos 36 horas).

## Desenvolver

```sh
bun run check       # formatação, lint, tipos e testes
bun run test        # só testes
bun run format      # formatar com Vite+
```

Também há `bun run lint` e `bun run typecheck`. Veja [initial.sql](initial.sql) para o schema e
[FEATURE_MAP.md](FEATURE_MAP.md) para repetir a prévia de classificação em um banco temporário.

## Contribuidores

<a href="https://github.com/caiopizzol"><img src="https://github.com/caiopizzol.png" width="50" height="50" alt="caiopizzol" title="Caio Pizzol" /></a>
