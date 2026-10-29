# Plano de atualização — Bravô Clinic Design System v3

Status: **aguardando aprovação** · 28/10/2026
Fonte da marca: `Bravo-Clinic-Design-System-v3.pdf` + kit extraído em `docs/design/v3/bravo-clinic-design-system/` (tokens, `bundle.css`, `bundle.js`, guias, exemplos, logos, imagens).
Mapa de tokens detalhado: [`v3-mapa-de-tokens.md`](v3-mapa-de-tokens.md).

## 1. O que muda (resumo)

| Hoje (Serene Architecture) | v3 |
|---|---|
| Fundo creme #F5EEE6, ação bronze, assinatura champagne | Cinza Névoa #E7E6E3, ação **Verde Esmeralda**, destaque **Ouro**, texto **Marrom Luxo** |
| Cantos arquitetônicos 2–8px, botões em CAIXA ALTA | Pílulas em alto relevo, cards 28px, painéis 34px, botões em sentence case |
| Superfícies planas com sombra leve | 3 camadas fixas (névoa → painel/vidro → cards pérola), `lift-1/2/3` + `rim`, sobreposição como assinatura |
| Hover = troca de cor | **Neon**: traço que corre na borda no hover/foco, acende 1,6s no clique, fica aceso quando selecionado |
| Header fixo de largura total | NavBar em pílula flutuando sobre o painel; app com **TabBar** de vidro + FAB "nova reserva" |
| Noite marrom escuro + texto creme | Noite marrom profundo + texto ouro |

Escopo: todo o `apps/web` — site público, PWA do locatário (`/app`), Admin (`/admin`), telas de auth, PWA manifest/ícones, e-mails transacionais (cores) e `og-image`. API e `packages/core` não mudam.

## 2. Decisões de arquitetura (a registrar em `.specs/STATE.md`)

- **AD-038 · Tokens v3 como fonte única.** `apps/web/src/styles/tokens.css` passa a ser gerado de `tokens/tokens.json` v3 (canais RGB para manter `bg-x/90`). `DESIGN.md` é substituído por `DESIGN-v3.md`; o atual vira `DESIGN-v2-legacy.md`.
- **AD-039 · Migração em duas etapas com aliases.** Etapa 1 remapeia os nomes antigos para valores v3 (`bronze→emerald`, `champagne→gold`, `walnut→brown/emerald-deep`, `surface-stone→surface-panel`…), o que rebrandeia o sistema inteiro de uma vez sem quebrar 1.300+ classes. Etapa 2 renomeia as classes por codemod e remove os aliases. Cada etapa fica deployável.
- **AD-040 · Componentes v3 reimplementados em React, sem `bundle.js`.** O CSS de `bundle.css` (neon com gradiente cônico mascarado, relevos, vidro, fallbacks de `backdrop-filter` e `prefers-reduced-*`) é portado para `@layer components` com prefixo `bv-`; o comportamento de `bundle.js` (acender no clique, grupos de escolha única, slider, nav ativa) vira hooks (`useLightUp`, estado controlado pelo React). Motivo: o React é dono do estado — o script do kit manipula `aria-*` direto no DOM e brigaria com a reconciliação.
- **AD-041 · Temas.** O app mantém `data-theme="day|night"` (preferência já salva em `localStorage`); as variáveis do Noite v3 são aplicadas em `[data-theme="night"]`.
- **AD-042 · Tokens derivados para lacunas da v3** (erro, aviso, campos, tabelas, Admin denso) — ver §4 do mapa de tokens. Ficam marcados como "derivados" até a marca validar.

## 3. Fases

Cada fase termina com gates verdes (`npm run typecheck`, `npm run lint`, `npm test -w apps/web`, `npm run build`), verificação visual no preview (Dia e Noite, 390px e 1440px) e commit atômico. Deploy Netlify ao fim das fases 2, 4 e 6.

### Fase 0 — Fundação de documentação (½ dia)
- `docs/design/DESIGN-v3.md` consolidando `brand-book.md` + decisões AD-038…042 + lacunas.
- Spec TLC em `.specs/features/rebrand-v3/` (requisitos EARS por superfície, tarefas, matriz de testes).
- Inventário de telas com screenshot "antes" (baseline para comparação).

