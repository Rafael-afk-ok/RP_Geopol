import {
  SlashCommandBuilder,
  SlashCommandSubcommandBuilder,
} from "discord.js";

const systems = [
  { name: "Economia", value: "economy" },
  { name: "Inventário", value: "inventory" },
  { name: "Produção", value: "production" },
  { name: "População", value: "population" },
  { name: "Mercado", value: "market" },
  { name: "Jogadores", value: "players" },
  { name: "Indicadores", value: "indicators" },
  { name: "Países", value: "countries" },
  { name: "Avanço de ano", value: "year" },
  { name: "Narradores", value: "narrators" },
];

const actions = [
  { name: "Consultar", value: "read" },
  { name: "Criar", value: "create" },
  { name: "Editar", value: "edit" },
  { name: "Configurar", value: "configure" },
  { name: "Arquivar", value: "archive" },
  { name: "Gerenciar", value: "manage" },
  { name: "Iniciar", value: "start" },
  { name: "Cancelar", value: "cancel" },
  { name: "Comprar", value: "buy" },
  { name: "Vender", value: "sell" },
  { name: "Transferir", value: "transfer" },
  { name: "Emitir dinheiro", value: "inflate" },
  { name: "Avançar", value: "advance" },
  { name: "Desfazer", value: "undo" },
  { name: "Conceder", value: "grant" },
];

function countryId(subcommand: SlashCommandSubcommandBuilder, required = true): SlashCommandSubcommandBuilder {
  return subcommand.addIntegerOption((option) =>
    option.setName("pais_id").setDescription("ID interno do país").setRequired(required).setMinValue(1),
  );
}

