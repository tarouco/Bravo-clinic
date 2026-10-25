import { renderLayout, type Rendered } from './layout';

export function passwordResetTemplate(input: { name: string; link: string }): Rendered {
  const { html, text } = renderLayout({
    heading: 'Redefinição de senha',
    paragraphs: [
      `Olá, ${input.name}!`,
      'Recebemos um pedido para redefinir a senha da sua conta na Bravô Clinic. O link abaixo vale por 60 minutos.',
    ],
    cta: { label: 'Redefinir senha', href: input.link },
    footnote: 'Se você não pediu a redefinição, ignore esta mensagem. Sua senha continua a mesma.',
  });
  return { subject: 'Redefina sua senha na Bravô Clinic', html, text };
}
