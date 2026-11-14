import {
  SlashCommandBuilder,
  SlashCommandSubcommandBuilder,
} from "discord.js";

function countryId(subcommand: SlashCommandSubcommandBuilder, required = true): SlashCommandSubcommandBuilder {
  return subcommand.addStringOption((option) =>
    option.setName("pais").setDescription("Nome do país").setRequired(required).setMaxLength(80),
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
        .addNumberOption((option) => option.setName("sensibilidade").setDescription("Impacto de oferta e demanda (0 a 5)").setRequired(true).setMinValue(0).setMaxValue(5))
        .addNumberOption((option) => option.setName("aumento_maximo").setDescription("Aumento máximo anual do preço global, em %").setRequired(true).setMinValue(0).setMaxValue(500))
        .addNumberOption((option) => option.setName("recuo_anual").setDescription("Percentual anual de aproximação ao limite de baixa, em %").setRequired(true).setMinValue(0).setMaxValue(100)),
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
    )
    .addSubcommand((subcommand) =>
      countryId(subcommand.setName("excluir").setDescription("EXCLUI DEFINITIVAMENTE o país e seus dados (irreversível)"))
        .addBooleanOption((option) => option.setName("confirmar").setDescription("Confirma a exclusão permanente").setRequired(true)),
    )
    .addSubcommand((subcommand) =>
      countryId(subcommand.setName("geral").setDescription("Visão geral nacional com economia, população, exército, produção e rankings")),
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
        .addStringOption((option) => option.setName("pais").setDescription("Nome do país").setRequired(true).setMaxLength(80))
        .addIntegerOption((option) => option.setName("indicador_id").setDescription("ID do indicador").setRequired(true).setMinValue(1))
        .addStringOption((option) => option.setName("valor").setDescription("Valor, em JSON válido").setRequired(true).setMaxLength(2000)),
    )
    .addSubcommand((subcommand) =>
      countryId(subcommand.setName("consultar").setDescription("Consulta os indicadores acessíveis")),
    ),

  new SlashCommandBuilder()
    .setName("configuracoes")
    .setDescription("Consulta e altera preferências pessoais")
    .addSubcommand((subcommand) =>
      subcommand.setName("pessoais").setDescription("Consulta ou altera as preferências do país associado")
        .addStringOption((option) => option.setName("pais").setDescription("País (opcional se houver apenas um associado)").setRequired(false).setMaxLength(80))
        .addBooleanOption((option) => option.setName("inflacao_automatica").setDescription("Permitir financiamento inflacionário automático").setRequired(false)),
    ),

  new SlashCommandBuilder()
    .setName("economia")
    .setDescription("Configura rendimentos e movimentações econômicas")
    .addSubcommand((subcommand) =>
      subcommand.setName("configurar").setDescription("Define saldo máximo, dívida e renda anual (narrador)")
        .addStringOption((option) => option.setName("pais").setDescription("Nome do país").setRequired(true).setMaxLength(80))
        .addNumberOption((option) => option.setName("limite_divida").setDescription("Dívida máxima").setRequired(true).setMinValue(0))
        .addNumberOption((option) => option.setName("renda_anual").setDescription("Rendimento base anual").setRequired(true).setMinValue(0))
        .addNumberOption((option) => option.setName("limite_saldo").setDescription("Limite máximo; deixe vazio para ilimitado").setRequired(false).setMinValue(0)),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("inflar").setDescription("Emite dinheiro voluntariamente para o país")
        .addStringOption((option) => option.setName("pais").setDescription("Nome do país").setRequired(true).setMaxLength(80))
        .addNumberOption((option) => option.setName("valor").setDescription("Valor emitido").setRequired(true).setMinValue(0.01)),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("devolver-inflacao").setDescription("Devolve exatamente todo o valor emitido")
        .addStringOption((option) => option.setName("pais").setDescription("Nome do país").setRequired(true).setMaxLength(80))
        .addNumberOption((option) => option.setName("valor_exato").setDescription("Total exato emitido").setRequired(true).setMinValue(0.01)),
    ),

  new SlashCommandBuilder()
    .setName("transferir")
    .setDescription("Transfere dinheiro entre países")
    .addStringOption((option) => option.setName("origem").setDescription("Nome do país de origem").setRequired(true).setMaxLength(80))
    .addStringOption((option) => option.setName("destino").setDescription("Nome do país de destino").setRequired(true).setMaxLength(80))
    .addNumberOption((option) => option.setName("valor").setDescription("Valor").setRequired(true).setMinValue(0.01))
    .addStringOption((option) => option.setName("descricao").setDescription("Motivo da transferência").setRequired(false).setMaxLength(200)),

  new SlashCommandBuilder()
    .setName("inventario")
    .setDescription("Gerencia itens, estoques e produção anual")
    .addSubcommand((subcommand) => subcommand.setName("painel").setDescription("Abre o inventário nacional por categorias")
      .addStringOption((option) => option.setName("pais").setDescription("Nome do país (opcional se você controla apenas um)").setRequired(false).setMaxLength(80)))
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
        .addStringOption((option) => option.setName("pais").setDescription("Nome do país").setRequired(true).setMaxLength(80))
        .addStringOption((option) => option.setName("item").setDescription("Nome do item").setRequired(true).setMaxLength(80))
        .addNumberOption((option) => option.setName("variacao").setDescription("Quantidade adicionada ou removida").setRequired(true))
        .addStringOption((option) => option.setName("motivo").setDescription("Motivo").setRequired(true).setMaxLength(200)),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("consultar").setDescription("Consulta o inventário privado de um país")
        .addStringOption((option) => option.setName("pais").setDescription("Nome do país").setRequired(true).setMaxLength(80)),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("producao-anual").setDescription("Define produção e consumo anual de um bem")
        .addStringOption((option) => option.setName("pais").setDescription("Nome do país").setRequired(true).setMaxLength(80))
        .addStringOption((option) => option.setName("item").setDescription("Nome do item").setRequired(true).setMaxLength(80))
        .addNumberOption((option) => option.setName("produz").setDescription("Quantidade anual produzida").setRequired(true).setMinValue(0))
        .addNumberOption((option) => option.setName("consome").setDescription("Quantidade anual consumida (exceto alimento)").setRequired(true).setMinValue(0))
        .addNumberOption((option) => option.setName("exportar_percentual").setDescription("Percentual da produção anual destinado à exportação").setRequired(false).setMinValue(0).setMaxValue(100)),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("requisito").setDescription("Define material necessário para produzir um item")
        .addStringOption((option) => option.setName("produto").setDescription("Nome do produto").setRequired(true).setMaxLength(80))
        .addStringOption((option) => option.setName("material").setDescription("Nome do material").setRequired(true).setMaxLength(80))
        .addNumberOption((option) => option.setName("quantidade").setDescription("Material por unidade produzida").setRequired(true).setMinValue(0.01)),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("fabricacao").setDescription("Ativa ou desativa a fabricação de um item (narrador)")
        .addStringOption((option) => option.setName("item").setDescription("Nome do item").setRequired(true).setMaxLength(80))
        .addBooleanOption((option) => option.setName("habilitada").setDescription("Permitir fabricação").setRequired(true)),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("estoque-global").setDescription("Configura estoque e preço do mercado global")
        .addStringOption((option) => option.setName("item").setDescription("Nome do item").setRequired(true).setMaxLength(80))
        .addNumberOption((option) => option.setName("estoque").setDescription("Quantidade global disponível").setRequired(true).setMinValue(0))
        .addNumberOption((option) => option.setName("preco").setDescription("Preço atual por unidade").setRequired(true).setMinValue(0.01))
        .addNumberOption((option) => option.setName("preco_base").setDescription("Preço-base de referência do item").setRequired(true).setMinValue(0.01))
        .addNumberOption((option) => option.setName("preco_minimo").setDescription("Preço mínimo").setRequired(true).setMinValue(0.01))
        .addNumberOption((option) => option.setName("preco_maximo").setDescription("Preço máximo").setRequired(true).setMinValue(0.01))
        .addNumberOption((option) => option.setName("estoque_maximo").setDescription("Capacidade máxima do estoque global").setRequired(true).setMinValue(0))
        .addNumberOption((option) => option.setName("reposicao_anual").setDescription("Quantidade reposta a cada avanço de ano").setRequired(true).setMinValue(0)),
    ),

  new SlashCommandBuilder()
    .setName("produzir")
    .setDescription("Inicia, acompanha ou cancela produção")
    .addSubcommand((subcommand) =>
      subcommand.setName("iniciar").setDescription("Produz instantaneamente ou cria um pedido temporizado")
        .addStringOption((option) => option.setName("pais").setDescription("Nome do país").setRequired(true).setMaxLength(80))
        .addStringOption((option) => option.setName("item").setDescription("Nome do item").setRequired(true).setMaxLength(80))
        .addNumberOption((option) => option.setName("quantidade").setDescription("Quantidade").setRequired(true).setMinValue(0.01)),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("cancelar").setDescription("Cancela um pedido em andamento e devolve parte dos materiais")
        .addStringOption((option) => option.setName("pedido_id").setDescription("ID do pedido").setRequired(true)),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("fila").setDescription("Consulta os pedidos de produção de um país")
        .addStringOption((option) => option.setName("pais").setDescription("Nome do país").setRequired(true).setMaxLength(80)),
    ),

  new SlashCommandBuilder()
    .setName("mercado")
    .setDescription("Negocia itens entre países ou no mercado global")
    .addSubcommand((subcommand) =>
      subcommand.setName("ofertar").setDescription("Cria uma oferta de venda; o estoque fica reservado")
        .addStringOption((option) => option.setName("pais").setDescription("Nome do país").setRequired(true).setMaxLength(80))
        .addStringOption((option) => option.setName("item").setDescription("Nome do item").setRequired(true).setMaxLength(80))
        .addNumberOption((option) => option.setName("quantidade").setDescription("Quantidade").setRequired(true).setMinValue(0.01))
        .addNumberOption((option) => option.setName("preco_unitario").setDescription("Preço por unidade").setRequired(true).setMinValue(0.01))
        .addStringOption((option) => option.setName("descricao").setDescription("Descrição opcional").setRequired(false).setMaxLength(200)),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("comprar").setDescription("Compra parte ou o total de uma oferta")
        .addStringOption((option) => option.setName("pais").setDescription("Nome do país").setRequired(true).setMaxLength(80))
        .addStringOption((option) => option.setName("oferta_id").setDescription("ID da oferta").setRequired(true))
        .addNumberOption((option) => option.setName("quantidade").setDescription("Quantidade comprada").setRequired(true).setMinValue(0.01)),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("cancelar").setDescription("Cancela oferta aberta e devolve o saldo reservado")
        .addStringOption((option) => option.setName("oferta_id").setDescription("ID da oferta").setRequired(true)),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("catalogo").setDescription("Abre o painel público de ofertas e preços globais"),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("painel").setDescription("Abre o painel público do mercado mundial"),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("historico").setDescription("Consulta compras e vendas dos seus países e os preços globais")
        .addIntegerOption((option) => option.setName("pagina").setDescription("Página do histórico").setRequired(false).setMinValue(1)),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("global-comprar").setDescription("Compra estoque do mercado global")
        .addStringOption((option) => option.setName("pais").setDescription("Nome do país").setRequired(true).setMaxLength(80))
        .addStringOption((option) => option.setName("item").setDescription("Nome do item").setRequired(true).setMaxLength(80))
        .addNumberOption((option) => option.setName("quantidade").setDescription("Quantidade").setRequired(true).setMinValue(0.01)),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("global-vender").setDescription("Vende estoque ao mercado global")
        .addStringOption((option) => option.setName("pais").setDescription("Nome do país").setRequired(true).setMaxLength(80))
        .addStringOption((option) => option.setName("item").setDescription("Nome do item").setRequired(true).setMaxLength(80))
        .addNumberOption((option) => option.setName("quantidade").setDescription("Quantidade").setRequired(true).setMinValue(0.01)),
    ),

  new SlashCommandBuilder()
    .setName("populacao")
    .setDescription("Consulta e configura população e abastecimento")
    .addSubcommand((subcommand) =>
      subcommand.setName("consultar").setDescription("Consulta população e contador de revolta")
        .addStringOption((option) => option.setName("pais").setDescription("Nome do país").setRequired(true).setMaxLength(80)),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("definir").setDescription("Define população, crescimento, necessidade alimentar e revolta")
        .addStringOption((option) => option.setName("pais").setDescription("Nome do país").setRequired(true).setMaxLength(80))
        .addIntegerOption((option) => option.setName("populacao").setDescription("População").setRequired(true).setMinValue(0))
        .addNumberOption((option) => option.setName("crescimento_percentual").setDescription("Crescimento anual em %").setRequired(true))
        .addNumberOption((option) => option.setName("alimento_por_pessoa").setDescription("Unidades de alimento por habitante").setRequired(true).setMinValue(0))
        .addNumberOption((option) => option.setName("contador_revolta").setDescription("Contador de revolta").setRequired(true).setMinValue(0)),
    ),

  new SlashCommandBuilder()
    .setName("negociacao").setDescription("Gerencia acordos anuais recorrentes entre países")
    .addSubcommand((sub) => sub.setName("criar").setDescription("Cria um acordo anual com outro país")
      .addStringOption((o) => o.setName("pais").setDescription("Outro país envolvido").setRequired(true).setMaxLength(80))
      .addStringOption((o) => o.setName("direcao").setDescription("Enviar do seu país ou receber do outro").setRequired(true).addChoices({name:"Enviar",value:"send"},{name:"Receber",value:"receive"}))
      .addStringOption((o) => o.setName("tipo").setDescription("Tipo de transferência").setRequired(true).addChoices({name:"Dinheiro",value:"money"},{name:"Recurso",value:"item"}))
      .addNumberOption((o) => o.setName("quantidade").setDescription("Quantidade por ano").setRequired(true).setMinValue(0.0001))
      .addIntegerOption((o) => o.setName("duracao").setDescription("Anos; 0 = até cancelar").setRequired(true).setMinValue(0))
      .addStringOption((o) => o.setName("item").setDescription("Nome do recurso (obrigatório para tipo Recurso)").setRequired(false).setMaxLength(80))
      .addStringOption((o) => o.setName("descricao").setDescription("Termos do acordo").setRequired(false).setMaxLength(200))
      .addStringOption((o) => o.setName("meu_pais").setDescription("Seu país, se você controla mais de um").setRequired(false).setMaxLength(80)))
    .addSubcommand((sub) => sub.setName("painel").setDescription("Mostra acordos ativos e seu estado"))
    .addSubcommand((sub) => sub.setName("editar").setDescription("Edita quantidade e duração de um acordo")
      .addStringOption((o) => o.setName("id").setDescription("ID exibido no painel").setRequired(true).setMaxLength(36))
      .addNumberOption((o) => o.setName("quantidade").setDescription("Nova quantidade anual").setRequired(true).setMinValue(0.0001))
      .addIntegerOption((o) => o.setName("duracao").setDescription("Anos restantes; 0 = infinito").setRequired(true).setMinValue(0)))
    .addSubcommand((sub) => sub.setName("cancelar").setDescription("Cancela um acordo ativo")
      .addStringOption((o) => o.setName("id").setDescription("ID exibido no painel").setRequired(true).setMaxLength(36))),

  new SlashCommandBuilder()
    .setName("consumo").setDescription("Configura consumo anual por população ou soldado (narrador)")
    .addSubcommand((sub) => sub.setName("configurar").setDescription("Define quanto cada unidade consome de um item por ano")
      .addStringOption((o) => o.setName("pais").setDescription("País").setRequired(true).setMaxLength(80))
      .addStringOption((o) => o.setName("item").setDescription("Item consumido").setRequired(true).setMaxLength(80))
      .addStringOption((o) => o.setName("alvo").setDescription("Quem consome").setRequired(true).addChoices({name:"População",value:"population"},{name:"Exército",value:"army"}))
      .addNumberOption((o) => o.setName("quantidade_por_unidade").setDescription("Quantidade anual por habitante ou soldado").setRequired(true).setMinValue(0))),

  new SlashCommandBuilder()
    .setName("exercito").setDescription("Configura efetivo e equipamentos militares")
    .addSubcommand((sub) => sub.setName("definir").setDescription("Define o efetivo total do país")
      .addStringOption((o) => o.setName("pais").setDescription("País").setRequired(true).setMaxLength(80))
      .addIntegerOption((o) => o.setName("efetivo").setDescription("Número total de soldados").setRequired(true).setMinValue(0)))
    .addSubcommand((sub) => sub.setName("equipamento").setDescription("Atribui soldados a um equipamento sem destruí-lo")
      .addStringOption((o) => o.setName("pais").setDescription("País").setRequired(true).setMaxLength(80))
      .addStringOption((o) => o.setName("item").setDescription("Equipamento militar do inventário").setRequired(true).setMaxLength(80))
      .addIntegerOption((o) => o.setName("soldados").setDescription("Soldados equipados com esse item").setRequired(true).setMinValue(0)))
    .addSubcommand((sub) => sub.setName("consultar").setDescription("Mostra efetivo, equipamentos e soldados sem equipamento")
      .addStringOption((o) => o.setName("pais").setDescription("País").setRequired(true).setMaxLength(80))),

  new SlashCommandBuilder()
    .setName("ano")
    .setDescription("Processa ou desfaz um avanço anual")
    .addSubcommand((subcommand) => subcommand.setName("avancar").setDescription("Processa o próximo ano atomicamente"))
    .addSubcommand((subcommand) => subcommand.setName("desfazer").setDescription("Restaura o estado anterior ao último ano (sem alterações posteriores)"))
    .addSubcommand((subcommand) => subcommand.setName("definir").setDescription("Define o ano atual (narrador)")
      .addIntegerOption((option) => option.setName("ano").setDescription("Ano com quatro dígitos").setRequired(true).setMinValue(1000).setMaxValue(9999))),

  new SlashCommandBuilder()
    .setName("historico")
    .setDescription("Consulta registros auditáveis do jogo")
    .addSubcommand((subcommand) =>
      subcommand.setName("financeiro").setDescription("Consulta o extrato de um país")
        .addStringOption((option) => option.setName("pais").setDescription("Nome do país").setRequired(true).setMaxLength(80))
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

  new SlashCommandBuilder().setName("rendimento").setDescription("Registra imediatamente uma receita ou despesa (narradores)")
    .addSubcommand((subcommand) => subcommand.setName("adicionar").setDescription("Registra um valor positivo ou negativo no exercício atual")
      .addStringOption((option) => option.setName("pais").setDescription("Nome do país").setRequired(true).setMaxLength(80))
      .addNumberOption((option) => option.setName("valor").setDescription("Valor positivo ou negativo").setRequired(true))
      .addStringOption((option) => option.setName("motivo").setDescription("Motivo obrigatório").setRequired(true).setMaxLength(200))),

  new SlashCommandBuilder().setName("ranking").setDescription("Classificações nacionais")
    .addStringOption((option) => option.setName("tipo").setDescription("Indicador do ranking").setRequired(true)
      .addChoices(
        { name: "Economia (saldo)", value: "economy" },
        { name: "População", value: "population" },
        { name: "Produção anual", value: "production" },
        { name: "Estoques", value: "stock" },
        { name: "Crescimento econômico estimado", value: "growth" },
      )),

  new SlashCommandBuilder().setName("ajuda").setDescription("Lista comandos e primeiros passos"),
  new SlashCommandBuilder().setName("ping").setDescription("Verifica se o bot está respondendo"),

  new SlashCommandBuilder()
    .setName("militar")
    .setDescription("Prontidão e modernização das forças armadas")
    .addSubcommand((s) => s.setName("consultar").setDescription("Consulta prontidão, efetivo, equipamentos e manutenção")
      .addStringOption((o) => o.setName("pais").setDescription("País").setRequired(true).setMaxLength(80)))
    .addSubcommand((s) => s.setName("modernizar").setDescription("Substitui equipamento militar antigo por um modelo novo")
      .addStringOption((o) => o.setName("pais").setDescription("País").setRequired(true).setMaxLength(80))
      .addStringOption((o) => o.setName("equipamento_antigo").setDescription("Equipamento a substituir").setRequired(true).setMaxLength(80))
      .addStringOption((o) => o.setName("equipamento_novo").setDescription("Novo equipamento militar").setRequired(true).setMaxLength(80))
      .addNumberOption((o) => o.setName("quantidade").setDescription("Quantidade a modernizar").setRequired(true).setMinValue(0.01))),

  new SlashCommandBuilder()
    .setName("comercio")
    .setDescription("Contratos internacionais, tarifas e restrições comerciais")
    .addSubcommand((s) => s.setName("contrato-criar").setDescription("Propõe contrato anual de exportação e importação")
      .addStringOption((o) => o.setName("vendedor").setDescription("País exportador").setRequired(true).setMaxLength(80))
      .addStringOption((o) => o.setName("comprador").setDescription("País importador").setRequired(true).setMaxLength(80))
      .addStringOption((o) => o.setName("item").setDescription("Recurso negociado").setRequired(true).setMaxLength(80))
      .addNumberOption((o) => o.setName("quantidade_anual").setDescription("Quantidade transferida por ano").setRequired(true).setMinValue(0.01))
      .addNumberOption((o) => o.setName("preco_unitario").setDescription("Preço por unidade").setRequired(true).setMinValue(0.01))
      .addIntegerOption((o) => o.setName("duracao").setDescription("Anos; 0 = duração indefinida").setRequired(true).setMinValue(0))
      .addStringOption((o) => o.setName("termos").setDescription("Condições adicionais").setRequired(false).setMaxLength(200)))
    .addSubcommand((s) => s.setName("contrato-aceitar").setDescription("Aceita uma proposta de contrato")
      .addStringOption((o) => o.setName("id").setDescription("ID do contrato").setRequired(true).setMaxLength(36)))
    .addSubcommand((s) => s.setName("contrato-cancelar").setDescription("Cancela contrato pendente ou ativo")
      .addStringOption((o) => o.setName("id").setDescription("ID do contrato").setRequired(true).setMaxLength(36)))
    .addSubcommand((s) => s.setName("painel").setDescription("Consulta contratos e restrições comerciais"))
    .addSubcommand((s) => s.setName("tarifa").setDescription("Define a tarifa de importação do país")
      .addStringOption((o) => o.setName("pais").setDescription("País importador").setRequired(true).setMaxLength(80))
      .addNumberOption((o) => o.setName("percentual").setDescription("Tarifa sobre o valor importado (0 a 100%)").setRequired(true).setMinValue(0).setMaxValue(100)))
    .addSubcommand((s) => s.setName("restricao-impor").setDescription("Impõe embargo ou bloqueio comercial a outro país")
      .addStringOption((o) => o.setName("pais").setDescription("País que impõe a restrição").setRequired(true).setMaxLength(80))
      .addStringOption((o) => o.setName("alvo").setDescription("País afetado").setRequired(true).setMaxLength(80))
      .addStringOption((o) => o.setName("tipo").setDescription("Tipo de restrição").setRequired(true).addChoices({name:"Embargo",value:"embargo"},{name:"Bloqueio comercial",value:"blockade"}))
      .addStringOption((o) => o.setName("motivo").setDescription("Justificativa").setRequired(true).setMaxLength(200))
      .addStringOption((o) => o.setName("item").setDescription("Item específico (opcional; bloqueio sempre é geral)").setRequired(false).setMaxLength(80)))
    .addSubcommand((s) => s.setName("restricao-levantar").setDescription("Encerra uma restrição imposta pelo seu país")
      .addStringOption((o) => o.setName("id").setDescription("ID da restrição").setRequired(true).setMaxLength(36)))
    .addSubcommand((s) => s.setName("dependencia").setDescription("Analisa a dependência de fornecedores externos")
      .addStringOption((o) => o.setName("pais").setDescription("País importador").setRequired(true).setMaxLength(80))),

].map((builder) => builder.toJSON());

