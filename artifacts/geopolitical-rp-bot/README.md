# Bot de RP Geopolítico

Bot de Discord para roleplay geopolítico. Usa `discord.js`, TypeScript e SQLite; não inclui IA nem simulador militar.

## Pré-requisitos

- Node.js 24 e pnpm (já disponíveis neste projeto).
- Uma aplicação e usuário de bot criados no [Discord Developer Portal](https://discord.com/developers/applications).
- O bot precisa ser instalado no servidor com os escopos `bot` e `applications.commands`.
- Salve o token do usuário de bot no Replit Secrets com o nome `DISCORD_BOT_TOKEN`. Copie-o em **Developer Portal → Applications → sua aplicação → Bot**; use o token do bot sem o prefixo `Bot `. Não use o Client Secret nem um token OAuth. Nunca o coloque em `.env`, no Git ou em mensagens.

Permissões Discord recomendadas: `View Channels`, `Send Messages` e `Embed Links`. O bot não precisa de permissões administrativas para responder a comandos.

## Iniciar

O workflow **Bot Discord RP** executa:

```sh
pnpm --filter @workspace/geopolitical-rp-bot run dev
```

Para executar manualmente:

```sh
pnpm --filter @workspace/geopolitical-rp-bot run dev
```

Ao conectar, o bot registra seus comandos de barra automaticamente. Por padrão, o registro é global e pode demorar para aparecer no Discord. Para atualizações imediatas durante configuração, defina `DISCORD_GUILD_ID` com o ID do servidor: os comandos serão registrados apenas nele.

O primeiro passo dentro do servidor é executar `/configurar principal`. Apenas o proprietário do servidor pode reivindicar essa configuração inicial. Se `DISCORD_OWNER_ID` estiver definido, esse usuário será o único autorizado a fazê-la.

## Banco de dados

O banco SQLite é criado automaticamente no diretório do pacote:

```text
artifacts/geopolitical-rp-bot/data/game.sqlite
```

Defina `DATABASE_PATH` para usar outro caminho. Migrações numeradas ficam em `migrations/` e são aplicadas na inicialização. WAL está ativo para durabilidade e acesso seguro. O arquivo de banco, o WAL e o SHM estão ignorados pelo Git; mantenha cópias de segurança fora do repositório.

## Verificações

```sh
pnpm --filter @workspace/geopolitical-rp-bot run typecheck
pnpm --filter @workspace/geopolitical-rp-bot run test
pnpm --filter @workspace/geopolitical-rp-bot run build
```

Os testes cobrem limites de dívida e transferências atômicas, permissões de narrador e de país, edição de países, itens personalizados e fluxos financeiros, produção instantânea e temporizada, e avanço/reversão anual.

## Sistemas

- `/pais` e `/jogador`: países associados a cargos do Discord; a associação é criada quando o jogador usa o bot. Narradores podem criar, editar e arquivar países; países e indicadores ficam privados por padrão.
- `/permissao`: concessões de narrador por sistema/ação e permissões individuais por país para ações autorizadas. Narradores subordinados só delegam ações que possuem.
- `/economia`, `/transferir`: moeda compartilhada e configurável por servidor, limites de saldo e dívida, renda anual, lançamentos recorrentes/pontuais, emissão voluntária e extrato auditável.
- `/inventario` e `/produzir`: itens militares, bens comuns e categorias personalizadas, com propriedades, custos de produção, receitas, despesas, manutenção anual, materiais e filas. Materiais devolvidos ao cancelar são calculados pela receita usada ao iniciar o pedido.
- `/mercado`: ofertas entre países com estoque reservado e compras parciais; mercado global com preços dentro dos limites configurados e histórico de transações e preços.
- `/populacao`: crescimento, necessidade alimentar, déficit e contador de revolta; o bot não decide consequências políticas.
- `/ano avancar` e `/ano desfazer`: processamento em uma transação, idempotência por interação Discord, snapshot antes/depois e reversões no livro-razão. A reversão é bloqueada se o estado do jogo mudou após o processamento.
- `/indicador` e `/historico`: indicadores tipados, extratos, auditoria e processamento anual.

## Permissões iniciais

1. O proprietário do servidor executa `/configurar principal`.
2. O narrador cria a moeda, configura as regras, cria itens e categorias personalizadas de itens e indicadores.
3. O narrador cria os países vinculando cargos Discord e associa jogadores sem o cargo, quando necessário.
4. O narrador concede permissões de narrador e de país antes de autorizar alterações por jogadores.
5. O narrador configura a renda anual, limites, produção, alimentação e estoque global antes de usar `/ano avancar`.

O Gateway usa somente `DISCORD_BOT_TOKEN`; a conexão Discord OAuth do projeto não substitui o token do usuário de bot.