export const commandBuilders = [
  new SlashCommandBuilder()
    .setName("configurar")
    .setDescription("Configura regras gerais do servidor")
    .addSubcommand((subcommand) => subcommand.setName("principal").setDescription("Define o narrador principal (dono ou administrador do servidor)"))
    .addSubcommand((subcommand) =>
      subcommand.setName("moeda").setDescription("Define a moeda usada por todos os países")
        .addStringOption((option) => option.setName("nome").setDescription("Nome da moeda").setRequired(true).setMaxLength(40))
        .addStringOption((option) => option.setName("simbolo").setDescription("Símbolo da moeda").setRequired(true).setMaxLength(8))
        .addIntegerOption((option) => option.setName("casas_decimais").setDescription("Casas decimais").setRequired(true).setMinValue(0).setMaxValue(6)),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("inflacao").setDescription("Configura inflação global e penalidade de renda")
        .addNumberOption((option) => option.setName("taxa_global").setDescription("Aumento anual global de preços, em porcentagem").setRequired(true).setMinValue(0).setMaxValue(100))
        .addStringOption((option) => option.setName("formula").setDescription("Fórmula da penalidade de renda").setRequired(true)
          .addChoices({ name: "Linear", value: "linear" }, { name: "Exponencial", value: "exponential" }))
        .addNumberOption((option) => option.setName("penalidade_por_mil").setDescription("Percentual de redução por mil emitidos").setRequired(true).setMinValue(0).setMaxValue(100)),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("mercado").setDescription("Configura duração de ofertas e sensibilidade de preços")
        .addIntegerOption((option) => option.setName("validade_anos").setDescription("Validade de ofertas (3 a 5 anos)").setRequired(true).setMinValue(3).setMaxValue(5))
        .addNumberOption((option) => option.setName("sensibilidade").setDescription("Impacto de oferta e demanda (0 a 5)").setRequired(true).setMinValue(0).setMaxValue(5)),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("populacao").setDescription("Configura escassez alimentar e normalização da revolta")
        .addNumberOption((option) => option.setName("gravidade").setDescription("Pontos de revolta para déficit total").setRequired(true).setMinValue(0))
        .addNumberOption((option) => option.setName("normalizacao").setDescription("Redução anual após normalizar o abastecimento").setRequired(true).setMinValue(0)),
    ),

  new SlashCommandBuilder()
    .setName("pais")
    .setDescription("Cria, edita e consulta países")
    .addSubcommand((subcommand) =>
      subcommand.setName("criar").setDescription("Cria um país ligado a um cargo do Discord")
        .addStringOption((option) => option.setName("nome").setDescription("Nome do país").setRequired(true).setMaxLength(80))
        .addRoleOption((option) => option.setName("cargo").setDescription("Cargo que identifica o país").setRequired(true)),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("listar").setDescription("Lista países acessíveis ou todos como narrador"),
    )
    .addSubcommand((subcommand) =>
      countryId(subcommand.setName("ver").setDescription("Consulta os dados privados de um país")),
    )
    .addSubcommand((subcommand) =>
      countryId(subcommand.setName("editar").setDescription("Edita o nome ou cargo associado do país"))
        .addStringOption((option) => option.setName("nome").setDescription("Novo nome").setRequired(false).setMaxLength(80))
        .addRoleOption((option) => option.setName("cargo").setDescription("Novo cargo associado").setRequired(false)),
    )
    .addSubcommand((subcommand) =>
      countryId(subcommand.setName("arquivar").setDescription("Arquiva um país (narrador autorizado)")),
    ),

  new SlashCommandBuilder()
    .setName("jogador")
    .setDescription("Associa jogadores a países")
    .addSubcommand((subcommand) =>
      countryId(subcommand.setName("associar").setDescription("Associa um jogador a um país"))
        .addUserOption((option) => option.setName("jogador").setDescription("Jogador").setRequired(true)),
    )
    .addSubcommand((subcommand) =>
      countryId(subcommand.setName("remover").setDescription("Remove um jogador de um país"))
        .addUserOption((option) => option.setName("jogador").setDescription("Jogador").setRequired(true)),
    )
    .addSubcommand((subcommand) => subcommand.setName("meus-paises").setDescription("Lista seus países associados")),

  new SlashCommandBuilder()
    .setName("permissao")
    .setDescription("Gerencia permissões de narradores e jogadores")
    .addSubcommand((subcommand) =>
      subcommand.setName("narrador").setDescription("Concede ou revoga uma permissão de narrador")
        .addUserOption((option) => option.setName("jogador").setDescription("Narrador subordinado").setRequired(true))
        .addStringOption((option) => option.setName("sistema").setDescription("Sistema").setRequired(true).addChoices(...systems))
        .addStringOption((option) => option.setName("acao").setDescription("Ação permitida").setRequired(true).addChoices(...actions))
        .addBooleanOption((option) => option.setName("permitir").setDescription("Verdadeiro concede; falso revoga").setRequired(true)),
    )
    .addSubcommand((subcommand) =>
      countryId(subcommand.setName("jogador").setDescription("Define uma permissão por país"))
        .addUserOption((option) => option.setName("alvo").setDescription("Jogador associado").setRequired(true))
        .addStringOption((option) => option.setName("sistema").setDescription("Sistema").setRequired(true)
          .addChoices(...systems.filter(({ value }) => value !== "year" && value !== "narrators" && value !== "countries")))
        .addStringOption((option) => option.setName("acao").setDescription("Ação permitida").setRequired(true)
          .addChoices(...actions.filter(({ value }) => value !== "grant" && value !== "advance" && value !== "undo" && value !== "archive")))
        .addBooleanOption((option) => option.setName("permitir").setDescription("Verdadeiro concede; falso revoga").setRequired(true)),
    ),

  new SlashCommandBuilder()
    .setName("indicador")
    .setDescription("Configura e consulta indicadores nacionais")
    .addSubcommand((subcommand) =>
      subcommand.setName("categoria").setDescription("Cria uma categoria de indicadores")
        .addStringOption((option) => option.setName("nome").setDescription("Nome da categoria").setRequired(true).setMaxLength(80))
        .addStringOption((option) => option.setName("descricao").setDescription("Descrição").setRequired(false).setMaxLength(250)),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("criar").setDescription("Cria um indicador configurável")
        .addIntegerOption((option) => option.setName("categoria_id").setDescription("ID da categoria").setRequired(true).setMinValue(1))
        .addStringOption((option) => option.setName("nome").setDescription("Nome do indicador").setRequired(true).setMaxLength(80))
        .addStringOption((option) => option.setName("tipo").setDescription("Tipo de valor").setRequired(true)
          .addChoices({ name: "Número", value: "number" }, { name: "Texto", value: "text" }, { name: "Booleano", value: "boolean" }, { name: "JSON", value: "json" }))
        .addStringOption((option) => option.setName("descricao").setDescription("Descrição").setRequired(false).setMaxLength(250))
        .addStringOption((option) => option.setName("valor_padrao").setDescription("Valor padrão (formato JSON)").setRequired(false).setMaxLength(2000)),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("definir").setDescription("Define o valor de um indicador para um país")
        .addIntegerOption((option) => option.setName("pais_id").setDescription("ID interno do país").setRequired(true).setMinValue(1))
        .addIntegerOption((option) => option.setName("indicador_id").setDescription("ID do indicador").setRequired(true).setMinValue(1))
        .addStringOption((option) => option.setName("valor").setDescription("Valor, em JSON válido").setRequired(true).setMaxLength(2000)),
    )
    .addSubcommand((subcommand) =>
      countryId(subcommand.setName("consultar").setDescription("Consulta os indicadores acessíveis")),
    ),

  new SlashCommandBuilder()
    .setName("economia")
    .setDescription("Configura rendimentos e movimentações econômicas")
    .addSubcommand((subcommand) =>
      subcommand.setName("configurar").setDescription("Define saldo máximo, dívida e renda anual (narrador)")
        .addIntegerOption((option) => option.setName("pais_id").setDescription("ID do país").setRequired(true).setMinValue(1))
        .addNumberOption((option) => option.setName("limite_divida").setDescription("Dívida máxima").setRequired(true).setMinValue(0))
        .addNumberOption((option) => option.setName("renda_anual").setDescription("Rendimento base anual").setRequired(true).setMinValue(0))
        .addNumberOption((option) => option.setName("limite_saldo").setDescription("Limite máximo; deixe vazio para ilimitado").setRequired(false).setMinValue(0)),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("lancar").setDescription("Cria uma receita ou despesa pontual/recorrente")
        .addIntegerOption((option) => option.setName("pais_id").setDescription("ID do país").setRequired(true).setMinValue(1))
        .addStringOption((option) => option.setName("tipo").setDescription("Receita ou despesa").setRequired(true)
          .addChoices({ name: "Receita", value: "income" }, { name: "Despesa", value: "expense" }))
        .addNumberOption((option) => option.setName("valor").setDescription("Valor").setRequired(true).setMinValue(0.01))
        .addStringOption((option) => option.setName("descricao").setDescription("Descrição").setRequired(true).setMaxLength(200))
        .addStringOption((option) => option.setName("frequencia").setDescription("Pontual ou recorrente").setRequired(true)
          .addChoices({ name: "Uma vez", value: "one_time" }, { name: "Anual recorrente", value: "recurring" }))
        .addIntegerOption((option) => option.setName("ano").setDescription("Ano de início").setRequired(false).setMinValue(1)),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("inflar").setDescription("Emite dinheiro voluntariamente para o país")
        .addIntegerOption((option) => option.setName("pais_id").setDescription("ID do país").setRequired(true).setMinValue(1))
        .addNumberOption((option) => option.setName("valor").setDescription("Valor emitido").setRequired(true).setMinValue(0.01)),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("devolver-inflacao").setDescription("Devolve exatamente todo o valor emitido")
        .addIntegerOption((option) => option.setName("pais_id").setDescription("ID do país").setRequired(true).setMinValue(1))
        .addNumberOption((option) => option.setName("valor_exato").setDescription("Total exato emitido").setRequired(true).setMinValue(0.01)),
    ),

  new SlashCommandBuilder()
    .setName("transferir")
    .setDescription("Transfere dinheiro entre países")
    .addIntegerOption((option) => option.setName("origem").setDescription("ID do país de origem").setRequired(true).setMinValue(1))
    .addIntegerOption((option) => option.setName("destino").setDescription("ID do país de destino").setRequired(true).setMinValue(1))
    .addNumberOption((option) => option.setName("valor").setDescription("Valor").setRequired(true).setMinValue(0.01))
    .addStringOption((option) => option.setName("descricao").setDescription("Motivo da transferência").setRequired(false).setMaxLength(200)),

  new SlashCommandBuilder()
    .setName("inventario")
    .setDescription("Gerencia itens, estoques e produção anual")
    .addSubcommand((subcommand) =>
      subcommand.setName("categoria").setDescription("Cria uma categoria personalizada de itens")
        .addStringOption((option) => option.setName("nome").setDescription("Nome da categoria").setRequired(true).setMaxLength(60))
        .addStringOption((option) => option.setName("descricao").setDescription("Descrição").setRequired(false).setMaxLength(250)),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("criar-item").setDescription("Define um item, seus custos e propriedades")
        .addStringOption((option) => option.setName("nome").setDescription("Nome").setRequired(true).setMaxLength(80))
        .addStringOption((option) => option.setName("categoria").setDescription("Categoria").setRequired(true)
          .addChoices({ name: "Militar", value: "military" }, { name: "Bem comum", value: "common" }, { name: "Personalizado", value: "custom" }))
        .addNumberOption((option) => option.setName("custo").setDescription("Custo inicial de produção").setRequired(true).setMinValue(0))
        .addNumberOption((option) => option.setName("manutencao").setDescription("Manutenção anual por unidade operacional").setRequired(true).setMinValue(0))
        .addIntegerOption((option) => option.setName("duracao_anos").setDescription("0 para produção instantânea").setRequired(true).setMinValue(0))
        .addIntegerOption((option) => option.setName("filas_simultaneas").setDescription("Máximo de pedidos em andamento").setRequired(true).setMinValue(1).setMaxValue(100))
        .addBooleanOption((option) => option.setName("alimento").setDescription("Este item conta como alimento").setRequired(true))
        .addBooleanOption((option) => option.setName("mercado_global").setDescription("Pode ser negociado no mercado global").setRequired(true))
         .addNumberOption((option) => option.setName("receita_anual").setDescription("Receita anual por unidade operacional").setRequired(false).setMinValue(0))
         .addNumberOption((option) => option.setName("despesa_anual").setDescription("Despesa anual por unidade operacional").setRequired(false).setMinValue(0))
        .addStringOption((option) => option.setName("descricao").setDescription("Descrição").setRequired(false).setMaxLength(250))
         .addIntegerOption((option) => option.setName("categoria_personalizada_id").setDescription("ID da categoria (obrigatório para itens personalizados)").setRequired(false).setMinValue(1))
        .addStringOption((option) => option.setName("propriedades_json").setDescription("Propriedades personalizadas em JSON").setRequired(false).setMaxLength(2000)),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("ajustar").setDescription("Corrige o estoque de um país (narrador)")
        .addIntegerOption((option) => option.setName("pais_id").setDescription("ID do país").setRequired(true).setMinValue(1))
        .addIntegerOption((option) => option.setName("item_id").setDescription("ID do item").setRequired(true).setMinValue(1))
        .addNumberOption((option) => option.setName("variacao").setDescription("Quantidade adicionada ou removida").setRequired(true))
        .addStringOption((option) => option.setName("motivo").setDescription("Motivo").setRequired(true).setMaxLength(200)),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("consultar").setDescription("Consulta o inventário privado de um país")
        .addIntegerOption((option) => option.setName("pais_id").setDescription("ID do país").setRequired(true).setMinValue(1)),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("producao-anual").setDescription("Define produção e consumo anual de um bem")
        .addIntegerOption((option) => option.setName("pais_id").setDescription("ID do país").setRequired(true).setMinValue(1))
        .addIntegerOption((option) => option.setName("item_id").setDescription("ID do item").setRequired(true).setMinValue(1))
        .addNumberOption((option) => option.setName("produz").setDescription("Quantidade anual produzida").setRequired(true).setMinValue(0))
        .addNumberOption((option) => option.setName("consome").setDescription("Quantidade anual consumida (exceto alimento)").setRequired(true).setMinValue(0)),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("requisito").setDescription("Define material necessário para produzir um item")
        .addIntegerOption((option) => option.setName("produto_id").setDescription("ID do produto").setRequired(true).setMinValue(1))
        .addIntegerOption((option) => option.setName("material_id").setDescription("ID do material").setRequired(true).setMinValue(1))
        .addNumberOption((option) => option.setName("quantidade").setDescription("Material por unidade produzida").setRequired(true).setMinValue(0.01)),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("estoque-global").setDescription("Configura estoque e preço do mercado global")
        .addIntegerOption((option) => option.setName("item_id").setDescription("ID do item").setRequired(true).setMinValue(1))
        .addNumberOption((option) => option.setName("estoque").setDescription("Quantidade global disponível").setRequired(true).setMinValue(0))
        .addNumberOption((option) => option.setName("preco").setDescription("Preço atual por unidade").setRequired(true).setMinValue(0.01))
        .addNumberOption((option) => option.setName("preco_minimo").setDescription("Preço mínimo").setRequired(true).setMinValue(0.01))
        .addNumberOption((option) => option.setName("preco_maximo").setDescription("Preço máximo").setRequired(true).setMinValue(0.01)),
    ),

  new SlashCommandBuilder()
    .setName("produzir")
    .setDescription("Inicia, acompanha ou cancela produção")
    .addSubcommand((subcommand) =>
      subcommand.setName("iniciar").setDescription("Produz instantaneamente ou cria um pedido temporizado")
        .addIntegerOption((option) => option.setName("pais_id").setDescription("ID do país").setRequired(true).setMinValue(1))
        .addIntegerOption((option) => option.setName("item_id").setDescription("ID do item").setRequired(true).setMinValue(1))
        .addNumberOption((option) => option.setName("quantidade").setDescription("Quantidade").setRequired(true).setMinValue(0.01)),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("cancelar").setDescription("Cancela um pedido em andamento e devolve parte dos materiais")
        .addStringOption((option) => option.setName("pedido_id").setDescription("ID do pedido").setRequired(true)),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("fila").setDescription("Consulta os pedidos de produção de um país")
        .addIntegerOption((option) => option.setName("pais_id").setDescription("ID do país").setRequired(true).setMinValue(1)),
    ),

  new SlashCommandBuilder()
    .setName("mercado")
    .setDescription("Negocia itens entre países ou no mercado global")
    .addSubcommand((subcommand) =>
      subcommand.setName("ofertar").setDescription("Cria uma oferta de venda; o estoque fica reservado")
        .addIntegerOption((option) => option.setName("pais_id").setDescription("ID do país vendedor").setRequired(true).setMinValue(1))
        .addIntegerOption((option) => option.setName("item_id").setDescription("ID do item").setRequired(true).setMinValue(1))
        .addNumberOption((option) => option.setName("quantidade").setDescription("Quantidade").setRequired(true).setMinValue(0.01))
        .addNumberOption((option) => option.setName("preco_unitario").setDescription("Preço por unidade").setRequired(true).setMinValue(0.01))
        .addStringOption((option) => option.setName("descricao").setDescription("Descrição opcional").setRequired(false).setMaxLength(200)),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("comprar").setDescription("Compra parte ou o total de uma oferta")
        .addIntegerOption((option) => option.setName("pais_id").setDescription("ID do país comprador").setRequired(true).setMinValue(1))
        .addStringOption((option) => option.setName("oferta_id").setDescription("ID da oferta").setRequired(true))
        .addNumberOption((option) => option.setName("quantidade").setDescription("Quantidade comprada").setRequired(true).setMinValue(0.01)),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("cancelar").setDescription("Cancela oferta aberta e devolve o saldo reservado")
        .addStringOption((option) => option.setName("oferta_id").setDescription("ID da oferta").setRequired(true)),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("catalogo").setDescription("Lista ofertas públicas e estoque global"),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("historico").setDescription("Consulta compras e vendas dos seus países e os preços globais")
        .addIntegerOption((option) => option.setName("pagina").setDescription("Página do histórico").setRequired(false).setMinValue(1)),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("global-comprar").setDescription("Compra estoque do mercado global")
        .addIntegerOption((option) => option.setName("pais_id").setDescription("ID do país").setRequired(true).setMinValue(1))
        .addIntegerOption((option) => option.setName("item_id").setDescription("ID do item").setRequired(true).setMinValue(1))
        .addNumberOption((option) => option.setName("quantidade").setDescription("Quantidade").setRequired(true).setMinValue(0.01)),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("global-vender").setDescription("Vende estoque ao mercado global")
        .addIntegerOption((option) => option.setName("pais_id").setDescription("ID do país").setRequired(true).setMinValue(1))
        .addIntegerOption((option) => option.setName("item_id").setDescription("ID do item").setRequired(true).setMinValue(1))
        .addNumberOption((option) => option.setName("quantidade").setDescription("Quantidade").setRequired(true).setMinValue(0.01)),
    ),

  new SlashCommandBuilder()
    .setName("populacao")
    .setDescription("Consulta e configura população e abastecimento")
    .addSubcommand((subcommand) =>
      subcommand.setName("consultar").setDescription("Consulta população e contador de revolta")
        .addIntegerOption((option) => option.setName("pais_id").setDescription("ID do país").setRequired(true).setMinValue(1)),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("definir").setDescription("Define população, crescimento, necessidade alimentar e revolta")
        .addIntegerOption((option) => option.setName("pais_id").setDescription("ID do país").setRequired(true).setMinValue(1))
        .addIntegerOption((option) => option.setName("populacao").setDescription("População").setRequired(true).setMinValue(0))
        .addNumberOption((option) => option.setName("crescimento_percentual").setDescription("Crescimento anual em %").setRequired(true))
        .addNumberOption((option) => option.setName("alimento_por_pessoa").setDescription("Unidades de alimento por habitante").setRequired(true).setMinValue(0))
        .addNumberOption((option) => option.setName("contador_revolta").setDescription("Contador de revolta").setRequired(true).setMinValue(0)),
    ),

  new SlashCommandBuilder()
    .setName("ano")
    .setDescription("Processa ou desfaz um avanço anual")
    .addSubcommand((subcommand) => subcommand.setName("avancar").setDescription("Processa o próximo ano atomicamente"))
    .addSubcommand((subcommand) => subcommand.setName("desfazer").setDescription("Restaura o estado anterior ao último ano (sem alterações posteriores)")),

  new SlashCommandBuilder()
    .setName("historico")
    .setDescription("Consulta registros auditáveis do jogo")
    .addSubcommand((subcommand) =>
      subcommand.setName("financeiro").setDescription("Consulta o extrato de um país")
        .addIntegerOption((option) => option.setName("pais_id").setDescription("ID do país").setRequired(true).setMinValue(1))
        .addIntegerOption((option) => option.setName("pagina").setDescription("Página do extrato").setRequired(false).setMinValue(1)),
    )
    .addSubcommand((subcommand) => subcommand.setName("anos").setDescription("Lista processamentos e reversões anuais")
      .addIntegerOption((option) => option.setName("pagina").setDescription("Página do histórico").setRequired(false).setMinValue(1)))
    .addSubcommand((subcommand) => subcommand.setName("auditoria").setDescription("Lista alterações administrativas recentes")
      .addIntegerOption((option) => option.setName("pagina").setDescription("Página do histórico").setRequired(false).setMinValue(1))),

  new SlashCommandBuilder().setName("narrador").setDescription("Nomeia ou remove narradores (Narrador Supremo)")
    .addSubcommand((subcommand) => subcommand.setName("adicionar").setDescription("Nomeia um narrador")
      .addUserOption((option) => option.setName("jogador").setDescription("Jogador que será narrador").setRequired(true)))
    .addSubcommand((subcommand) => subcommand.setName("remover").setDescription("Remove um narrador")
      .addUserOption((option) => option.setName("jogador").setDescription("Narrador a remover").setRequired(true))),

  new SlashCommandBuilder().setName("saldo").setDescription("Abre o painel financeiro do seu país")
    .addStringOption((option) => option.setName("pais").setDescription("País (necessário se você controla mais de um)").setRequired(false).setMaxLength(80)),

  new SlashCommandBuilder().setName("gastar").setDescription("Registra um gasto imediato do seu país")
    .addNumberOption((option) => option.setName("valor").setDescription("Valor gasto").setRequired(true).setMinValue(0.01))
    .addStringOption((option) => option.setName("motivo").setDescription("Motivo do gasto").setRequired(true).setMaxLength(200))
    .addStringOption((option) => option.setName("pais").setDescription("País (necessário se você controla mais de um)").setRequired(false).setMaxLength(80)),

  new SlashCommandBuilder().setName("dinheiro").setDescription("Administração do saldo (narradores)")
    .addSubcommand((subcommand) => subcommand.setName("adicionar").setDescription("Adiciona dinheiro ao país")
      .addStringOption((option) => option.setName("pais").setDescription("Nome do país").setRequired(true).setMaxLength(80))
      .addNumberOption((option) => option.setName("valor").setDescription("Valor positivo").setRequired(true).setMinValue(0.01))
      .addStringOption((option) => option.setName("motivo").setDescription("Motivo").setRequired(true).setMaxLength(200)))
    .addSubcommand((subcommand) => subcommand.setName("remover").setDescription("Remove dinheiro do país")
      .addStringOption((option) => option.setName("pais").setDescription("Nome do país").setRequired(true).setMaxLength(80))
      .addNumberOption((option) => option.setName("valor").setDescription("Valor positivo").setRequired(true).setMinValue(0.01))
      .addStringOption((option) => option.setName("motivo").setDescription("Motivo").setRequired(true).setMaxLength(200)))
    .addSubcommand((subcommand) => subcommand.setName("definir").setDescription("Define o saldo exato do país")
      .addStringOption((option) => option.setName("pais").setDescription("Nome do país").setRequired(true).setMaxLength(80))
      .addNumberOption((option) => option.setName("saldo").setDescription("Novo saldo").setRequired(true))
      .addStringOption((option) => option.setName("motivo").setDescription("Motivo").setRequired(true).setMaxLength(200))),

  new SlashCommandBuilder().setName("rendimento").setDescription("Registra um rendimento ou despesa anual (narradores)")
    .addSubcommand((subcommand) => subcommand.setName("adicionar").setDescription("Adiciona um lançamento anual positivo ou negativo")
      .addStringOption((option) => option.setName("pais").setDescription("Nome do país").setRequired(true).setMaxLength(80))
      .addNumberOption((option) => option.setName("saldo").setDescription("Valor positivo ou negativo").setRequired(true))
      .addStringOption((option) => option.setName("motivo").setDescription("Motivo obrigatório").setRequired(true).setMaxLength(200))),

  new SlashCommandBuilder().setName("ajuda").setDescription("Lista comandos e primeiros passos"),
  new SlashCommandBuilder().setName("ping").setDescription("Verifica se o bot está respondendo"),
].map((builder) => builder.toJSON());

export const narratorPermissions: Record<string, readonly string[]> = {
  countries: ["create", "edit", "archive", "read"],
  economy: ["configure", "edit", "read", "transfer", "inflate"],
  inventory: ["create", "edit", "read"],
  production: ["configure", "start", "cancel", "read"],
  population: ["edit", "configure", "read"],
  market: ["configure", "manage", "cancel", "read", "buy", "sell"],
  players: ["manage", "read"],
  indicators: ["configure", "edit", "read"],
  year: ["advance", "undo", "read"],
  narrators: ["grant"],
};

export function validNarratorPermission(system: string, action: string): boolean {
  return narratorPermissions[system]?.includes(action) ?? false;
}
