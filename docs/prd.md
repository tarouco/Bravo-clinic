# Product Requirements Document: Bravô Clinic – Salas Inteligentes (Sistema de Reservas)

**Versão**: 1.6
**Data**: 2026-09-26 · **Atualizado**: 2026-10-25
**Autora**: Sarah (Product Owner) — para Eduardo Mathias Tarouco
**Quality Score**: 97/100
**Status**: Aprovado para design/arquitetura · sem questões em aberto · preços padrão são exemplos, definidos pelo Admin no primeiro acesso

---

## 1. Resumo Executivo

A Bravô Clinic – Salas Inteligentes é um espaço premium de saúde, beleza e bem-estar na **Praia Brava, em Itajaí (SC)**. Ela aluga **3 salas** para profissionais autônomos: médicos, esteticistas, terapeutas, massoterapeutas e criadores de conteúdo. A clínica está em **pré-lançamento**. O sistema de reservas nasce junto com a operação e é o principal canal de venda.

O cliente pode:
- reservar horas avulsas;
- assinar um **pacote mensal de horas**: um saldo de horas que se renova a cada período, cobrado de forma recorrente;
- assinar um **pacote de horário fixo**: por exemplo, "segunda a sexta, das 08:00 às 10:00", com a agenda reservada para ele em cada período.

O produto tem três interfaces sobre a mesma base de dados e o mesmo motor de preços:
- um **Website público**: vitrine das salas, disponibilidade com descontos em destaque, simulação de preço, reserva, compra de pacotes e pagamento;
- um **App PWA** para o locatário: tudo o que o site faz, mais "Minhas reservas", menu **Compras** (assinaturas, horas extras e créditos), agenda pessoal, reagendamento, pagamento do saldo e sincronização com Google Calendar ou Outlook;
- um **Admin** para o Administrador geral e a recepção, com estas telas:
  - **Calendário** (funcionamento, slots e categorias de reserva);
  - **Gestão de Reservas**;
  - **Financeiro**, com DRE por caixa ou competência;
  - **Integrações**, incluindo gateway de pagamento, agenda, MCP e e-mail;
  - **Cupons**;
  - **Serviços Extras**.

O impacto esperado é vender horas ociosas (noites e fins de semana) e eliminar o agendamento e a cobrança manuais. O sistema também reduz faltas com o pagamento antecipado e cria **receita recorrente previsível** com as assinaturas de pacotes. Por fim, gera demanda para os serviços extras (filmagem, videomaker e marketing digital).

---

## 2. Problema

**Situação atual**: a clínica ainda não opera. Sem sistema, a operação dependeria de WhatsApp, planilha e cobrança manual. Esse modelo não escala para 3 salas × vários horários × 7 dias, gera conflitos de agenda e deixa a clínica exposta a faltas sem garantia financeira.

**Solução proposta**: uma plataforma self-service de reservas e assinaturas com pagamento online e cobrança recorrente. As regras de preço e de política são aplicadas automaticamente, e um painel de gestão centralizado permite ao Administrador geral configurar tudo sem depender de desenvolvedor.

**Impacto no negócio**:
- receita previsível: sinal garantido nas reservas avulsas e assinaturas pagas antecipadamente;
- ≥85% das reservas feitas sem intervenção humana;
- ocupação sustentável de períodos de baixa demanda (noite e fim de semana), com descontos pontuais por horário;
- visão financeira consolidada (recebimentos, despesas e DRE) sem planilhas paralelas;
- canal de captação para os serviços de maior margem (videomaker e marketing digital).

---

## 3. Métricas de Sucesso

Como a clínica está em pré-lançamento, as metas abaixo são **metas de ramp-up propostas**, a validar com o Administrador geral. O início da contagem é a data de abertura.

| KPI | Meta | Como medir |
|---|---|---|
| Taxa de ocupação global | **40% em 3 meses · 60% em 6 meses** | horas vendidas ÷ horas de funcionamento (por sala, período e semana). O tempo de bloqueios (limpeza, indisponível etc.) é reportado à parte e não conta como hora vendida |
| Ocupação noite + fim de semana | **≥25% em 6 meses** | mesma fórmula, filtrada por horário e tipo de dia |
| Receita de assinaturas | **≥30% da receita de locação no mês 6** | receita de pacotes de horas + pacotes de horário fixo ÷ receita total de locação |
| Renovação de assinaturas | **≥80% ao mês** | assinaturas renovadas ÷ assinaturas que venceram no mês |
| Reservas self-service | **≥85%** | reservas criadas no site/app ÷ total (o restante é criado no Admin) |
| No-show | **≤5%** | reservas sem check-in ÷ reservas confirmadas |
| Saldo pago em dia | **≥95%** | reservas com saldo quitado no prazo ÷ reservas elegíveis |
| Conversão do site | **≥2%** | visitantes únicos → reserva ou assinatura paga |
| Pedidos de orçamento de extras | **≥10/mês até o mês 6** | pedidos criados no site/app/Admin |
| Tempo para concluir a reserva | **≤3 min (mediana)** | do "Reservar" até o pagamento confirmado |

**Validação**: tela Financeiro e relatórios de ocupação no Admin, com revisão mensal. Os eventos de funil (visita → sala → horário → checkout → pago) são instrumentados desde o dia 1, por exemplo com GA4 ou PostHog.

---

## 4. Personas

### Primária: Dra. Camila — profissional de saúde autônoma
- **Perfil**: dermatologista ou nutricionista que atende em horários fixos toda semana e não quer arcar com um consultório próprio.
- **Objetivos**: assinar um pacote de horário fixo (ex.: terças e quintas de manhã), ver tudo na própria agenda e ter um ambiente que transmita credibilidade ao paciente.
- **Dores**: reservas por WhatsApp, incerteza de disponibilidade, reagendamentos burocráticos.
- **Nível técnico**: intermediário; usa principalmente o celular.

### Primária: Juliana — esteticista / massoterapeuta
- **Perfil**: atende com agenda variável e é sensível a preço.
- **Objetivos**: assinar um pacote mensal de horas para pagar menos por hora, reservar rapidamente, aproveitar horários com desconto e reservar em cima da hora quando surge um cliente.
- **Dores**: pagar por um período maior do que precisa e não saber o preço final antes de fechar.
- **Nível técnico**: intermediário, mobile-first.

### Secundária: Rafael — criador de conteúdo da área de saúde e bem-estar
- **Perfil**: grava vídeos para as redes sociais e precisa de um cenário bonito e bem iluminado.
- **Objetivos**: reservar horas avulsas para gravação e contratar videomaker e marketing.
- **Nível técnico**: avançado.

### Interna: Administrador geral e Recepção
- **Administrador geral (gestor da clínica)**:
  - configura funcionamento, slots, categorias, preços, políticas, cupons, extras e integrações;
  - acompanha ocupação, assinaturas e finanças, aprova exceções e responde orçamentos.
  - Pode operar o sistema também pelo seu assistente de IA, via MCP.
- **Recepção**: confere as reservas do dia, faz o check-in, libera a sala e cria reservas e pré-reservas de balcão ou telefone.
- **Nível técnico**: intermediário.

---

## 5. Regras de Negócio

> Todos os valores, horários, janelas e prazos abaixo são **parâmetros configuráveis pelo Administrador geral** nas telas do Admin (§7.3). Os números citados são os **valores padrão** de fábrica. Nada é fixo no código.

### 5.1 Salas

| Sala | Ideal para |
|---|---|
| **Principal** | Médico, estética, gravação de vídeos |
| **Secundária** | Médico, estética, gravação de vídeos |
| **Terceira** | Massagem, terapia, estética |

Cada sala tem: nome, descrição, "ideal para" (tags), galeria de fotos, equipamentos, status (ativa/inativa) e ordem de exibição. **O preço é igual para as 3 salas** (o modelo de dados permite preço por sala no futuro). Os serviços extras podem ser contratados em **qualquer sala** (§5.6).

### 5.2 Calendário, horário de funcionamento e slots

Tudo nesta seção é configurado na tela **Calendário** (§7.3.1).

**Horário de funcionamento**
- O Administrador geral define início e fim do funcionamento **para cada dia da semana (segunda a domingo)** e para **feriados**. Atalhos permitem aplicar o mesmo horário a "segunda a sexta" e a "sábado, domingo e feriados".
- Padrão de fábrica:

| Dias | Funcionamento padrão |
|---|---|
| Segunda a sexta | 07:00–00:00 |
| Sábado, domingo e feriados | 09:00–00:00 |

- Por padrão, a clínica **abre todos os dias**, inclusive domingos e feriados. Só fica fechada nas datas que o Administrador geral marcar como fechadas.

**Slots e duração**
- **Granularidade do slot** (passo da grade de horários): configurável, **padrão de 30 min**. Toda reserva começa e termina em múltiplos do slot.
- **Duração padrão da reserva**: **60 min** (configurável). É também a **duração mínima** de qualquer reserva.
- A agenda é **contínua**: uma reserva pode atravessar janelas de categorias diferentes (ex.: 17:30–20:00), desde que esteja dentro do horário de funcionamento. Cada trecho é cobrado pelo valor-hora da categoria que vale naquele horário.
- **Antecedência máxima** para reservar: **90 dias**.

**Dias fechados**
- O Administrador geral pode marcar uma data específica como **inteiramente fechada** (sem reservas), para a clínica toda ou para salas específicas, com um motivo opcional.
- Se já houver reservas na data, o sistema lista essas reservas e exige que sejam realocadas ou canceladas (com reembolso integral ou crédito) antes de concluir o fechamento.
- **Compensação a assinantes**: cada dia fechado dentro do período de faturamento gera para os assinantes uma compensação de **1/30 do pacote** (1/60 no bimestral; 1/90 no trimestral), conforme as §5.3.1 e §5.3.2.

**Feriados**
- **Nacionais**: os do calendário oficial brasileiro são importados automaticamente (ex.: BrasilAPI) **para o ano corrente e para o ano seguinte**. Isso cobre a antecedência máxima de 90 dias na virada do ano. Os feriados aparecem **com um alerta no calendário** antes da data.
- **Estaduais (SC) e municipais (Itajaí)**: vêm pré-cadastrados **para o ano corrente e o seguinte**.
  - Todo ano, em **1º de outubro**, o sistema avisa o Administrador geral para conferir e carregar a lista do ano seguinte.
  - Lista inicial (**a conferir com a Prefeitura de Itajaí e o calendário oficial de SC**):

