# Operações

## Banco e migrations

`bun run db:migrate` aplica as migrations de `drizzle/` usando `DATABASE_URL`. Execute antes da primeira coleta e após atualizar a aplicação. `bun run db:generate -- --name descricao` gera SQL a partir de alterações em `src/db/schema.ts`; revise esse SQL e teste em um banco descartável. `db:push` é destinado a protótipos descartáveis.

### Banco existente

A migration inicial aceita o layout anterior de oito tabelas e adiciona índices ausentes sem recriar tabelas existentes. Antes da primeira adoção, faça backup e compare o schema do banco com `src/db/schema.ts`; `CREATE TABLE IF NOT EXISTS` não corrige divergências em colunas ou constraints. Para bancos criados pelo antigo `initial.sql`, os nomes automáticos das constraints podem diferir: revise migrations futuras que renomeiem/removam constraints.

A segunda migration limpa somente `reference_tables.crawled_at`, porque versões anteriores marcavam referências parciais como completas. Preços, modelos e checkpoints individuais são preservados. Reexecute uma coleta sem filtros de marca/modelo para comprovar cobertura completa. Migrations posteriores são registradas em `drizzle.__drizzle_migrations`; uma nova execução não reaplica as já registradas.

A migração deve acontecer sem uma coleta em execução. Este procedimento não administra tabelas ou views exclusivas da aplicação consumidora.

## Retomada e monitoramento

`bun run status -- --reference 328` informa progresso conhecido. Uma coleta limitada pode estar concluída para aquele escopo enquanto a referência inteira continua incompleta. Falhas de API e persistência aparecem com o contexto do item; o CLI termina com código 1 se qualquer item falhar. Reexecute o mesmo escopo sem `--force` para retomar. Erros de configuração também retornam código 1.

`--force` reinicia apenas os checkpoints selecionados e atualiza preços já existentes. Não execute `--force` repetidamente para retomar uma falha: isso reiniciaria também os itens que já foram recuperados.

Quando `REFRESH_LATEST_PRICES=true`, a aplicação consumidora precisa ter criado e populado `latest_prices` e seu índice único compatível com `REFRESH MATERIALIZED VIEW CONCURRENTLY`. O padrão é `false`. A retomada também tenta o refresh, mesmo que não tenha sido necessário buscar preços novamente.

## Backup e restauração

A imagem Docker já inclui as ferramentas. Para executar nativamente, instale `pg_dump`, `pg_restore`, `psql` e AWS CLI. O `pg_dump` precisa suportar a versão do servidor. Configure `DATABASE_URL`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT` e `R2_BUCKET`; os comandos comuns não exigem R2.

```bash
bun run backup
bun run restore-drill
```

O backup usa formato customizado (`pg_dump -Fc`) sem proprietários ou privilégios. Os arquivos ficam sob `daily/`; `DAILY_KEEP` é uma constante de 14 arquivos, não necessariamente 14 dias se houver várias execuções diárias. O primeiro backup bem-sucedido de cada mês também ocupa `monthly/`, com `MONTHLY_KEEP` de 12 arquivos. O upload termina antes da poda. Estas constantes não são variáveis de ambiente. Agende uma execução por dia se quiser retenção diária; evite backups concorrentes para manter a política mensal previsível.

A role do banco precisa ler todas as tabelas para o backup. O restore drill precisa também de `CREATEDB`, acesso ao banco administrativo `postgres` e conectividade direta adequada às ferramentas PostgreSQL. Use uma role operacional própria quando necessário.

O restore drill baixa o arquivo diário mais recente, verifica o arquivo e o restaura em um banco com nome único `fipe_restore_<id>`. Exige uma tabela `prices` não vazia. Remove apenas seu banco temporário e seus arquivos; falhas de limpeza são reportadas junto ao erro original. Não substitui nem restaura sobre o banco de origem.

Se a remoção do banco temporário falhar, o erro informa seu nome para limpeza manual após verificar que a execução terminou. O drill valida o arquivo de backup e a presença de preços; não substitui uma verificação de completude de todas as referências.

## Docker

O host usa `localhost:5433`; o serviço pipeline do Compose usa `postgres:5432`. O perfil `pipeline` mantém o runner disponível para `docker compose exec`. Para banco externo, configure um endereço alcançável pelo contêiner. A imagem usa PostgreSQL client 17 por padrão; Compose seleciona client 16 para seu servidor 16. Use `docker build --build-arg POSTGRES_MAJOR=16 -t fipe-crawler .` para outro servidor 16 e ajuste o argumento para o major do servidor de destino. Dump e restore devem usar ferramentas compatíveis com o servidor; ferramentas mais novas podem emitir parâmetros que servidores antigos rejeitam.

## Verificação local

`bun run check` executa lint, tipos, testes unitários e testes de integração. Por padrão os testes de integração criam um PostgreSQL 16 descartável e removem o contêiner ao terminar. Nunca usam `DATABASE_URL`. `TEST_DATABASE_URL` é apenas para um banco de testes descartável com sufixo `_test`.

`bun run docs:check` valida exemplos e planos de execução do Pickled sem consumir API de agentes. As avaliações com agentes reais ficam no workflow manual Pickled. `bun run hooks:install` instala Lefthook no clone atual; a CI continua sendo a verificação compartilhada.
