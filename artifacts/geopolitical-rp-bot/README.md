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
- **Finanças e impostos:** `/saldo` mostra saldo, ganhos, gastos, resultado anual e comparação percentual. O detalhamento lista cada lançamento. A população gera impostos mensais, lançados em 12 parcelas no fechamento anual: fator 1,0 até 100 milhões; 0,8 entre 100 e 200 milhões; acima de 200 milhões, redução de 0,01 por faixa de 100 mil habitantes até o piso de 0,1. A renda-base e a inflação continuam configuráveis pelo Narrador.
- **Inventário e produção:** `/inventario painel` abre Recursos naturais, Indústria e bens e Militar. O catálogo inicial possui 18 produtos. `/inventario criar-item` define custo monetário e duração; `/inventario requisito` define os materiais necessários por unidade; o Narrador pode usar `/inventario fabricacao` para impedir a fabricação de itens considerados injustos; `/produzir iniciar` cria uma ordem e desconta materiais e custo; `/produzir fila` consulta ordens; `/produzir cancelar` devolve a parcela configurada dos materiais, mas não o custo monetário.
- **Produção anual e exportações:** `/inventario producao-anual` define produção, consumo e percentual anual destinado à exportação. No fechamento do ano, a venda é limitada à produção disponível e ao espaço do mercado global. A receita é registrada como rendimento de exportação; o estoque não vendido permanece no país.
- **Mercado mundial:** `/inventario estoque-global` configura quantidade inicial, preço atual, preço-base, limites, capacidade máxima e reposição anual. O mercado não ultrapassa a capacidade definida. A reposição é aplicada a cada avanço de ano, e as compras/vendas entram no cálculo de oferta e demanda dos preços.
- **Abastecimento e escassez:** a população consome os itens configurados em `/consumo configurar`. Se faltar qualquer item, o bot tenta comprá-lo do estoque global usando o tesouro; se o dinheiro for insuficiente, só emite a diferença por inflação quando a taxa global estiver acima de zero e o país tiver o financiamento automático habilitado em `/configuracoes pessoais`. Essa preferência pode ser alterada pelos membros do próprio país. Se a compra não puder ser concluída, o déficit permanece; a falta de alimento aumenta a revolta. A fabricação segue a mesma regra para materiais ausentes.
- **Rankings:** `/ranking` apresenta saldo do tesouro, população, valor estimado da produção anual, valor estimado dos estoques e variação do resultado financeiro líquido.
- **Mercado:** `/mercado` oferece negociações entre países e mercado global, com estoque reservado, compras parciais, preços limitados e histórico.
- **Forças armadas:** `/militar consultar` apresenta prontidão, cobertura de equipamentos e manutenção anual. A manutenção de itens militares é calculada sobre os soldados/equipamentos atribuídos, e a prontidão evolui no fechamento anual conforme abastecimento e cobertura.
- **Modernização militar:** `/militar modernizar` converte equipamento militar antigo em um modelo novo, consumindo o custo de produção e os materiais cadastrados na receita do novo item. O equipamento antigo precisa estar desatribuído.
- **Comércio internacional:** `/comercio contrato-criar` abre uma proposta bilateral; o país comprador aceita com `/comercio contrato-aceitar`. Contratos transferem recursos e dinheiro automaticamente a cada ano, têm duração definida (0 = indefinida) e podem ficar suspensos por falta de estoque, saldo, embargo ou bloqueio. `/comercio tarifa` configura tarifa do importador. `/comercio restricao-impor` e `/comercio restricao-levantar` gerenciam embargos e bloqueios. `/comercio dependencia` mede a participação de cada fornecedor nos últimos cinco anos de contratos e compras diretas entre países; participação igual ou superior a 50% é sinalizada como dependência alta. Tarifas são cobradas adicionalmente do importador e não são repassadas ao exportador; elas também incidem nas compras de ofertas entre países. Embargos e bloqueios impedem contratos, compras de ofertas e transferências anuais de recursos entre os países envolvidos.
- **População:** `/populacao` configura crescimento, necessidade alimentar, déficit e contador de revolta; o bot não decide consequências políticas.
- **Turnos e auditoria:** `/ano avancar` e `/ano desfazer` processam/revertem o exercício com transações atômicas e histórico. `/indicador` e `/historico` mantêm indicadores e auditoria.
- **Ajuda:** use `/ajuda` dentro do servidor para o resumo dos comandos.

O Gateway usa somente `DISCORD_BOT_TOKEN`; a conexão Discord OAuth do projeto não substitui o token do usuário de bot.