| Feriado | Âmbito | 2026 | 2027 |
|---|---|---|---|
| Corpus Christi | Municipal (Itajaí) | 04/06 (qui) | 27/05 (qui) |
| Aniversário de Itajaí | Municipal | 15/06 (seg) | 15/06 (ter) |
| Dia do Estado de Santa Catarina (Data Magna) | Estadual | 16/08 (dom) | a confirmar a data de observância |
| Nossa Senhora da Imaculada Conceição (padroeira) | Municipal | 08/12 (ter) | 08/12 (qua) |

- Para cada feriado, o Administrador geral decide se a clínica abre, com o horário e os preços de feriado, ou se o dia fica fechado. O padrão é **aberto com regras de feriado**.
- Pontos facultativos (ex.: Carnaval) são cadastrados manualmente.

**Fuso horário único**: America/Sao_Paulo.

### 5.2.1 Bloqueios de slot

Há dois tipos de bloqueio.

**a) Bloqueio de limpeza automático (obrigatório)**

Ao fim de **toda reserva, de qualquer categoria**, o sistema insere um **bloqueio de limpeza**, com **padrão de 30 min** (configurável). O próximo horário disponível da sala só começa quando a limpeza termina.

- **Abrangência**: vale para reservas avulsas, reservas pagas com pacote de horas, cada ocorrência de um pacote de horário fixo, pré-reservas e reservas manuais do Admin. Exemplo: reserva 09:00–11:00 → limpeza 11:00–11:30 → próxima reserva possível às 11:30.
- **Não é cobrado** do locatário, não debita horas de pacote e **não aparece** na agenda pessoal dele (ICS). Ele aparece no Admin; no site e no app, o horário só aparece como indisponível.
- **Vale nos dois sentidos**:
  - uma nova reserva não pode começar antes de *término da anterior + limpeza*;
  - uma nova reserva também precisa terminar pelo menos o tempo de limpeza antes da reserva seguinte.
- **Acompanha a reserva**: o bloqueio se move no reagendamento e é liberado no cancelamento e na expiração.
- **Sem bloqueio antes da primeira reserva do dia** (a sala abre limpa).
- **Alinhamento com a grade**: se a duração da limpeza não for múltipla do slot, o próximo início possível é arredondado para o slot seguinte. A tela Calendário avisa o Administrador geral dessa perda de tempo vendável.
- **Mudança de duração**: se a duração da limpeza for aumentada, o sistema lista as reservas futuras que passariam a conflitar. A mudança só é aplicada depois que esses conflitos forem resolvidos.
- **Exceção manual**: só o Administrador geral pode reduzir ou remover o bloqueio de uma reserva específica (ex.: o mesmo locatário emendando dois horários). A justificativa fica registrada no log de auditoria.

**b) Bloqueio manual com tag**
- O Administrador geral pode bloquear qualquer slot ou intervalo, de uma ou mais salas, com uma **tag**:
  - tags pré-definidas: "Limpeza" e "Indisponível";
  - ou **qualquer texto livre** que ele digitar (ex.: "Manutenção do ar", "Sessão de fotos da marca").
- O bloqueio pode ser único ou recorrente (ex.: "toda segunda 07:00–08:00 — Limpeza profunda").
- Bloqueios manuais não geram bloqueio de limpeza automático.

**Exemplos de bloqueio de limpeza (Sala Principal, terça, slot de 30 min, limpeza de 30 min)**

| Reservas existentes | Bloqueios gerados | Próximo início possível | Tentativa rejeitada |
|---|---|---|---|
| 09:00–11:00 | 11:00–11:30 | 11:30 | 11:00–12:00 ("sala em limpeza") |
| 09:00–11:00 e 14:00–16:00 | 11:00–11:30 e 16:00–16:30 | entre elas: 11:30, com término até 13:30 | 12:00–14:00 (termina sem os 30 min antes das 14:00) |
| 08:00–10:00 (pacote de horário fixo, seg–sex) | 10:00–10:30 em cada dia | 10:30 | 10:00–11:00 |

### 5.3 Tabela de valores e categorias de reserva

A tabela de valores é **100% configurável** na tela Calendário (§7.3.1). Ela é organizada em **categorias de reserva**, e o Administrador geral pode criar quantas quiser. Para cada categoria de horários e datas, o Administrador geral define o **valor da hora**.

**Tipos de categoria**

| Tipo | O que é | Pagamento |
|---|---|---|
| **Hora avulsa** | Cobra por hora reservada, dentro de uma janela de horários e dias da semana. Exemplos: "1 hora — dias úteis 07:00–19:00", "1 hora — noite 19:00–00:00", "1 hora — fim de semana e feriados" | Sinal + saldo (§5.4) |
| **Bloco avulso** | Janela fixa com preço fechado, para uma data. Ex.: "Manhã 07:00–12:00" | Sinal + saldo (§5.4) |
| **Pacote de horas (assinatura)** | Saldo de horas por período (mensal = 30 dias; bimestral = 60; trimestral = 90), com renovação automática (§5.3.1) | Antecipado + cobrança recorrente |
| **Pacote de horário fixo (assinatura)** | Dias da semana + janela fixa reservados ao cliente em cada período. Ex.: "Mensal — segunda a sexta, 08:00–10:00". Preço por ocorrência × ocorrências do período (§5.3.2) | Antecipado + cobrança recorrente |

**Campos de cada categoria**

| Campo | Descrição |
|---|---|
| Nome | Ex.: "1 hora", "Pacote 20h mensal", "Mensal seg–sex 08:00–10:00" |
| Tipo | Um dos quatro tipos acima |
| Dias e janela de horário | Dias da semana (e feriados) e horário de início e fim em que a categoria vale. Obrigatório para Bloco e Pacote de horário fixo |
| Valor da hora (avulsa) | Valor de segunda a sexta e valor de sábado, domingo e feriados |
| Duração mínima (avulsa) | Duração a partir da qual a categoria vale (ex.: "2 horas ou mais"). Padrão: 1h |
| Preço fechado (Bloco e pacote de horas) | **Um único preço**. Nos pacotes de horas, a referência é o valor-hora padrão de segunda a sexta |
| Preço por ocorrência (pacote de horário fixo) | Valor de cada ocorrência. O preço do período é esse valor × número de ocorrências do período |
| Horas incluídas | Informado nos pacotes de horas; calculado nos demais tipos |
| Período | Avulso, mensal (30 dias), bimestral (60 dias) ou trimestral (90 dias) |
| Status e visibilidade | Ativa/inativa; visível no site/app ou só no Admin |

**Categoria de referência**: uma categoria de Hora avulsa é marcada como **referência de valor-hora padrão de segunda a sexta**. No padrão de fábrica, é a categoria "1 hora", e o valor dela é chamado de **V_ref**. É a partir dele que se calcula o débito proporcional dos pacotes de horas (§5.3.1).

**Valor médio da hora**: ao lado de cada valor digitado, a tela mostra em tempo real o **valor médio da hora** da categoria (valor ÷ horas incluídas):
- **pacote de horas**: preço ÷ horas do pacote;
- **pacote de horário fixo**: preço por ocorrência ÷ duração da janela. Exemplo: meio turno de 2h30 a R$ 280 → R$ 112,00/h. A tela também mostra o preço estimado do período (ex.: seg–sex ≈ 21–22 ocorrências por mês).
- Exemplo de exibição: "Pacote 20h mensal — R$ 1.600,00 → **R$ 80,00/h**".

**Categorias padrão de fábrica**: os valores e as janelas vêm do **briefing original** e são **apenas exemplos**. Os preços reais serão definidos pelo Administrador geral no primeiro acesso ao sistema, e tudo é editável.

| Categoria | Tipo | Dias e janela | Duração mín. | Seg–sex | Sáb, dom e feriados |
|---|---|---|---|---|---|
| 1 hora (referência V_ref) | Hora avulsa | todos os dias, até 19:00 | 1h | R$ 97,00/h | R$ 120,00/h |
| 2 horas ou mais | Hora avulsa | todos os dias, até 19:00 | 2h | R$ 80,00/h | R$ 99,00/h |
| 1 hora — noite | Hora avulsa | todos os dias, 19:00–00:00 | 1h | R$ 120,00/h | R$ 120,00/h |
| 2 horas ou mais — noite | Hora avulsa | todos os dias, 19:00–00:00 | 2h | R$ 99,00/h | R$ 99,00/h |

| Categoria | Tipo | Período | Dias e janela | Preço |
|---|---|---|---|---|
| Meio turno mensal | Pacote de horário fixo | Mensal | seg–sex, 07:00–09:30 | R$ 280,00 por ocorrência |
| Turno mensal | Pacote de horário fixo | Mensal | seg–sex, 07:00–12:00 | R$ 500,00 por ocorrência |
| Pacote 20h mensal | Pacote de horas | Mensal | 20h | R$ 1.600,00 (R$ 80,00/h) |
| Pacote 30h mensal | Pacote de horas | Mensal | 30h | R$ 2.400,00 (R$ 80,00/h) |

- Os pacotes de horas usam como valor-hora a tarifa de "2 horas ou mais" em dia útil do briefing (R$ 80/h).
- Os blocos avulsos do briefing podem ser criados pelo Administrador geral como categorias do tipo Bloco avulso:
  - meio turno R$ 280 e turno R$ 500, em dia útil;
  - noite 19h–0h por R$ 400;
  - meio turno de fim de semana por R$ 400.
- **Pacote de filmagem** (serviço extra): R$ 80/h.

**Regras gerais de preço**
- O preço de cada reserva é **congelado no momento da reserva**. Mudanças na tabela valem só para reservas e compras novas e para as renovações seguintes, com aviso prévio ao assinante.
- **Escolha automática entre categorias de Hora avulsa**: quando mais de uma vale para o mesmo dia e horário, aplica-se a de **maior duração mínima atendida** pela reserva. Exemplo: 3h numa terça às 14:00 usam "2 horas ou mais" (R$ 80/h); 1h usa "1 hora" (R$ 97).
- O valor-hora de um slot (**V_slot**) é o valor da categoria de Hora avulsa que se aplicaria àquela reserva, naquele dia e horário. Feriados usam o valor de fim de semana.
- O resumo do checkout sempre mostra a memória de cálculo: categoria, horas, valor, descontos, créditos e total.

### 5.3.1 Pacotes de horas (assinatura)

