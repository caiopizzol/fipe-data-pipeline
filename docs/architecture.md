# Arquitetura

Este repositório é uma aplicação CLI em um único pacote Bun. A fonte de dados é a API pública da FIPE e a persistência usa PostgreSQL via Drizzle.

| Local                | Responsabilidade                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------- |
| `src/index.ts`       | Registrar comandos, carregar configurações, abrir/fechar recursos e definir o código de saída |
| `src/cli-options.ts` | Validar argumentos antes de qualquer operação                                                 |
| `src/config.ts`      | Validar apenas as variáveis necessárias ao comando                                            |
| `src/commands/`      | Orquestrar crawl, refresh, status, classificação e backup/restauração                         |
| `src/fipe/`          | Cliente HTTP, schemas das respostas e conversão de valores                                    |
| `src/classifier/`    | Vocabulário de segmentos e comunicação com o provedor de IA                                   |
| `src/db/`            | Conexão, schema e consultas; a conexão é passada ao repositório                               |
| `drizzle/`           | Histórico versionado do schema e das mudanças de dados                                        |
| `tests/integration/` | Cenários de coleta com PostgreSQL real e FIPE simulada                                        |
| `fixtures/pickled/`  | Avaliações de compreensão da documentação por agentes                                         |

## Fluxo de coleta

A coleta percorre referências → marcas → modelos → anos-modelo → preços. As tabelas de associação registram checkpoints independentes por referência. Um item só recebe seu checkpoint após a operação correspondente persistir com sucesso.

Os filtros de marca/modelo acompanham todas as consultas de pendências. Quando um modelo é solicitado explicitamente, a lista de modelos da marca é consultada mesmo que a marca já estivesse completa. Isso permite descoberta direcionada sem alterar o checkpoint de cobertura da marca inteira.

`--force` limpa checkpoints dentro do escopo em uma transação. Mantém linhas, preços existentes e o registro de cobertura previamente verificada em coletas com escopo; falhas deixam pendências que uma execução comum pode retomar. Uma execução sem filtros de marca/modelo só marca a referência completa quando todas as pendências terminam. Status com zero pendências conhecidas, mas sem esse marcador, representa cobertura ainda não comprovada.

O CLI mantém um advisory lock em uma conexão reservada durante o crawl. Outra execução no mesmo banco falha imediatamente; não se forma uma fila de coletas sobrepostas. O lock é cooperativo: consumidores externos devem respeitar o protocolo caso escrevam checkpoints.

## Fronteiras e tipos

O cliente FIPE valida respostas com Zod. As conversões de preço mantêm valores decimais como strings, evitando arredondamento de ponto flutuante. O cliente usa timeout de 30 segundos por requisição, retentativas limitadas e throttle adaptativo para HTTP 429. Se a FIPE pedir uma espera acima de 60 segundos, a execução reporta o cooldown e o cliente bloqueia novas chamadas até esse prazo, permitindo reagendar a coleta.

O classificador associa respostas pelo número do modelo e rejeita lotes com números repetidos, ausentes ou inválidos. Uma falha de classificação deixa o segmento vazio para `classify` tentar novamente.

O repositório concentra SQL explícito. Funções `getOrCreate...` preservam registros existentes; `upsertPrice` atualiza preços. Integrações são passadas diretamente às funções para os testes, sem contêiner de injeção ou repositórios genéricos.

## Banco consumidor

O pipeline possui as oito tabelas declaradas em `src/db/schema.ts` e a view materializada `latest_prices`.
As migrations criam a view com filtro por `published_at`. `crawl` salva dados sem publicar; `refresh`
publica referências em ordem após validar pendências e o mínimo de preços, atualiza a view e retoma
backups pendentes. A trava exclusiva de refresh preserva o protocolo anterior; cada coleta interna
usa também a trava de crawl. `REFRESH_LATEST_PRICES=true` permite atualizar a view ao fim de um
crawl independente, mantendo o filtro de publicação.

## Convenções

Use nomes específicos em kebab-case para arquivos, camelCase para funções/variáveis e PascalCase para tipos. Mantenha o sufixo `.js` nos imports locais, conforme o padrão existente. Testes unitários ficam ao lado do módulo. Identificadores do banco usam snake_case. Diferencie `referenceId` (chave local) de `referenceCode` (código FIPE).

Altere o schema e gere uma migration; revise o SQL antes de aplicá-lo. Migrações já aplicadas não devem ser reescritas. Não mantenha outra cópia manual do schema atual.
