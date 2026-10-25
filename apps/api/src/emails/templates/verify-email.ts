import { renderLayout, type Rendered } from './layout';

export function verifyEmailTemplate(input: { name: string; link: string }): Rendered {
  const { html, text } = renderLayout({
    heading: 'Confirme seu e-mail',
    paragraphs: [
      `Olá, ${input.name}!`,
      'Para concluir seu cadastro na Bravô Clinic e poder reservar salas, confirme seu e-mail pelo botão abaixo. O link vale por 24 horas.',
    ],
    cta: { label: 'Confirmar e-mail', href: input.link },
    footnote: 'Se você não criou uma conta na Bravô Clinic, ignore esta mensagem.',
  });
  return { subject: 'Confirme seu e-mail na Bravô Clinic', html, text };
}