**Contratação e período**
- O cliente escolhe o pacote e uma **data base**, que é o início do primeiro período.
- O **primeiro período é pago antecipadamente**, no ato da compra.
- Cada período dura 30 dias (mensal), 60 (bimestral) ou 90 (trimestral), contados da data base.
- **Renovação automática**: o pacote se renova a cada data base. A cobrança do período seguinte é feita **2 dias antes da data base**:
  - no cartão salvo, de forma automática;
  - ou por Pix gerado, com lembretes.
- **Horas não são cumulativas**: ao fim do período, as horas não usadas **são perdidas**, e o novo período começa com a quantidade de horas do pacote vigente. O app avisa 7 dias e 1 dia antes do fim do período.
- **Uso por período**: as horas do pacote valem **só para reservas com data dentro do período de faturamento corrente**.
  - As horas do período seguinte ficam disponíveis na data base desse novo período.
  - Para reservar datas além do período corrente, o cliente usa horas extras (que podem ser usadas à frente) ou paga a reserva normalmente.

**Débito proporcional ao valor do slot**

O preço do pacote é único e tem como referência o valor-hora padrão de segunda a sexta (V_ref). Se o cliente usa as horas em um slot com valor-hora maior que V_ref (noite, fim de semana, feriado etc.), o sistema debita **tempo a mais**, proporcional ao valor excedente:

> **Minutos debitados = minutos reservados + [ (V_slot − V_ref) × horas reservadas ] ÷ (V_pac ÷ 60)**
>
> em que **V_pac** = preço do pacote ÷ horas do pacote (valor-hora do pacote) e (V_slot − V_ref) nunca é menor que zero.

- O resultado é arredondado para cima, ao minuto inteiro. Se a reserva atravessa slots com valores diferentes, o cálculo é feito por trecho e somado.
- Em slots com V_slot igual ou menor que V_ref, o débito é igual à duração da reserva.
- O checkout mostra "Esta reserva vai debitar X min do seu pacote" antes da confirmação.

| Exemplo (valores padrão) | V_ref | V_pac | V_slot | Reserva | Excedente | Minutos debitados |
|---|---|---|---|---|---|---|
| Terça, 10:00–12:00 | R$ 97 | R$ 80 | R$ 80 ("2 horas ou mais") | 2h | R$ 0 | **120 min** |
| Quarta, 19:00–20:00 (noite) | R$ 97 | R$ 80 (R$ 1,3333/min) | R$ 120 ("1 hora — noite") | 1h | R$ 23 → 23 ÷ 1,3333 = 17,25 → 18 min | **78 min** |
| Sábado, 10:00–13:00 | R$ 97 | R$ 80 (R$ 1,3333/min) | R$ 99 ("2 horas ou mais", fim de semana) | 3h | R$ 2 × 3 = R$ 6 → 6 ÷ 1,3333 = 4,5 → 5 min | **185 min** |
| Exemplo do briefing (valores hipotéticos) | R$ 50 | R$ 50 (R$ 0,8333/min) | R$ 70 | 1h | R$ 20 → 20 ÷ 0,8333 = 24 min | **84 min** |

**Saldo menor que a duração mínima**: como toda reserva tem no mínimo 60 min (e pode debitar mais em slots mais caros), o cliente pode ficar com um resto de saldo insuficiente para reservar. Nesse caso, o sistema não permite a reserva com o pacote e oferece duas saídas: comprar horas extras ou pagar a reserva normalmente.

**Horas extras**
- Disponíveis **apenas para assinantes de um pacote de horas ativo**, em **Perfil → Compras → Horas extras**.
- O cliente escolhe de **1 a 20 horas extras**, pagas na hora pelo **valor-hora do pacote que ele assina** (V_pac).
- As horas extras ficam num **saldo próprio** e **não vencem com o período**. Elas podem ser usadas em reservas dentro do período corrente ou em datas à frente, até o limite de antecedência máxima de reservas (90 dias).
- Validade de **90 dias a partir da compra**, igual à antecedência máxima de reservas. O débito proporcional também vale para as horas extras.
- **Ordem de débito**: numa reserva dentro do período corrente, primeiro são usadas as horas do pacote e depois as horas extras. Numa reserva em data além do período, só as horas extras.

**Mudança e cancelamento de pacote** (em **Perfil → Compras**, a qualquer momento, com **efeito imediato**)
- **Aumento** (pacote com mais horas) ou **redução** (pacote com menos horas):
  - o novo pacote passa a valer na hora;
  - as horas de saldo do pacote anterior **continuam como saldo positivo**, recalculadas para o valor-hora do novo pacote, de modo a preservar o valor em reais:
    > **Saldo convertido = horas de saldo × V_pac antigo ÷ V_pac novo**
  - Exemplo: 6h de saldo num pacote de R$ 80/h (R$ 480) convertidas para um pacote de R$ 75/h viram 480 ÷ 75 = **6,4h**, somadas às horas do novo pacote.
  - A troca inicia um **novo período na data da troca**, que passa a ser a nova data base, com a cobrança do novo pacote no ato.
- **Cancelamento**: vale na hora. A renovação é interrompida e as **horas de saldo do período são perdidas**, sem reembolso.
  - As reservas já feitas com horas do pacote continuam válidas.
  - As horas extras compradas continuam valendo até a validade delas.

**Dia fechado no período**
- Para cada dia que o Administrador geral marcar como fechado dentro do período de faturamento, o assinante recebe **1/30 das horas do pacote** como compensação (1/60 no bimestral; 1/90 no trimestral). Exemplo: no pacote de 20h, cada dia fechado gera 40 min.
- Essas horas entram no saldo de horas extras, com as mesmas regras de uso e validade.

**Falha na renovação**
- Se a cobrança não for paga até a data base, o novo período **não começa**: não há novas horas e a assinatura fica "suspensa".
- O cliente pode regularizar pelo app em até 7 dias (configurável). Depois disso, a assinatura é encerrada.

**Cancelamento de reserva paga com pacote**
- Os minutos debitados voltam ao saldo se o cancelamento respeitar o prazo de cancelamento da §5.5 e a reserva ainda estiver dentro do período vigente. Fora do prazo, os minutos são consumidos.
- O app e o Admin mostram **saldo, data base, próxima cobrança e extrato** (compras, renovações, débitos, estornos, horas extras e expirações).
- Só o Administrador geral pode ajustar manualmente o saldo de um cliente, com registro no log.

### 5.3.2 Pacotes de horário fixo (assinatura)

- O Administrador geral cria categorias com **dias da semana + janela fixa + período + preço**. Exemplos:
  - "Mensal — segunda a sexta, 08:00–10:00";
  - "Mensal — terças e quintas, 14:00–18:00".
  - O "meio turno mensal" e o "turno mensal" padrão são desse tipo.
- **Compra**: o cliente escolhe a categoria, a sala e, no calendário, a **data de início** (data base).
  - O sistema verifica todas as ocorrências do período. Se houver conflito (reserva, bloqueio ou dia fechado), mostra as datas e oferece outra sala ou outra data de início.
  - Sem conflito, o sistema **reserva todas as ocorrências** do período para o cliente, cada uma com o bloqueio de limpeza logo após o término.
- **Preço do período**: preço por ocorrência × número de ocorrências do período, calculado na compra e em cada renovação. Exemplo: meio turno mensal seg–sex a R$ 280 com 22 ocorrências = R$ 6.160,00.
- **Pagamento**: antecipado na compra, com renovação automática cobrada **2 dias antes da data base** (cartão ou Pix), como na §5.3.1.
- **Reserva do período seguinte**: enquanto a assinatura está ativa, as ocorrências do período seguinte ficam **pré-reservadas para o cliente**. Elas são liberadas se a renovação falhar ou se o cliente cancelar a renovação.
- **Feriados**: a clínica abre normalmente em feriados (padrão), então as ocorrências acontecem.
- **Dias fechados**: se o Administrador geral marcar um dia como fechado, a ocorrência daquele dia (se houver) não acontece. Para cada dia fechado no período, o assinante recebe **crédito de 1/30 do preço do período** (1/60 no bimestral; 1/90 no trimestral), lançado em Créditos (§5.3.5).
- **Mudança e cancelamento**: têm efeito imediato, como na §5.3.1.
  - No cancelamento, as ocorrências futuras do período são liberadas, sem reembolso.
  - Na troca de categoria, as ocorrências futuras do pacote anterior são liberadas, sem conversão de valor. As do novo pacote são reservadas a partir da data da troca, que passa a ser a nova data base.
- **Faltas e reagendamento**: cada ocorrência segue as regras de reagendamento e cancelamento da §5.5. Uma ocorrência cancelada pelo cliente **não gera reembolso**, porque o preço da assinatura é fechado.
- O Administrador geral também pode **vender uma assinatura de horário fixo** para um cliente pelo Admin.

### 5.3.3 Descontos por slot

- Na tela Gestão de Reservas, o Administrador geral pode aplicar um **desconto percentual** (ex.: 10%) a um slot livre ou a um intervalo de slots livres, em uma ou mais salas.
- No calendário público (site e app), os slots com desconto aparecem **em destaque**, com o percentual.
- O desconto vale sobre o valor-hora das reservas avulsas. Ele **não se aplica** a reservas pagas com horas de pacote.
- **Não é cumulativo com cupom**: se os dois se aplicarem, **vale o maior**.
- O desconto some quando o slot é reservado ou quando o horário passa. O Administrador geral pode removê-lo a qualquer momento.

### 5.3.4 Cupons de desconto

| Tipo | Regra de uso |
|---|---|
| **Cupom primeira reserva** | Só pode ser usado na **primeira reserva** do cliente. A elegibilidade é verificada pelo CPF/CNPJ, e não só pela conta, para evitar cadastros duplicados |
| **Cupom de desconto** | Pode ser usado **infinitas vezes** ou um **número específico de vezes** (limite total). Vale para reservas avulsas **e para a compra de pacotes** |

- **Campos**:
  - código (ex.: BRAVO10);
  - tipo;
  - desconto em **percentual** ou **valor fixo em R$**;
  - limite de usos (ilimitado ou N);
  - validade opcional (de/até);
  - limite por cliente (opcional);
  - status **habilitado/desabilitado**, que pode ser trocado a qualquer momento.
