# Mapa de tokens — Serene Architecture (v2) → Design System v3

Fonte nova: `docs/design/v3/bravo-clinic-design-system/tokens/tokens.css` e `brand-book.md`.
Fonte atual: `apps/web/src/styles/tokens.css` + `apps/web/tailwind.config.ts` (derivados de `docs/design/DESIGN.md`).

Uso medido em `apps/web/src` (ocorrências em `className`, out/2026): `ink` ≈1.300, `ink-muted` ≈250, `bronze` ≈225, `secondary` ≈155, `hairline` ≈125, `surface-raised` ≈80, `champagne` ≈60, `surface-stone` ≈30, `walnut` ≈25.

## 1. Cores (Dia)

| Token atual | Valor atual | Token v3 | Valor v3 | Observação |
|---|---|---|---|---|
| `surface` / `background` | #F5EEE6 | `surface` (Cinza Névoa) | #E7E6E3 | fundo de tudo |
| `surface-stone`, `surface-container*` | #E7DACE… | `surface-panel` | #F3F2EF | camada do meio |
| `surface-raised`, `surface-container-lowest` | #FBF7F2 | `surface-raised` (Branco Pérola) | #FBFAF8 | cards |
| — | — | `surface-deboss` | #EEEDEA | item ativo afundado |
| `ink`, `on-surface` | #2E1A0C | `ink` (Marrom Luxo) | #583714 | todo texto |
| `ink-muted`, `on-surface-variant` | #6B5445 | `ink-muted` | #6B5A48 | legendas (5.2:1) |
| `border`, `outline` | #8F6F58 | `border` | #8F7A66 | bordas de campo |
| `hairline`, `outline-variant` | #CDB8A5 | `hairline` | rgba(88,55,20,.10) | divisórias |
| `bronze`, `primary` (ação) | #7A461D | `emerald` | #0F6B52 | ação primária e estado ativo |
| `on-bronze`, `on-primary` | #FBF7F2 | `on-emerald` | #FBFAF8 | |
| `walnut` (faixas escuras) | #63391C | `emerald-deep` (faixas) ou `brown` (pílula terciária) | #0A3B2C / #583714 | decidir por uso, ver §5 |
| `champagne` (assinatura) | #DAAF93 | `gold` (Ouro) | #FFEB97 | destaque, preço, card especial; nunca texto no claro |
| `champagne-soft` | #EFDCCD | `gold` com gradiente `grad-gold` | | |
| `on-champagne` | #2E1A0C | `on-gold` | #583714 | |
| `secondary*`, `tertiary*` | vários marrons | eliminar → `ink`/`brown`/`surface-panel` | | tokens Material sem papel na v3 |
| — | — | `neon` / `neon-hot` | #19B38A / #7FF0CF | só interação (hover/foco/clique/selecionado) |
| — | — | `glass`, `glass-bar`, `glass-hover`, `scrim` | rgba | translucidez |
| `error*` | #BA1A1A | **sem equivalente na v3** | — | ver §4 |

Noite: o tema `night` atual (marrom #1D140E) passa a ser o **Noite v3** (chão #3D260D, texto `gold` #FFEB97, foco `gold`).
O seletor muda de `[data-theme="night"]` para manter `night` no app e mapear as variáveis do `[data-theme="dark"]` v3 (o kit usa `dark`; o app mantém `day`/`night` para não invalidar a preferência salva em `localStorage`).

## 2. Tipografia

| Estilo | Atual | v3 |
|---|---|---|
| `display-xl` | 64/68, 300, .12em | 54/58, 300, .10em, CAIXA ALTA só no nome |
| `display-l` | 44/52, .08em | 30/34, .02em, sentence case |
| `heading` | 28/36 | 19/26, 400, .04em |
| `eyebrow` | 13/18 .32em | 11/16 .32em, cor `emerald` |
| `lead` | 19/30, 300 | 15/24, 400 |
| `body` | 16/26 | 14/22 |
| `label` (botões) | `small` caixa alta .08em | 14.5/16, 500, .04em, **sentence case** |
| `caption` | 12/18, 500 | 12/18, 400 |

A escala v3 foi desenhada para telas de app (390px). Para o site em desktop, o plano propõe variantes `-web` (≈1,4×) só para `display-xl`, `display-l` e `lead`, validadas contra o PDF.

## 3. Forma, sombra, espaço

| Atual | v3 |
|---|---|
| `rounded-control` 2px, `rounded-card` 8px (cantos arquitetônicos) | `radius-pill` em todo botão/chip/toggle/barra; `radius-lg` 28px cards; `radius-xl` 34px painéis/sheets; `radius-md` 24px tiles/linhas; `radius-sm` 16px miniaturas |
| `shadow-raised`, `shadow-glow` | `lift-1/2/3` + `rim`; relevos `relief-*`; `deboss`; `neon-glow` |
| `space-xs…space-hero` (rem) | `space-1…space-16` (px) — app: margem 20, gap 16, padding inferior 96; web: gap 24, painel 32, seção 64 |
| ícones lucide `strokeWidth 1.5` | 1.7px, cantos arredondados, `currentColor` |

## 4. Lacunas da v3 (tokens derivados — precisam de aprovação da marca)

A v3 não define cor de erro/sucesso/aviso, campos de formulário, tabelas nem telas densas de Admin. Proposta:

| Token derivado | Dia | Noite | Regra |
|---|---|---|---|
| `danger` | #A12A1E (texto ≥5:1 em névoa e pérola) | #FFB4A6 | erro de campo, ação destrutiva |
| `danger-soft` | #F6E1DC | #5A2416 | fundo de alerta |
| `success` | usa `emerald` | usa `neon` | confirmações |
| `warning` | `gold` como fundo + `on-gold` | idem | pendências; nunca texto amarelo |
| Campo de formulário | `surface-deboss` + `deboss` + `radius-md`, foco `focus-ring` 2px + `neon-glow` | | "afundado" = entrada, "em relevo" = ação |
| Tabela Admin | linhas `radius-md` em `surface-raised`, cabeçalho `eyebrow`, zebra com `surface-panel` | | densidade compacta permitida só no Admin |
