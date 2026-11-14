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

O primeiro passo dentro do servidor é executar `/configurar principal`. O proprietário ou um administrador do servidor pode reivindicar essa configuração inicial. Se `DISCORD_OWNER_ID` estiver definido, essa conta também será autorizada; administradores do servidor continuam autorizados.

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

- **Países e cargos:** `/pais criar` vincula um país a um cargo Discord. Quem possui o cargo recebe acesso automaticamente ao usar o bot; a perda do cargo revoga essa associação automática. Os comandos recebem nomes de países, nunca IDs internos.
- **Hierarquia:** o Narrador Supremo é definido em `/configurar principal` e nomeia/remove narradores com `/narrador adicionar` e `/narrador remover`. Todo narrador nomeado tem acesso administrativo completo. Jogadores têm controle integral dos países aos quais estão associados.
- **Finanças:** `/saldo` mostra saldo, ganhos, gastos, resultado anual e comparação percentual. O botão de detalhamento lista as movimentações e justificativas. `/gastar` registra um gasto imediato do jogador. `/rendimento adicionar` registra imediatamente um valor positivo ou negativo, apenas para narradores. `/dinheiro adicionar|remover|definir` administra o saldo. `/economia` configura renda-base, limites e inflação; `/transferir` movimenta dinheiro entre países.
- **Inventário e produção:** `/inventario painel` abre três categorias navegáveis por botões: Recursos naturais, Indústria e bens, Militar. O catálogo inicial possui 18 produtos (seis por categoria). Cada produto mostra estoque, produção anual, consumo anual e variação líquida. Narradores podem criar categorias e produtos personalizados. Use nomes de produtos nos comandos de estoque e produção.
- **Rankings:** `/ranking` apresenta saldo do tesouro, população, valor estimado da produção anual, valor estimado dos estoques e variação do resultado financeiro líquido.
- **Mercado:** `/mercado` oferece negociações entre países e mercado global, com estoque reservado, compras parciais, preços limitados e histórico.
- **População:** `/populacao` configura crescimento, necessidade alimentar, déficit e contador de revolta; o bot não decide consequências políticas.
- **Turnos e auditoria:** `/ano avancar` e `/ano desfazer` processam/revertem o exercício com transações atômicas e histórico. `/indicador` e `/historico` mantêm indicadores e auditoria.
- **Ajuda:** use `/ajuda` dentro do servidor para o resumo dos comandos.

O Gateway usa somente `DISCORD_BOT_TOKEN`; a conexão Discord OAuth do projeto não substitui o token do usuário de bot.