- Um cupom por compra. Em pacotes, o cupom vale **só para o primeiro pagamento**; as renovações são cobradas pelo valor cheio.
- Com cupom e desconto por slot ao mesmo tempo, **vale o maior**.
- O consumo do limite de usos é atômico: dois clientes não conseguem usar a última unidade ao mesmo tempo.
- O desconto do cupom entra na base do sinal e do saldo, ou seja, o sinal é calculado sobre o valor já com desconto.

### 5.3.5 Créditos do cliente

- O cliente recebe **crédito em reais** quando reagenda para um horário mais barato. O crédito é a diferença de valor.
- O cliente com pacote de horário fixo recebe crédito pelos dias fechados no período (§5.3.2).
- O Administrador geral também pode conceder crédito manualmente (ex.: compensação), com justificativa no log.
- O crédito aparece em **Perfil → Compras → Créditos** e pode ser usado como forma de pagamento total ou parcial de reservas, pacotes e horas extras.
- Validade padrão de **90 dias** (configurável).

### 5.4 Pagamento

Todas as regras desta seção são **parâmetros configuráveis** na tela Gestão de Reservas (§7.3.2). A cobrança é feita pelo **gateway de pagamento configurado** em Integrações. O gateway inicial é o Mercado Pago, mas o sistema é independente de gateway (§8).

| Parâmetro | Padrão |
|---|---|
| Sinal obrigatório na reserva avulsa | **50%** do valor |
| Sinal reembolsável em caso de desistência | **Não** |
| Momento da cobrança do saldo | **48h antes** do início |
| Prazo limite para pagar o saldo | **24h antes** do início; sem pagamento, a reserva é cancelada automaticamente e o sinal é retido |
| Lembretes de saldo (Pix) | 48h, 36h e 26h antes |
| Reserva feita com menos de X horas de antecedência paga 100% no ato | X = **48h** |
| Tempo de bloqueio do horário durante o checkout | **15 min** |
| Prazo padrão de expiração da pré-reserva criada pelo Admin | **24h** (editável em cada pré-reserva) |
| Assinaturas (pacotes de horas e de horário fixo) | **100% antecipado na compra**; renovação cobrada **2 dias antes da data base** |
| Horas extras | **100% na compra**; validade de 90 dias |
| Mudança de pacote (aumento ou redução) | efeito imediato; novo período começa na data da troca, com cobrança do novo pacote |
| Cancelamento de assinatura | efeito imediato; horas de saldo do período perdidas, sem reembolso |
| Compensação por dia fechado | 1/30 do pacote por dia fechado no período (horas ou crédito) |
| Tolerância para regularizar renovação não paga | **7 dias** |

- **Cobrança do saldo e das renovações**: cartão salvo (tokenizado no gateway) é cobrado automaticamente; para Pix, o sistema gera a cobrança e envia os lembretes.
- **Status de pagamento da reserva** (exibidos na tela Gestão de Reservas):
  - **Aguardando pgto**: a reserva está no checkout ou tem uma cobrança emitida e ainda não paga. Se o pagamento não for aprovado no tempo de checkout, a reserva expira e o horário é liberado.
  - **Pré-reserva**: bloqueio temporário criado pelo Administrador geral ou pela recepção **para um cliente determinado**. O cliente recebe um link de pagamento. A pré-reserva vira **Confirmada** quando o cliente paga ou quando o Administrador geral confirma manualmente, mesmo sem pagamento (com registro no log). Se nada disso acontecer no prazo, ela expira e o horário é liberado.
  - **Confirmada**: sinal pago, pacote debitado, assinatura ativa ou confirmação manual. Um indicador mostra se ainda há saldo pendente.

### 5.5 Reagendamento e cancelamento

Todas as regras desta seção são **parâmetros configuráveis** na tela Gestão de Reservas (§7.3.2). Os valores abaixo são os padrões.

| Situação | Regra padrão |
|---|---|
| Reagendamento com ≥24h de antecedência | **1 reagendamento cortesia** por reserva, self-service, para qualquer horário disponível em até **60 dias** (quantidade, antecedência e prazo configuráveis) |
| Novo horário mais caro | o locatário paga a diferença no ato (ou debita mais minutos do pacote) |
| Novo horário mais barato | a diferença vira **crédito** para o cliente (§5.3.5) |
| Reagendamento além da cortesia ou com menos de 24h | bloqueado no self-service; só o Admin pode abrir exceção (registrada em log) |
| Cancelamento pelo locatário com ≥24h de antecedência | **perde só o sinal**; o saldo já pago é **reembolsado**, inclusive se o cancelamento ocorrer entre 48h e 24h antes |
| Cancelamento pelo locatário com menos de 24h | sem reembolso |
| Cancelamento de reserva paga com pacote de horas | minutos voltam ao saldo se ≥24h antes; senão, são consumidos |
| Cancelamento de ocorrência de pacote de horário fixo | sem reembolso (preço fechado); reagendamento pela regra de cortesia |
| No-show | sem reembolso; minutos de pacote consumidos |
| Cancelamento pela clínica | reembolso integral (ou minutos devolvidos, ou crédito, à escolha do cliente) e notificação imediata |

### 5.6 Serviços extras

Os serviços extras são **configuráveis** na tela Serviços Extras (§7.3.6) e podem ser contratados **com qualquer sala reservada**. Cada serviço tem:
- nome e descrição;
- preço de referência e unidade (por hora ou por projeto);
- **modo de venda**: *sob orçamento* ou *compra online* junto com a reserva;
- status ativo/inativo.

Serviços padrão de fábrica, todos **sob orçamento**:
- **Pacote de filmagem** (gravação + edição): preço de referência **R$ 80,00/h**.
- **Videomaker**.
- **Marketing digital**.

Funcionamento dos pedidos:
- O pedido de orçamento pode ser feito pelo site ou app, avulso ou vinculado a uma reserva.
- Ele entra no Admin como lead, com o status: Novo → Em contato → Orçamento enviado → Fechado / Perdido.
- Se o Administrador geral mudar um serviço para *compra online*, ele passa a aparecer como adicional no checkout e é cobrado junto com a reserva.

---

## 6. User Stories e Critérios de Aceite

### Locatário (Website e App)

#### US-01 · Explorar salas
**Como** visitante, **quero** ver as salas com fotos, detalhes e preços, **para** escolher a mais adequada ao meu atendimento.
- [ ] A página lista as salas ativas com foto de capa, "ideal para" e o menor valor-hora entre as categorias visíveis.
- [ ] A página da sala tem galeria, descrição, equipamentos, categorias de reserva com valor e valor médio da hora, e calendário de disponibilidade.
- [ ] O calendário mostra em destaque os slots com desconto (ex.: "−10%") e os feriados.
- [ ] As salas inativas não aparecem; se não houver fotos, é exibida uma imagem padrão da marca.

#### US-02 · Reservar e pagar o sinal
**Como** locatário, **quero** escolher sala, data e horário, ver o preço final e pagar online, **para** garantir meu horário na hora.
- [ ] O fluxo segue: sala → data → horário → resumo (memória de cálculo, desconto de slot, campo de cupom, créditos e política) → login ou cadastro → pagamento.
- [ ] A grade respeita o horário de funcionamento, a granularidade do slot, a duração mínima (60 min), os dias fechados e os bloqueios. Não é possível começar antes do fim da limpeza da reserva anterior nem terminar sem deixar o tempo de limpeza antes da próxima.
- [ ] Uma reserva que atravessa janelas de categorias diferentes é cobrada por trecho, e o resumo mostra cada trecho.
- [ ] O horário fica com o status "Aguardando pgto" durante o checkout e expira se o pagamento não for aprovado no tempo configurado.
- [ ] Com o pagamento aprovado, a reserva fica "Confirmada" e o locatário recebe e-mail com o convite .ics.
- [ ] Se dois usuários tentam o mesmo horário, só o primeiro a entrar no checkout consegue reservar.
- [ ] O locatário precisa aceitar explicitamente a política de sinal, reagendamento e cancelamento antes de pagar.

#### US-03 · Pagar o saldo
**Como** locatário, **quero** que o saldo seja cobrado ou lembrado automaticamente, **para** não perder a reserva.
- [ ] No prazo configurado, o cartão salvo é cobrado automaticamente, ou é gerado um Pix, com lembretes.
- [ ] Sem pagamento até o prazo limite, a reserva é cancelada, o sinal é retido e o locatário é notificado.

#### US-04 · Minhas reservas e agenda (App)
**Como** locatário, **quero** ver minhas reservas e assinaturas e sincronizar com minha agenda pessoal, **para** organizar meus atendimentos.
- [ ] O app mostra as abas Próximas / Passadas / Canceladas, com o status de pagamento; as ocorrências de pacote de horário fixo aparecem agrupadas.
- [ ] Há uma visão de calendário (mês, semana e dia).
- [ ] Há um link de assinatura ICS pessoal (Google Calendar e Outlook), que reflete criações, reagendamentos e cancelamentos.

#### US-05 · Reagendar e cancelar
**Como** locatário, **quero** reagendar ou cancelar seguindo regras claras, **para** lidar com imprevistos.
- [ ] O botão "Reagendar" só aparece dentro das regras configuradas (§5.5), para datas em até 60 dias. Fora delas, o app mostra "Fale com a recepção" (WhatsApp da clínica).
- [ ] Ao reagendar para um horário mais barato, a diferença vira crédito, e o app mostra o valor creditado.
- [ ] O modal de cancelamento mostra o que é retido (sinal) e o que é devolvido (saldo, minutos ou crédito) antes da confirmação.

#### US-06 · Assinar e usar um pacote de horas
**Como** locatário frequente, **quero** assinar um pacote mensal de horas e reservar debitando dele, **para** pagar menos por hora.
- [ ] Na compra, o cliente escolhe o pacote e a data base; o primeiro período é pago na hora e as horas aparecem no app.
- [ ] Ao reservar com o pacote, o app mostra quantos minutos serão debitados, aplicando o débito proporcional da §5.3.1, e só permite a reserva se o saldo cobrir esse débito.
- [ ] As horas do pacote só podem ser usadas em datas do período de faturamento corrente.
- [ ] A renovação é cobrada 2 dias antes da data base; as horas não usadas expiram no fim do período, e o novo período começa com as horas do pacote vigente.
- [ ] Cada dia fechado no período gera 1/30 das horas do pacote como compensação.
- [ ] O extrato mostra compras, renovações, débitos (com o cálculo proporcional), estornos, horas extras e expirações.

