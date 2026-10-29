# Bravô Clinic — Design System v3 (fonte de verdade)

A marca: `Bravo-Clinic-Design-System-v3.pdf` (brand book) e o kit exportado em
[`v3/bravo-clinic-design-system/`](v3/bravo-clinic-design-system/LEIA-ME.md). As regras completas
estão em [`brand-book.md`](v3/bravo-clinic-design-system/brand-book.md) e nos guias por componente
em [`guias/`](v3/bravo-clinic-design-system/guias/). Este arquivo diz como o app aplica o kit e o que
foi decidido onde a v3 não fala. Decisões: `.specs/STATE.md` AD-038 a AD-042.

## Onde está cada coisa no código

| Kit v3 | `apps/web` |
|---|---|
| `tokens/tokens.css` | `src/styles/tokens.css` (canais RGB `--c-*` + nomes `--emerald`, `--ink`… em `rgb()`) |
| `tokens/tailwind.preset.js` | `tailwind.config.ts` (`bg-emerald`, `shadow-lift-2`, `rounded-lg`, `bg-grad-gold`…) |
| `components/bundle.css` | `src/styles/bv.css` (classes `bv-*`, antes das camadas do Tailwind) |
| `components/bundle.js` | estado React nos componentes de `src/components/ui` |
| `data-theme="dark"` | `data-theme="night"` (AD-041) |

## Regras de aplicação (resumo do brand book)

- **Cores:** névoa ao fundo, painel/vidro no meio, cards pérola por cima. Esmeralda é a ação e o estado ativo; ouro é o destaque (um card especial, etiqueta de preço, pílula secundária); Marrom Luxo é todo texto. Um card colorido (esmeralda ou ouro) por tela. Ouro e neon nunca são texto em fundo claro.
- **`accent`** (derivado): esmeralda no Dia, ouro na Noite — para texto/ícone de destaque, item ativo e anel de foco. Botões preenchidos usam `emerald` nos dois temas.
- **Relevo:** controles em pílula com `relief-*`; pressionado e item ativo afundam com `deboss`; cada camada acima ganha um nível de `lift`, sempre com `rim`.
- **Cantos:** pílula para botões, chips, toggles, barras e itens de navegação; 28px cards; 34px painéis e sheets; 24px tiles e linhas de lista; 16px miniaturas.
- **Neon:** hover/foco = traço correndo na borda; clique = acende 1,6s; selecionado = aceso enquanto durar; desabilitado = sem neon e sem relevo (42%). Só em controles, nunca em linhas de tabela.
- **Navegação:** site com NavBar em pílula sobre o painel (ativo = pílula afundada + peso 600) e um "Reservar" esmeralda; app com TabBar de vidro a 14px da borda, 4 abas + FAB "nova reserva"; menus de vidro; modais pérola sobre scrim borrado.
- **Texto:** português do Brasil, frases curtas, sem exclamação e sem emoji; **Bravô** sempre com acento; Saúde · Beleza · Bem-estar nesta ordem; caixa alta só no nome (`display-xl`) e em `eyebrow`; botões em sentence case, de preferência uma palavra.
- **Ícones:** lucide em contorno, traço 1,7px, pontas arredondadas, `currentColor`; `ink-muted` em repouso, `accent` ativo.
- **Logo:** nas interfaces, o nome vai em tipo (BRAVÔ display com tracking largo + CLINIC + — SALAS INTELIGENTES —). Os recortes em `logos/` são só para apresentações.

## Tipografia no app

| Classe | Uso | Tamanho |
|---|---|---|
| `text-display-xl` / `-mobile` | nome da marca | 58/64 · 38/44, 300, .10em, caixa alta |
| `text-display-l` / `-mobile` | título de tela e hero | 42/48 · 30/34 (v3), 300, .02em |
| `text-heading` / `-mobile` | título de card | 24/32 · 19/26 (v3), 400, .04em |
| `text-eyebrow` | rótulo | 11/16, .32em, caixa alta, `accent` |
| `text-lead` | a frase do hero | 17/27 |
| `text-body` / `text-small` | texto | 15/24 · 14/22 (v3 body) |
| `text-label` | botões | 14,5/16, 500, .04em |
| `text-caption` | metadados | 12/18 |

Os tamanhos v3 são de tela de app (390px); os sem sufixo são variantes web (derivado, AD-042).

## Lacunas da v3 e decisões derivadas (AD-042, aguardam validação da marca)

- **Status:** `danger` #A12A1E / Noite #FFB4A6, `danger-soft` para fundos; aviso = fundo ouro + `on-gold`; sucesso = esmeralda.
- **Campos:** afundados (`bv-field`: `surface-deboss` + `deboss`, 24px, foco com neon). Entrada afunda, ação sobe.
- **Admin:** tabelas com linhas pérola em 24px e cabeçalho `eyebrow`; densidade compacta permitida só no Admin.
- **Mapa token a token v2 → v3:** [`v3-mapa-de-tokens.md`](v3-mapa-de-tokens.md).

## Pendências da marca

Logo oficial em vetor, fontes oficiais (hoje Josefin Sans e Jost), fotos reais e um conjunto próprio de ícones. Tudo está isolado em tokens, `Brand` e `Icon` para troca sem mexer nas telas.
