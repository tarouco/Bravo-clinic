// E-mail clients ignore CSS variables, so the v3 brand colors (docs/design/DESIGN-v3.md) are inlined.
const COLORS = {
  background: '#e7e6e3',
  card: '#fbfaf8',
  ink: '#583714',
  inkMuted: '#6b5a48',
  emerald: '#0f6b52',
  onEmerald: '#fbfaf8',
  hairline: '#d9d4ce',
} as const;

export interface Rendered {
  subject: string;
  html: string;
  text: string;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export interface LayoutInput {
  heading: string;
  /** Plain-text paragraphs; escaped when rendered. */
  paragraphs: string[];
  cta: { label: string; href: string };
  footnote: string;
}

/** Shared pt-BR layout: brand header, paragraphs, one call-to-action button and a footnote. */
export function renderLayout(input: LayoutInput): { html: string; text: string } {
  const paragraphs = input.paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:16px;line-height:24px;color:${COLORS.ink};">${escapeHtml(p)}</p>`,
    )
    .join('');
  const href = escapeHtml(input.cta.href);
  const html = `<!doctype html>
<html lang="pt-BR">
<body style="margin:0;padding:24px;background:${COLORS.background};font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:${COLORS.card};border:1px solid ${COLORS.hairline};border-radius:28px;">
<tr><td style="padding:24px 32px;border-bottom:1px solid ${COLORS.hairline};font-size:20px;letter-spacing:4px;color:${COLORS.ink};">BRAVÔ CLINIC</td></tr>
<tr><td style="padding:32px;">
<h1 style="margin:0 0 16px;font-size:24px;line-height:32px;font-weight:300;color:${COLORS.ink};">${escapeHtml(input.heading)}</h1>
${paragraphs}
<p style="margin:24px 0;"><a href="${href}" style="display:inline-block;padding:14px 28px;border-radius:9999px;background:${COLORS.emerald};color:${COLORS.onEmerald};text-decoration:none;font-size:15px;">${escapeHtml(input.cta.label)}</a></p>
<p style="margin:0 0 8px;font-size:14px;line-height:20px;color:${COLORS.inkMuted};">Se o botão não funcionar, copie e cole este link no navegador:</p>
<p style="margin:0 0 24px;font-size:14px;line-height:20px;word-break:break-all;"><a href="${href}" style="color:${COLORS.emerald};">${href}</a></p>
<p style="margin:0;font-size:14px;line-height:20px;color:${COLORS.inkMuted};">${escapeHtml(input.footnote)}</p>
</td></tr>
</table>
</td></tr></table>
</body>
</html>`;
  const text = [
    input.heading,
    '',
    ...input.paragraphs.flatMap((p) => [p, '']),
    `${input.cta.label}: ${input.cta.href}`,
    '',
    input.footnote,
  ].join('\n');
  return { html, text };
}