#### US-07 · Assinar um pacote de horário fixo
**Como** profissional com agenda fixa, **quero** assinar um horário fixo (ex.: seg–sex, 08:00–10:00), **para** ter a sala garantida todo mês.
- [ ] O cliente escolhe a categoria, a sala e a data de início no calendário. Se houver conflito, o sistema mostra as datas e sugere outra sala ou outra data.
- [ ] Após o pagamento, todas as ocorrências do período aparecem reservadas, cada uma seguida de bloqueio de limpeza.
- [ ] Enquanto a assinatura está ativa, as ocorrências do período seguinte ficam pré-reservadas e são confirmadas com a renovação.
- [ ] O preço do período é calculado como preço por ocorrência × ocorrências e é mostrado antes do pagamento.
- [ ] Cada dia fechado no período gera crédito de 1/30 do preço do período.

#### US-08 · Gerir compras no perfil
**Como** assinante, **quero** um menu Compras no meu perfil, **para** gerenciar assinaturas, horas extras e créditos.
- [ ] **Perfil → Compras** mostra:
  - as assinaturas ativas, com data base, próxima cobrança e saldo;
  - o histórico de compras;
  - os créditos disponíveis.
- [ ] A opção **Horas extras** só aparece para quem assina um pacote de horas ativo e permite comprar de 1 a 20 horas pelo valor-hora do pacote. Essas horas podem ser usadas em datas além do período, até 90 dias.
- [ ] O cliente pode aumentar, reduzir ou cancelar o pacote com efeito imediato.
  - Antes de confirmar, o app mostra o saldo convertido (aumento e redução), o valor cobrado ou as horas que serão perdidas (cancelamento).

#### US-09 · Usar cupom
**Como** locatário, **quero** aplicar um cupom no checkout de uma reserva ou de um pacote, **para** pagar menos.
- [ ] Um cupom válido mostra o desconto no resumo antes do pagamento.
- [ ] Um cupom inválido mostra o motivo: inexistente, desabilitado, esgotado, expirado ou "válido só na primeira reserva".
- [ ] Com cupom e desconto de slot ao mesmo tempo, o sistema aplica o maior e informa isso no resumo.

#### US-10 · Pedir orçamento de extras
**Como** locatário ou visitante, **quero** solicitar filmagem, videomaker ou marketing digital para qualquer sala, **para** potencializar meu trabalho.
- [ ] O formulário pede serviço, descrição, data desejada (opcional), reserva vinculada (opcional) e contato.
- [ ] O pedido aparece no Admin e os e-mails de notificação configurados são avisados.

### Administrador geral

#### US-11 · Configurar o calendário de funcionamento
**Como** Administrador geral, **quero** definir o horário de funcionamento de segunda a domingo e feriados, a granularidade do slot, os dias fechados e os bloqueios, **para** controlar quando as salas podem ser reservadas.
- [ ] A tela tem formato de calendário semanal (segunda a domingo) e mostra o funcionamento configurado.
- [ ] É possível alterar início e fim por dia da semana e por feriado, com atalhos para "seg–sex" e "sáb, dom e feriados".
- [ ] Granularidade do slot, duração padrão da reserva e duração da limpeza são editáveis; o sistema avisa se a limpeza não for múltipla do slot.
- [ ] É possível fechar uma data inteira (toda a clínica ou salas específicas) e criar bloqueios com tag pré-definida ou texto livre.
- [ ] Os feriados nacionais, estaduais (SC) e municipais (Itajaí) do ano corrente e do seguinte aparecem com alerta antes da data, e é possível decidir abrir ou fechar cada um.
- [ ] Em 1º de outubro, o sistema lembra o Administrador geral de conferir os feriados do ano seguinte.
- [ ] Ao fechar um dia, o sistema mostra quantos assinantes recebem compensação e o total de horas e créditos gerados.

#### US-12 · Configurar categorias e tabela de valores
**Como** Administrador geral, **quero** criar e editar categorias de reserva com seus dias, horários e valores, **para** montar a minha política comercial.
- [ ] As categorias padrão já vêm cadastradas com preços de exemplo, e é possível criar, editar, desativar e reordenar categorias dos quatro tipos.
- [ ] No primeiro acesso, um checklist pede ao Administrador geral que revise e defina os preços reais antes de publicar o site.
- [ ] Cada categoria de Hora avulsa aceita valor-hora para seg–sex e para sáb, dom e feriados, além da duração mínima. Os pacotes de horas têm preço único, e os pacotes de horário fixo têm preço por ocorrência.
- [ ] Ao lado de cada valor aparece, em tempo real, o valor médio da hora resultante.
- [ ] É possível marcar qual categoria é a referência de valor-hora padrão de seg–sex (V_ref).
- [ ] Um seletor permite ver as categorias desenhadas sobre o calendário de segunda a domingo.
- [ ] Alterações valem só para reservas e compras novas e para as renovações seguintes; os assinantes afetados são avisados.

#### US-13 · Gerir reservas no calendário
**Como** Administrador geral ou recepção, **quero** ver todas as reservas em um calendário semanal ou mensal, **para** operar o dia a dia.
- [ ] Cada slot ocupado mostra o **primeiro nome** de quem reservou e o **nome da sala**; os bloqueios mostram a tag.
- [ ] Ao passar o mouse sobre uma reserva, um popup mostra:
  - nome completo e sala;
  - valor pago;
  - horário de início e fim;
  - status (**Confirmada**, **Aguardando pgto** ou **Pré-reserva**), com ações rápidas (confirmar, reenviar link, reagendar, cancelar).
- [ ] Ao passar o mouse sobre um slot livre, aparecem as opções:
  - **Aplicar desconto (%)**;
  - **Criar pré-reserva**;
  - **Criar reserva**;
  - **Bloquear**.
- [ ] É possível vender uma categoria a um cliente pelo Admin, inclusive uma assinatura de pacote de horas ou de horário fixo.
- [ ] O check-in marca "Compareceu"; reservas sem check-in até 30 min após o início viram "No-show" (ajustável).
- [ ] Há filtros por sala, status e categoria.

#### US-14 · Criar pré-reserva para um cliente
**Como** Administrador geral ou recepção, **quero** segurar um horário para um cliente determinado, **para** fechar a venda por telefone ou WhatsApp.
- [ ] A pré-reserva exige cliente, sala, horário e prazo de expiração (padrão de 24h) e envia ao cliente um link de pagamento.
- [ ] Ela vira Confirmada automaticamente com o pagamento, ou manualmente pelo Administrador geral, mesmo sem pagamento, com registro no log.
- [ ] Se expirar sem confirmação, o horário é liberado e o cliente e a clínica são notificados.

#### US-15 · Configurar políticas de pagamento, reagendamento e cancelamento
**Como** Administrador geral, **quero** editar todas as regras das §5.4 e §5.5, **para** ajustar a política sem depender de desenvolvedor.
- [ ] Todos os parâmetros das tabelas das §5.4 e §5.5 são editáveis na tela Gestão de Reservas, com os valores padrão pré-carregados.
- [ ] Mudanças valem só para reservas novas; o texto da política exibido no checkout e nos e-mails é atualizado automaticamente.

#### US-16 · Acompanhar o financeiro e exportar o DRE
**Como** Administrador geral, **quero** ver recebimentos e despesas por semana, mês e trimestre e exportar um DRE, **para** controlar o resultado da clínica.
- [ ] Os recebimentos vêm automaticamente dos pagamentos aprovados (sinais, saldos, assinaturas, renovações, horas extras e extras), já descontados os estornos.
- [ ] É possível lançar despesas manualmente (data, categoria, descrição, valor, recorrência opcional, comprovante opcional) e editá-las.
- [ ] A tela agrupa por semana, mês ou trimestre e compara com o período anterior.
- [ ] Um seletor alterna entre **regime de caixa** e **regime de competência**, tanto na visualização quanto na exportação.
- [ ] O botão **Exportar DRE (.xlsx)** gera a planilha do período e do regime selecionados (estrutura na §7.3.3).

#### US-17 · Configurar integrações
**Como** Administrador geral, **quero** conectar a agenda, meu assistente de IA, os e-mails de aviso e o gateway de pagamento, **para** operar a clínica de onde eu estiver.
- [ ] A tela gera um link do **calendário completo da clínica** que, assinado no Google Calendar, vira uma nova agenda.
- [ ] Ela permite ativar o **servidor MCP**, gerar e revogar tokens de acesso e ver as ações disponíveis.
- [ ] É possível cadastrar um ou mais **e-mails de notificação** e escolher os avisos: nova reserva, pagamento efetuado e reserva cancelada.
- [ ] Também é possível escolher e configurar o **gateway de pagamento** ativo e testar a conexão.

#### US-18 · Criar cupons
**Como** Administrador geral, **quero** criar cupons de primeira reserva e de desconto, **para** atrair e reter clientes.
- [ ] É possível criar, editar, habilitar e desabilitar cupons dos dois tipos (§5.3.4).
- [ ] A lista mostra código, tipo, desconto, usos/limite, validade e status.
- [ ] Um cupom desabilitado é recusado no checkout na mesma hora.

#### US-19 · Configurar serviços extras
**Como** Administrador geral, **quero** cadastrar e configurar os serviços extras, **para** vendê-los sob orçamento ou online, com qualquer sala.
- [ ] É possível criar, editar e desativar serviços com os campos da §5.6.
- [ ] Os pedidos de orçamento aparecem em lista, com status editável.

---

## 7. Requisitos Funcionais por Interface

### 7.1 Website público (pt-BR, responsivo)
- **Páginas**: Home (marca, proposta "Saúde · Beleza · Bem-estar em um só lugar"), Salas, Página da Sala, Preços e Pacotes, Serviços Extras, Políticas, Contato/Localização (Praia Brava, Itajaí – SC), Login/Cadastro, Termos e Privacidade.
- Fluxo de reserva e checkout (US-02), comum com o app, com campo de cupom, uso de créditos e destaque de slots com desconto.
- Compra de assinaturas: pacotes de horas (US-06) e pacotes de horário fixo (US-07).
- SEO local (Google Business, schema.org `LocalBusiness`), Open Graph.
- Botão de WhatsApp da clínica em todas as páginas.