### Fase 1 — Tokens e base (1 dia)
- Novo `tokens.css` (Dia/Noite v3 + derivados), `tailwind.config.ts` com cores, `spacing` 1–16, `borderRadius` sm/md/lg/xl/pill, `boxShadow` lift/rim/relief/deboss/neon-glow, `backgroundImage` grad-*, escala tipográfica v3 + variantes `-web`.
- Aliases antigos → valores v3 (AD-039).
- `index.html`: `theme-color` #0F6B52 / Noite #3D260D; fontes com pesos 300/400/600 (Josefin) e 300–600 (Jost).
- `Icon`: `strokeWidth 1.7`, `strokeLinecap/Join round`.
- Resultado: sistema inteiro já nas cores v3, com geometria antiga.

### Fase 2 — Primitivos de UI (2 dias)
Portar `bundle.css` e reescrever `components/ui/*`:

| Componente atual | Vira | Notas |
|---|---|---|
| `Button` (primary/secondary/ghost/link) | `bv-btn` emerald / pearl / brown / gold + `link` | pílula, relevo, neon, `deboss` no press; `sm` 40px, `block` 54px; label sentence case |
| — | `IconButton` | 54/42px, `aria-label` obrigatório |
| `Card`, `StatTile`, `RoomCard`, `PackageCard` | `bv-card` pérola / `--gold` / `--emerald` (com `bv-silk`) | regra "1 card colorido por tela" |
| `Badge`, `StatusBadge` | pílulas `surface-deboss`; status via derivados | |
| `Tabs`, `Stepper` | `bv-chip` com `aria-pressed` / nav debossed | |
| `Modal`, `Drawer` | `bv-modal` sobre `bv-scrim` borrado; `bv-sheet` < 640px | |
| `Popover`, `HoverCard`, menus | `bv-menu` de vidro | nunca vidro sobre vidro |
| `form/*` (input, select, checkbox, máscara, senha) | campo afundado (`deboss`), `Toggle` v3 para switches, `Slider` v3 | derivados AD-042 |
| `Toast`, `Feedback` | pérola `lift-3` + ícone; erro com `danger` | |
| `Table`, `LedgerTable` | linhas `radius-md` em pérola, cabeçalho `eyebrow` | |
| `Brand` | nome em tipo: BRAVÔ (display, tracking largo) + CLINIC + — SALAS INTELIGENTES — | nunca imagem recortada |

Testes: Vitest/Testing Library para `useLightUp` (clique acende 1,6s, selecionado fica aceso, `disabled` sem neon), grupos de chips (escolha única), slider (setas/Home/End), `prefers-reduced-motion`.

### Fase 3 — Layout e navegação (1½ dia)
- **Site** (`PublicLayout`, `Header`, `Footer`): palco `surface` + `bv-panel`; NavBar em pílula sobreposta à borda do painel (link ativo = pílula afundada + peso 600, um "Reservar" esmeralda); menu mobile vira `bv-menu`/sheet; rodapé em `emerald-deep` com texto `on-emerald`/ouro.
- **App** (`AppShell`): TabBar de vidro flutuando 14px acima da borda, 4 abas (Início, Agenda, Compras, Perfil) + FAB "nova reserva"; margem 20px, `padding-bottom` 96px.
- **Admin** (`AdminShell`): sidebar como painel de vidro com itens em pílula afundada no ativo; conteúdo em `surface` com cards pérola; densidade compacta permitida.
- `ThemeToggle` como `Toggle` v3; `WhatsAppButton` como `IconButton` flutuante.

### Fase 4 — Site público (2 dias)
- Home recomposta pelo padrão **WebHero** (card herói pérola alto com eyebrow, `display-l`, `lead`, botões ouro + esmeralda; card ouro; card pérola com `bv-overhang-end`; card esmeralda com seda; card pequeno). Orbs de pedra/brilho dourado só no palco, nunca sob texto. < 900px empilha e remove sobreposições.
- Seções: Arquitetura, Salas (etiqueta de preço ouro flutuando sobre a foto), Simulador de preço (chips + slider v3), Extras, Faixa da recepção (`emerald-deep` no lugar do walnut), Estrutura (modal de vídeo como `bv-modal`).
- Páginas: Salas, Sala, Preços, Políticas, Contato, Extras, Assinar, Checkout/Pré-reserva, Legal, 404.
- Texto: revisar para "menos palavras" (um título + uma frase por card, botões de uma palavra), **Bravô** sempre com acento, pilares na ordem Saúde · Beleza · Bem-estar, sem exclamação. Mudanças de copy entram como commit separado para revisão.

