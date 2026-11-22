# Bot de RP Geopolítico

Versão reduzida do bot. Os únicos sistemas ativos são **nações, inventário, renda e narradores**. Mercado, comércio, fabricação, população, turnos anuais, inflação, tarifas, acordos e sistemas militares avançados não fazem parte da versão ativa.

## Requisitos e inicialização

- Node.js 24 e pnpm.
- Aplicação e usuário de bot no Discord Developer Portal.
- Instale o bot no servidor com os escopos `bot` e `applications.commands`.
- Configure o secret `DISCORD_BOT_TOKEN`. Nunca coloque o token no Git ou em mensagens.
- Opcional: `DISCORD_GUILD_ID` registra comandos apenas em um servidor durante testes.
- Opcional: `DATABASE_PATH` define o caminho do banco SQLite.

Comando de inicialização:

```sh
pnpm --filter @workspace/geopolitical-rp-bot run dev
```

O banco é criado automaticamente em `data/game.sqlite`, relativo ao diretório do pacote. Migrações SQL são aplicadas na inicialização.

## Configuração inicial

1. Execute `/configurar principal`. O proprietário ou administrador do servidor pode definir o Narrador Supremo.
2. O Narrador Supremo nomeia outros narradores com `/narrador adicionar` e remove com `/narrador remover`.
3. O Narrador cria uma nação com `/pais criar`, vinculando-a a um cargo do Discord.
4. Associe jogadores com `/jogador associar`. Membros com o cargo vinculado também recebem associação automática ao interagir com o bot.

Narradores possuem acesso administrativo completo. Jogadores acessam apenas as nações às quais estão associados.

## Comandos ativos

### Nações
- `/pais criar`: cria uma nação e vincula um cargo.
- `/pais listar`: lista as nações acessíveis; narradores podem listar todas.
- `/pais ver`: consulta tesouro, renda anual e limite de dívida.
- `/jogador associar` e `/jogador remover`: gerenciam associações.
- `/jogador meus-paises`: lista as nações do jogador.

### Inventário
- `/inventario painel`: mostra estoque, produção anual, consumo anual e saldo anual projetado.
- `/inventario criar-item`: cadastra recursos comuns ou militares com unidade de medida.
- `/inventario ajustar`: altera estoque, com motivo, apenas por narrador.
- `/inventario producao`: define produção e consumo anuais por recurso e nação.
- O catálogo inicial é criado automaticamente quando o painel de inventário é aberto pela primeira vez.

### Renda e saldo
- `/economia configurar`: define renda anual-base e limite de dívida de uma nação.
- `/renda adicionar`: registra um valor positivo como rendimento ou negativo como despesa. A operação altera o tesouro e gera lançamento no livro-razão.
- `/saldo`: consulta tesouro, renda anual-base e limite de dívida.
- Os valores de renda são anuais. Não há cálculo mensal de impostos nesta versão reduzida.

### Narradores
- `/configurar principal`: configuração inicial do Narrador Supremo.
- `/narrador adicionar`: nomeia um narrador com acesso administrativo completo.
- `/narrador remover`: remove as permissões de narrador concedidas.

### Utilitários
- `/ajuda`: resumo dos sistemas ativos.
- `/ping`: verifica a conexão.

## Regras de segurança e dados

- Ações administrativas são verificadas no servidor; esconder um comando na interface não é usado como controle de permissão.
- Valores monetários respeitam a precisão da moeda, o limite de dívida e o limite de saldo configurado no banco.
- Alterações de estoque não podem produzir quantidades negativas.
- A associação automática por cargo é sincronizada a cada interação.
- O SQLite usa WAL. Faça backup do banco antes de qualquer limpeza manual.

## Verificações

```sh
pnpm --filter @workspace/geopolitical-rp-bot run typecheck
pnpm --filter @workspace/geopolitical-rp-bot run test
pnpm --filter @workspace/geopolitical-rp-bot run build
```