### 7.2 App do locatário (PWA)
- Tudo o que o site faz, mais o que vem abaixo.
- Instalável (manifest + service worker), com login persistente.
- Minhas reservas, ocorrências de horário fixo, calendário pessoal, reagendar, cancelar, pagar saldo, cartões salvos, pedidos de orçamento e perfil.
- **Perfil → Compras**:
  - **Assinaturas**: pacote atual, data base, próxima cobrança, saldo de horas, extrato, aumentar, reduzir ou cancelar o pacote (efeito imediato);
  - **Horas extras**: visível só para assinantes de pacote de horas; de 1 a 20 horas, usáveis até 90 dias à frente;
  - **Créditos**;
  - **Histórico de compras**.
- Notificações por **e-mail + web push**: confirmação, lembrete de saldo, lembrete 24h e 2h antes, cancelamento, reagendamento, cobrança de renovação, renovação aprovada ou recusada e fim de período do pacote.
- Sincronização de agenda **de mão única**: feed ICS pessoal + .ics por reserva.

### 7.3 Admin

**Perfis**
- **Administrador geral**: acesso total.
- **Recepção**: Gestão de Reservas (criar reservas e pré-reservas, check-in, bloqueios) e Clientes. Não acessa Calendário (configuração), Financeiro, Integrações, Cupons nem as políticas.

**Navegação**: Calendário · Gestão de Reservas · Financeiro · Integrações · Cupons · Serviços Extras · Clientes · Salas · Usuários · Log de auditoria.

#### 7.3.1 Tela Calendário (configuração de funcionamento e valores)
- **Formato**: calendário semanal de **segunda a domingo** com a grade de slots, em que o Administrador geral vê e edita o horário de funcionamento de cada dia (arrastando o início e o fim ou digitando).
- **Seletor de categorias**: o Administrador geral marca uma ou mais categorias para vê-las desenhadas sobre a semana, como faixas coloridas com o valor-hora. Assim ele confere onde e quando cada categoria vale e identifica horários sem categoria de preço.
- **Painel de configuração**:
  - granularidade do slot (padrão 30 min);
  - duração padrão da reserva (padrão 60 min);
  - duração da limpeza (padrão 30 min);
  - antecedência mínima e máxima para reservar (máxima padrão de 90 dias).
- **Tabela de valores**:
  - lista de categorias (§5.3) com os campos editáveis;
  - ao lado de cada valor aparece o **valor médio da hora**;
  - a marcação da categoria de referência (V_ref);
  - um botão "Nova categoria".
- **Visão mensal de exceções**: dias fechados, feriados (nacionais, SC e Itajaí, com alerta e escolha entre abrir e fechar) e bloqueios recorrentes.
- **Bloqueios**: criar bloqueio com tag pré-definida ("Limpeza", "Indisponível") ou texto livre, para uma ou mais salas, único ou recorrente.

#### 7.3.2 Tela Gestão de Reservas
- **Calendário semanal ou mensal**, com filtro por sala (todas ou uma) e legenda de status.
- **Slot ocupado**: primeiro nome + nome da sala. Ao passar o mouse, um popup mostra:
  - nome completo e sala;
  - valor pago e valor total (ou minutos debitados do pacote);
  - início e fim;
  - categoria;
  - o selo de status **Confirmada / Aguardando pgto / Pré-reserva**.
  - O popup também traz as ações: confirmar, reenviar link de pagamento, reagendar, cancelar e check-in.
- **Slot livre**: ao passar o mouse aparecem as opções:
  - **Aplicar desconto (%)** (também para um intervalo selecionado arrastando);
  - **Criar pré-reserva**;
  - **Criar reserva**;
  - **Bloquear**.
  - Slots com desconto ficam marcados com o percentual.
- **Bloqueios**: mostram a tag (ex.: "Limpeza").
- **Vender assinatura**: vende um pacote de horas ou de horário fixo para um cliente, com verificação de conflitos.
- **Assinaturas**: lista de assinantes com pacote, data base, próxima cobrança, status (ativa, suspensa, encerrada) e saldo.
- **Políticas**: painel "Regras de pagamento, reagendamento e cancelamento" com todos os parâmetros das §5.4 e §5.5.
- **Lista de reservas**: visão em tabela com busca, filtros e exportação CSV.

#### 7.3.3 Tela Financeiro
- **Recebimentos**:
  - lançados automaticamente a partir dos pagamentos aprovados no gateway;
  - categorias de receita: locação avulsa, assinaturas (primeiro pagamento e renovações), horas extras e serviços extras;
  - o Administrador geral também pode lançar recebimentos manuais (dinheiro, maquininha ou Pix direto).
- **Despesas**: lançamento manual com data, categoria, descrição, valor, recorrência opcional e anexo opcional.
  - Categorias iniciais (editáveis): aluguel, condomínio e IPTU, energia, água, internet, limpeza e higienização, manutenção, materiais e insumos, marketing, pessoal, contabilidade, taxas do gateway, impostos e outros.
- **Agrupamento**: por **semana, mês ou trimestre**, com totais, gráfico de evolução e comparação com o período anterior.
- **Regime**: seletor **Caixa** (pela data do recebimento ou pagamento) ou **Competência**.
  - Em competência, a reserva conta na data de uso, e a assinatura é distribuída pelos dias do período.
  - O seletor vale para a tela e para a exportação.
- **Exportar DRE (.xlsx)**: gera a planilha do período e do regime selecionados, com uma coluna por mês e esta estrutura:
  1. Receita bruta (locação avulsa, assinaturas, horas extras, serviços extras)
  2. (−) Descontos, cupons e créditos concedidos
  3. (−) Estornos e reembolsos
  4. (−) Taxas do gateway de pagamento
  5. **= Receita líquida**
  6. (−) Despesas operacionais, por categoria
  7. **= Resultado do período**

#### 7.3.4 Tela Integrações
- **Gateway de pagamento**:
  - escolha do provedor ativo (inicialmente Mercado Pago);
  - credenciais, armazenadas criptografadas e nunca exibidas por inteiro;
  - ambiente de teste ou produção;
  - URL de webhook para copiar;
  - botão **Testar conexão**.
- **Calendário da clínica**:
  - gera um **link ICS secreto** com todas as reservas e bloqueios da clínica (opcionalmente um link por sala);
  - quando assinado no Google Calendar ("Adicionar agenda → Do URL"), vira uma **nova agenda** na conta pessoal do Administrador geral;
  - o link pode ser revogado e gerado de novo.
- **MCP (assistente de IA)**:
  - ativa o servidor MCP do sistema, que expõe **todas as funções do Admin** como ferramentas (consultar agenda, criar reserva e pré-reserva, vender assinatura, aplicar desconto, criar cupom, lançar despesa, consultar o financeiro etc.);
  - pode ser usado em qualquer aplicativo de IA compatível com MCP (ex.: Claude, ChatGPT, Gemini);
  - mostra a URL do servidor;
  - permite gerar e revogar tokens por dispositivo, com escopo (somente leitura ou leitura e escrita);
  - lista as ferramentas disponíveis;
  - todas as ações feitas via MCP aparecem no log de auditoria com a origem "MCP".
- **E-mails de notificação**:
  - um ou mais e-mails de destino;
  - liga/desliga por evento: **nova reserva**, **pagamento efetuado** e **reserva cancelada** (padrão: todos ligados), além de nova assinatura, renovação recusada, pré-reserva expirada e novo pedido de orçamento;
  - botão "Enviar e-mail de teste".

#### 7.3.5 Tela Cupons
- Lista com código, tipo (primeira reserva ou desconto), desconto (% ou R$), usos/limite, validade e o interruptor **habilitado/desabilitado**.
- Formulário de criação e edição com os campos da §5.3.4.
- Histórico de uso por cupom (cliente, reserva ou pacote, data, valor descontado).

#### 7.3.6 Tela Serviços Extras
- Cadastro dos serviços com os campos da §5.6 (nome, descrição, preço de referência, unidade, modo de venda, status).
- Funil de pedidos de orçamento (Novo → Em contato → Orçamento enviado → Fechado / Perdido), com dados do cliente e reserva vinculada.

#### 7.3.7 Demais telas
- **Clientes**: cadastro, histórico de reservas, assinaturas, saldo de pacote, créditos, cupons usados e observações.
- **Salas**: dados e fotos das salas (§5.1).
- **Usuários**: contas do Admin e perfis.
- **Log de auditoria**: ações sensíveis (via Admin ou MCP), com usuário, data, origem e justificativa.

### 7.4 Cadastro do locatário
- Aberto a qualquer pessoa. Campos: nome, CPF **ou** CNPJ, e-mail, celular, profissão/área (opcional) e registro profissional (opcional, informativo).
- E-mail verificado antes da primeira reserva.

### 7.5 Estados

**Reserva**: `Aguardando pgto` (checkout ou cobrança emitida) ou `Pré-reserva` (criada pelo Admin) → `Confirmada` → `Quitada` → `Concluída` | `No-show`

Ramificações da reserva: `Expirada` (checkout ou pré-reserva sem confirmação) · `Cancelada pelo locatário` · `Cancelada por falta de pagamento` · `Cancelada pela clínica`

**Assinatura**: `Ativa` → (renovação paga) `Ativa` | (renovação não paga) `Suspensa` → `Ativa` (regularizada em até 7 dias) | `Encerrada`

Ramificações da assinatura: `Cancelada` (efeito imediato) · `Trocada` (encerrada e substituída por um novo pacote na data da troca)

### 7.6 Tratamento de erros e casos de borda
- **Webhook do gateway atrasado ou duplicado**: o processamento é idempotente e há uma rotina de conciliação periódica que consulta os pagamentos pendentes no gateway ativo.
- **Pagamento aprovado depois da expiração do checkout**, com o horário já tomado: estorno automático + e-mail com pedido de desculpas e sugestões de horários.
- **Troca de gateway com cobranças em andamento**: cobranças já emitidas terminam no gateway de origem, e só as novas usam o novo. Cartões salvos e cobranças recorrentes no gateway antigo não migram, e os assinantes precisam cadastrar o cartão de novo antes da próxima renovação.
- **Feriado ou dia fechado cadastrado depois que já existem reservas naquela data**: o sistema lista as reservas afetadas. O preço das reservas mantidas não muda.
- **Sala inativada com reservas ou assinaturas futuras**: o Admin precisa realocar ou cancelar (com reembolso integral ou crédito) antes de concluir a inativação.
- **Horário de verão / fuso**: tudo é armazenado em UTC e exibido em America/Sao_Paulo.
- **Sobras menores que a duração mínima** entre reservas e limpeza não podem ser vendidas. O calendário as mostra como indisponíveis, sem mensagem de erro.
- **Saldo de pacote menor que o débito necessário**: a opção "pagar com meu pacote" fica desabilitada, com a explicação e os botões "Comprar horas extras" e "Pagar esta reserva".
- **Duas reservas disputando horários próximos**: a checagem de conflito sempre considera o intervalo *[início, término + limpeza)* de ambas.
- **Último uso de um cupom limitado disputado por dois clientes**: só um consegue; o outro vê "cupom esgotado".
- **Renovação de pacote de horário fixo com conflito** (ex.: dia fechado no período seguinte): o cliente é avisado antes da cobrança, com as datas afetadas.
- **Dia fechado marcado depois que o período já foi pago**: a compensação de 1/30 é lançada na hora, e o assinante é notificado.
- **Troca de pacote com reservas futuras já debitadas**: as reservas continuam válidas, e só o saldo restante é convertido.
- **Ação destrutiva via MCP** (cancelar, estornar, excluir): exige confirmação explícita na própria chamada e um token com escopo de escrita.