### Fase 5 — PWA do locatário (2 dias)
- Início, Agenda (faixa de dias `bv-week`/`bv-day`), Fluxo de reserva (Data → Horário em chips → Resumo; botão `block` esmeralda), Detalhe da reserva (foto full-bleed + sheet `radius-xl` subindo), Minhas reservas, Compras/Créditos/Horas extras, Cartões, Orçamentos, Perfil, Notificações (Toggles), Privacidade.
- Referência: `exemplos/AppScreens.html` (Início, Sala, Agenda).

### Fase 6 — Admin e auth (2 dias)
- Agenda/calendários (`ScheduleGrid`, `DayView`, `WeekCalendar`, `MonthCalendar`, `SlotGrid`): blocos de reserva em pílula `radius-md`, livres em `surface-deboss`, selecionado com neon; categorias com faixa de cor derivada da paleta.
- Reservas, Clientes, Salas (gestor de fotos), Finanças (gráfico de evolução nas cores v3), Cupons, Extras, Integrações, Usuários, Auditoria, Calendário.
- Auth (Login, Cadastro, 2FA, Verificar e-mail, Senha): `AuthCard` como card pérola sobre palco com logo em tipo.

### Fase 7 — Ativos, e-mail e limpeza (1 dia)
- Ícones PWA/maskable e `og-image` com monograma Ô sobre esmeralda (provisório até o vetor oficial); manifest `theme_color`/`background_color`.
- Templates de e-mail (API `email_outbox`/Resend): cores v3 inline.
- Codemod de renomeação (Etapa 2 da AD-039), remover aliases e tokens Material sem uso; `DESIGN.md` → legado.
- Auditoria final: contraste automatizado (axe no Playwright) em Dia e Noite, `prefers-reduced-motion`, `prefers-reduced-transparency`, navegação por teclado com neon de foco visível, Lighthouse (performance do `backdrop-filter` em Android médio).

**Estimativa total:** ~12 dias de trabalho de agente, executável em paralelo a partir da Fase 2 (Fases 4, 5 e 6 tocam pastas distintas).

## 4. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Escala tipográfica v3 pequena para desktop | variantes `-web` validadas contra o PDF; app usa a escala pura |
| `backdrop-filter` pesado em celulares e no calendário do Admin | vidro só em barras/menus; fallback sólido do `bundle.css`; nada de vidro em listas longas |
| Neon animado distrai em telas densas (Admin) | neon só em controles, nunca em linhas de tabela; respeita reduced-motion |
| Ouro (#FFEB97) ilegível como texto no claro | lint de classes: proibir `text-gold`/`text-neon` fora de fundos escuros |
| Regressão visual ampla | baseline de screenshots (Fase 0) e comparação por fase; aliases mantêm o sistema funcional entre fases |
| Pendências da marca (logo vetorial, fontes oficiais, fotos, ícones próprios) | tudo isolado em tokens/`Brand`/`Icon` para troca posterior sem tocar telas |

## 5. Pontos que preciso que você confirme

1. **Faixas escuras** (hoje `walnut`): esmeralda profundo (recomendado — mantém o marrom só para texto) ou Marrom Luxo?
2. **Tokens derivados** de erro/aviso/campos/tabelas (mapa §4): aprovar como propostos?
3. **Revisão de copy** ("menos texto") entra neste projeto ou fica só o visual?
4. **TabBar do app**: abas Início · Agenda · [FAB] · Compras · Perfil — ok?
5. **Deploy**: produção ao fim das fases 2, 4 e 6 (padrão do projeto) ou só no final?

## 6. Artefatos salvos nesta etapa

- `docs/design/v3/bravo-clinic-design-system/` — kit v3 extraído (sem duplicar o PDF).
- `docs/design/v3-mapa-de-tokens.md` — mapeamento token a token e lacunas.
- `docs/design/PLANO-ATUALIZACAO-V3.md` — este plano.
