# Bravô Clinic — Design System v3 (exportação)

Exportado do design system oficial no Claude em outubro de 2026.

| Pasta / arquivo | Para quê |
|---|---|
| `Bravo-Clinic-Design-System-v3.pdf` | Brand book completo para leitura e apresentação |
| `brand-book.md` | As mesmas regras em texto (para agentes, docs e repositórios) |
| `tokens/tokens.css` | Variáveis CSS dos temas Dia e Noite (`data-theme="dark"`) e classes de texto |
| `tokens/tokens.json` | Tokens no formato do design system do Claude |
| `tokens/tokens.dtcg.json` | Padrão W3C/DTCG: Figma (Tokens Studio), Style Dictionary, Penpot |
| `tokens/tailwind.preset.js` | Preset do Tailwind |
| `components/bundle.css` | Gradientes, camadas, relevo, neon e todos os componentes (`bv-*`) |
| `components/bundle.js` | Clique que acende, interruptores, escolha única, deslizante e menu ativo (sem dependências) |
| `exemplos/` | Uma página por componente, com botões para alternar Dia/Noite. Abra no navegador |
| `guias/` | Regras de uso de cada componente |
| `logos/`, `imagens/` | Recortes do render (provisórios) |

Uso mínimo:

```html
<link rel="stylesheet" href="tokens/tokens.css">
<link rel="stylesheet" href="components/bundle.css">
<script src="components/bundle.js"></script>
<button class="bv-btn bv-btn--emerald">Reservar</button>
<script>BravoClinic.init();</script>
```

Pendências: logo oficial em vetor, fontes oficiais (hoje Josefin Sans e Jost), fotos reais e um conjunto de ícones próprio.