### Fora do escopo (MVP)
- Controle de acesso automático (fechaduras, IoT). A recepção libera a sala.
- App nativo nas lojas.
- Sincronização de agenda de mão dupla ou via OAuth.
- Notificações por WhatsApp automáticas.
- Emissão de NFS-e (versão 2).
- Conciliação bancária automática (as despesas são lançadas manualmente).
- Validação de registro profissional.
- Múltiplas unidades e idiomas além do pt-BR.

---

## 8. Restrições Técnicas

### Infraestrutura (decidida)
- **Backend e banco de dados no Neon**:
  - Postgres no Neon (Lakebase Postgres);
  - API e jobs agendados em **Neon Functions**, com gatilhos de cron para cobrança de saldo, renovações (2 dias antes da data base), expiração de períodos, lembretes, no-show e conciliação;
  - arquivos (fotos das salas e anexos de despesas) no **Neon Object Storage**.
- **Frontend no Netlify**: site público, PWA e Admin servidos como um único projeto front-end.
- **Plano gratuito no início**: os dois serviços começam no free tier, com recursos mínimos. Isso implica:
  - o banco "dorme" quando ocioso (scale-to-zero), e a primeira requisição depois de um período parado é mais lenta (cold start);
  - consultas enxutas e uso mínimo de computação contínua;
  - um painel simples de consumo dos limites do plano, para planejar a migração ao plano pago quando o uso crescer.
- A autenticação pode usar o **Neon Auth** (a confirmar com o time técnico).

### Gateway de pagamento genérico (obrigatório)
- **Nenhuma configuração de gateway fica fixa no código.** O checkout e as cobranças recorrentes chamam uma interface única de pagamento, e o gateway ativo é escolhido na tela Integrações.
- **Interface do gateway**, que todo adaptador implementa:
  - criar cobrança (Pix ou cartão);
  - cobrar cartão salvo (usado nas renovações);
  - consultar status;
  - estornar total ou parcialmente;
  - cadastrar cliente e cartão (tokenização);
  - validar e interpretar webhook.
- **Recorrência controlada pelo sistema**: a cobrança das renovações é disparada pelo próprio sistema (job agendado + "cobrar cartão salvo" ou "criar cobrança Pix"), e não por um recurso de assinatura específico de um provedor. Assim, a troca de gateway não exige recriar planos.
- **Adaptadores**: um por provedor. O primeiro é o **Mercado Pago**. Para trocar de gateway no futuro, basta escrever um novo adaptador e selecioná-lo no Admin, sem mudar o checkout.
- **Dados independentes de provedor**: cada pagamento guarda o provedor, o ID externo, o método, o valor, as taxas e o status normalizado.
- **Webhooks** em rota própria por provedor (ex.: `/webhooks/pagamentos/{provedor}`), com validação de assinatura e processamento idempotente.
- **Credenciais** armazenadas criptografadas (variáveis de ambiente ou cofre de segredos), nunca no código nem no front-end.

### Performance
- LCP do site ≤2,5s em 4G, com as páginas de sala otimizadas (imagens WebP/AVIF e CDN do Netlify).
- Consulta de disponibilidade ≤300 ms (p95) com o banco ativo. O cold start do free tier é aceito no início e acompanhado.
- Confirmação da reserva ≤5s após a aprovação do pagamento.

### Segurança e conformidade
- **LGPD**: consentimento explícito, política de privacidade, exportação e exclusão de dados a pedido, retenção mínima e registro de consentimentos. O sistema não armazena dados clínicos de pacientes.
- **Pagamentos**: nenhum dado de cartão armazenado; tokenização pelo gateway (escopo PCI mínimo). Consentimento explícito do cliente para cobrança recorrente no cartão salvo.
- Autenticação por e-mail/senha + login com Google. Admin com 2FA obrigatório.
- Controle de acesso por perfil e log de auditoria das ações sensíveis do Admin e do MCP.
- **MCP**:
  - autenticação por token revogável (ou OAuth), com escopos de leitura e escrita;
  - limite de requisições;
  - as mesmas regras de permissão do Admin.
- **Prevenção de dupla reserva no banco de dados**, e não só na aplicação. No Postgres, isso se faz com uma *exclusion constraint* por sala sobre `tstzrange(início, término + limpeza)`, cobrindo reservas, ocorrências de assinatura e bloqueios. A duração da limpeza é gravada em cada reserva no momento da criação.
- **Saldo de pacote, créditos e limites de cupom** atualizados em transação, com extrato (livro-razão) imutável, para evitar uso duplo e permitir auditoria.

### Integrações
- **Gateway de pagamento**: interface genérica + adaptador Mercado Pago (Pix, cartão, cartões salvos, estornos, webhooks).
- **Agenda**: feed ICS por locatário e feed ICS da clínica inteira (URL com token secreto e revogável) + arquivos .ics.
- **Feriados**: API pública de feriados nacionais (ex.: BrasilAPI) + cadastro de feriados de SC e Itajaí.
- **E-mail transacional**: ex. Resend (plano gratuito no início). **Web push**: VAPID.
- **MCP**: servidor MCP remoto do sistema, hospedado no backend.
- **Planilhas**: geração do DRE em .xlsx no backend.
- **Analytics**: GA4 ou PostHog (funil de reserva).

### Compatibilidade
- Chrome, Safari (iOS 16.4+ para web push), Edge e Firefox nas duas últimas versões. Acessibilidade WCAG 2.1 AA.

### Diretrizes de UI
- Seguir o **design system da Bravô Clinic**:
  - tipografia Josefin Sans (display, caixa-alta com espaçamento largo) e Jost (texto);
  - superfícies em tons de pedra calcária;
  - champagne como cor-assinatura (nunca em texto sobre fundo claro);
  - bronze para ações e links;
  - walnut para faixas e fundos amplos;
  - temas Dia e Noite;
  - cantos arquitetônicos;
  - ícones de traço fino;
  - sem emoji.
- Uso prioritário no celular para o locatário; checkout em no máximo 4 etapas visíveis. O Admin é pensado primeiro para desktop, com as telas de calendário responsivas.

---

## 9. MVP e Fases

### Fase 1 — MVP (lançamento da clínica)
- Website completo com reserva, cupons, créditos, descontos por slot e assinaturas.
- PWA com Minhas reservas, menu Compras (assinaturas, horas extras, créditos), calendário, reagendamento, cancelamento, pagamento do saldo e feed ICS.
- Admin completo: Calendário, Gestão de Reservas, Financeiro (DRE em caixa e competência), Integrações (gateway, ICS da clínica, MCP, e-mails), Cupons, Serviços Extras, Clientes, Salas, Usuários e Log.
- Motor de preços por categoria + débito proporcional de pacotes + políticas configuráveis + cobranças recorrentes + expirações automáticas.
- Gateway de pagamento genérico com o adaptador Mercado Pago.
- Notificações por e-mail e web push.

**Ordem de entrega sugerida dentro do MVP**:
1. **Núcleo**: Calendário (funcionamento, slots, categorias avulsas, bloqueios), reserva e checkout com gateway genérico, Gestão de Reservas com status e políticas.
2. **Receita**: assinaturas (pacotes de horas e de horário fixo) com renovação, horas extras, créditos, cupons e descontos por slot.
3. **Gestão**: Financeiro e DRE, Integrações (ICS da clínica, e-mails, MCP) e Serviços Extras configuráveis.

**Definição de MVP**: um profissional desconhecido consegue, sozinho e pelo celular, descobrir a sala, reservar ou assinar um pacote, pagar, receber na agenda, reagendar e ser atendido. O Administrador geral, por sua vez, configura preços e regras e controla ocupação, assinaturas e finanças sem planilhas.

### Fase 2 — Versão 2
- Emissão de NFS-e (ex.: NFE.io ou eNotas).
- Notificações por WhatsApp (API oficial).
- Sincronização via OAuth com Google Calendar e Microsoft Graph.
- Migração para planos pagos do Neon e do Netlify conforme o uso.

### Futuro
- App nativo (iOS/Android) se a adoção do PWA justificar.
- "Salas Inteligentes" de fato: fechadura com código ou QR válido só no horário, automação de luz e ar-condicionado.
- Precificação dinâmica por demanda.
- Avaliações dos locatários.
- Múltiplas unidades.

---

## 10. Riscos

| Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|
| Escopo do MVP cresceu (assinaturas, cupons, créditos, financeiro, MCP) | Alta | Alto | Entrega em 3 etapas (§9); a etapa 1 já permite abrir a clínica |
| Preços reais ainda não cadastrados no lançamento | Média | Alto | Os preços de exemplo vêm pré-carregados; checklist de primeiro acesso do Admin exige revisar a tabela antes de publicar o site |
| Débito proporcional dos pacotes gera dúvida ou disputa | Média | Médio | Minutos debitados exibidos antes de confirmar; extrato com o cálculo; regra explicada na compra |
| Falha de cobrança recorrente (cartão recusado, Pix não pago) | Média | Alto | Cobrança 2 dias antes, lembretes, tolerância de 7 dias, aviso ao Admin |
| Limites do free tier (Neon e Netlify) atingidos com o crescimento | Média | Médio | Painel de consumo; consultas enxutas; plano de migração para o plano pago |
| Cold start do banco no free tier deixa a primeira consulta lenta | Alta | Baixo | Aceito no início; cache de disponibilidade no front; reavaliar com o uso |
| Dupla reserva por concorrência | Média | Alto | Constraint no banco (incluindo limpeza, assinaturas e bloqueios) + bloqueio de checkout + operações idempotentes |
| Falha ou atraso de webhook do gateway | Média | Alto | Conciliação periódica + estorno automático nos conflitos |
| Troca de gateway interrompe renovações | Baixa | Alto | Recorrência controlada pelo sistema; aviso aos assinantes para recadastrar o cartão antes da próxima cobrança |
| Uso indevido do MCP (token vazado) | Baixa | Alto | Tokens com escopo e revogáveis, confirmação em ações destrutivas, log de auditoria, limite de requisições |
| Agenda fragmentada pelos bloqueios de limpeza | Média | Médio | Sugerir horários colados ao fim da limpeza; relatório de "tempo ocioso" |
| Feed ICS com atraso de atualização (o Google pode levar horas) | Alta | Baixo | Enviar também .ics por e-mail a cada mudança; OAuth na Fase 2 |
| Baixa ocupação inicial (pré-lançamento) | Média | Alto | SEO local (Praia Brava / Itajaí), Google Business, cupom de primeira reserva, descontos por slot, marketing de lançamento |
| Disputa sobre a retenção do sinal ou a perda de horas não usadas | Média | Médio | Aceite explícito e registrado da política; texto claro no checkout, na compra do pacote e nos e-mails |

---

## 11. Dependências e Bloqueios

**Dependências**
- Contas no **Neon** e no **Netlify**. **Dono: Eduardo.**
- Conta no gateway de pagamento (inicialmente Mercado Pago PJ) com credenciais de produção. **Dono: Administrador geral da clínica.**
- Definição dos preços reais e das janelas das categorias, no primeiro acesso ao Admin. **Dono: Administrador geral.**
- Confirmação dos feriados estaduais e municipais de 2026 e 2027 com os órgãos oficiais, incluindo a data de observância da Data Magna de SC em 2027. **Dono: clínica.**
- Fotos profissionais das 3 salas + lista de equipamentos. **Dono: clínica.**
- Textos jurídicos: termos de uso, política de privacidade, política de reserva e termos de assinatura (renovação, perda de horas, cancelamento). **Dono: clínica / jurídico.**
- Domínio, e-mail do domínio e número de WhatsApp comercial. **Dono: clínica.**
- Arquivos da marca e design system (logo vetorial, cores, fontes). **Dono: clínica / Eduardo.**

**Bloqueios conhecidos**
- Nenhum bloqueio de desenvolvimento.

---

## 12. Glossário
- **Administrador geral**: usuário do Admin com acesso total; em geral, o gestor da clínica.
- **Slot**: menor unidade da grade de horários (padrão 30 min).
- **Categoria de reserva**: forma de cobrança configurável (Hora avulsa, Bloco avulso, Pacote de horas ou Pacote de horário fixo), com dias, horários e valor da hora.
- **V_ref**: valor-hora padrão de segunda a sexta (categoria de referência), usado como base do débito proporcional.
- **V_slot**: valor-hora da categoria de Hora avulsa que vale para um slot específico.
- **V_pac**: valor-hora de um pacote de horas (preço ÷ horas do pacote).
- **Valor médio da hora**: valor da categoria ÷ horas incluídas; exibido ao lado de cada valor no Admin.
- **Pacote de horas**: assinatura com saldo de horas por período (30, 60 ou 90 dias), renovada automaticamente; as horas não são cumulativas.
- **Pacote de horário fixo**: assinatura que reserva dias e horários fixos ao cliente em cada período.
- **Data base**: data de início escolhida pelo cliente; marca o início de cada período e a renovação.
- **Horas extras**: horas avulsas (1 a 20) compradas por assinantes de pacote de horas pelo valor-hora do pacote; não vencem com o período e podem ser usadas até 90 dias à frente.
- **Compensação por dia fechado**: 1/30 do pacote (em horas ou em crédito) para cada dia fechado no período de faturamento.
- **Duração mínima**: duração a partir da qual uma categoria de Hora avulsa vale (ex.: "2 horas ou mais").
- **Crédito**: valor em reais a favor do cliente (ex.: diferença de um reagendamento para horário mais barato), usado como forma de pagamento.
- **Sinal**: percentual do valor (padrão 50%) pago na reserva avulsa, não reembolsável em caso de desistência.
- **Saldo (da reserva)**: o restante do valor, cobrado antes do início (padrão 48h).
- **Aguardando pgto**: reserva no checkout ou com cobrança emitida e ainda não paga.
- **Pré-reserva**: bloqueio temporário criado pelo Admin para um cliente determinado, aguardando pagamento ou confirmação manual.
- **Confirmada**: reserva com sinal pago, pacote debitado, assinatura ativa ou confirmação manual.
- **Reagendamento cortesia**: troca gratuita de data/horário dentro das regras configuradas.
- **Bloqueio de limpeza**: intervalo bloqueado automaticamente após toda reserva (padrão 30 min), não cobrado.
- **Bloqueio com tag**: bloqueio manual de slots com tag pré-definida ou texto livre.
- **Desconto por slot**: percentual aplicado pelo Admin a um horário livre, exibido em destaque no calendário público.
- **Cupom**: código de desconto, do tipo primeira reserva ou desconto, que pode ser habilitado e desabilitado.
- **DRE**: Demonstração do Resultado do Exercício, exportada em .xlsx pela tela Financeiro, em regime de caixa ou de competência.
- **MCP**: Model Context Protocol; permite operar o Admin a partir de um assistente de IA.
- **Gateway de pagamento**: provedor que processa Pix e cartão; trocável por configuração.
- **No-show**: não comparecimento sem cancelamento.

---

## 13. Referências
- Identidade visual da fachada e da recepção (imagem de referência enviada em 2026-09-26).
- Design system Bravô Clinic (artefato de Design System no claude.ai).
- Documentação do Neon (Postgres, Functions, Object Storage, Auth) e do Netlify.
- Mercado Pago Developers: Pix, cartões salvos, webhooks, reembolsos.
- Especificação do Model Context Protocol (MCP).
- RFC 5545 (iCalendar) para feeds e convites .ics.
- Feriados de Itajaí (SC) 2026: [FeriadosAPI](https://feriadosapi.com/calendario/2026/SC/4208203) e [iFeriados](https://www.iferiados.com.br/feriados/2026/regionais/sc/itajai), a confirmar com a Prefeitura de Itajaí.

---

## 14. Questões em Aberto

**Não há questões em aberto.** Todas as dúvidas levantadas entre as versões 1.0 e 1.5 foram respondidas e incorporadas ao documento. As decisões das duas últimas rodadas foram:

- **v1.5**:
  - valores e janelas padrão do briefing, usados como exemplo;
  - base do débito proporcional (V_ref);
  - uso das horas do pacote só no período corrente;
  - horas extras usáveis à frente;
  - mudança e cancelamento de pacote com efeito imediato;
  - cupom só no primeiro pagamento;
  - compensação de 1/30 por dia fechado;
  - validade de 90 dias dos créditos;
  - feriados do ano seguinte.
- **v1.6**:
  - horas extras com validade de 90 dias;
  - troca de pacote inicia novo período (nova data base);
  - troca de pacote de horário fixo reserva as novas ocorrências a partir da data da troca;
  - preços padrão são exemplos, definidos pelo Admin no primeiro acesso;
  - lista de feriados de SC e Itajaí confirmada como ponto de partida, a validar com os órgãos oficiais (§11).

---

## Histórico de versões

| Versão | Data | Mudanças |
|---|---|---|
| 1.0 | 2026-09-26 | Versão inicial |
| 1.1 | 2026-09-27 | Os intervalos 12:00–13:00 e 18:30–19:00 passam a ser reserváveis; as reservas podem atravessar períodos; criado o **bloqueio de limpeza obrigatório de 30 min** após cada reserva, com exemplos, critérios de aceite, garantia no banco de dados e novas questões em aberto |
| 1.2 | 2026-10-24 | Removidas da §5.3 as regras do motor de preços e a tabela de exemplos de cálculo; referências a elas ajustadas (§5.2, US-02, riscos); removido o banner de cookies da §7.1; removido de "Fora do escopo" o item de planos mensais, pacotes de horas, cupons e reservas recorrentes, e o de pagamento online de serviços extras |
| 1.3 | 2026-10-24 | Telas do Administrador geral detalhadas: Calendário, Gestão de Reservas, Financeiro (DRE em .xlsx), Integrações (gateway, ICS da clínica, MCP, e-mails), Cupons e Serviços Extras. Tabela de valores refeita como categorias configuráveis, com valor médio da hora; novos pacotes de horas, recorrentes, cupons e descontos. Infraestrutura definida (Neon + Netlify, free tier) e gateway de pagamento genérico. User stories, glossário, riscos e questões em aberto atualizados |
| 1.4 | 2026-10-25 | Respostas da clínica incorporadas: pacotes de horas viram assinatura com data base, períodos não cumulativos, renovação cobrada 2 dias antes e **débito proporcional ao valor do slot**; horas extras e troca de pacote em **Perfil → Compras**; novo **pacote de horário fixo** (substitui blocos mensais e recorrentes); bloqueio de limpeza após toda categoria; cupom de desconto vale para pacotes e não soma com desconto de slot (vale o maior); reagendamento mais barato gera **crédito**; cancelamento perde só o sinal; prazos de 60 e 90 dias; DRE em caixa e competência; extras em qualquer sala; feriados de SC e Itajaí; NFS-e na versão 2 |
| 1.5 | 2026-10-25 | Valores e janelas padrão do briefing (com categorias "2 horas ou mais" e noite, campo de duração mínima e preço por ocorrência no horário fixo); horas do pacote só no período corrente; horas extras usáveis à frente (até 90 dias); aumento, redução e cancelamento de pacote com efeito imediato e conversão do saldo; cupom só no primeiro pagamento; compensação de 1/30 por dia fechado; créditos com validade de 90 dias; feriados do ano corrente e do seguinte, com lembrete anual |
| 1.6 | 2026-10-25 | Últimas questões resolvidas: horas extras com validade de 90 dias; troca de pacote inicia novo período na data da troca; troca de horário fixo reserva as novas ocorrências a partir da troca; preços padrão marcados como exemplos a definir pelo Admin no primeiro acesso; feriados confirmados como ponto de partida. §14 sem questões em aberto |

---

*Este PRD foi construído por meio de levantamento interativo de requisitos com pontuação de qualidade, cobrindo as dimensões de negócio, funcional, UX e técnica.*
