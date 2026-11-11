import { renderLayout, type Rendered } from './layout';

/** The one-time code of the two-factor step, for a user who asked for it by e-mail (AD-047). */
export function mfaCodeTemplate(input: { name: string; code: string; minutes: number }): Rendered {
  const { html, text } = renderLayout({
    heading: 'Seu código de verificação',
    paragraphs: [
      `Olá, ${input.name}!`,
      `Use o código abaixo para concluir a verificação em duas etapas na Bravô Clinic. Ele vale por ${String(input.minutes)} minutos e só pode ser usado uma vez.`,
    ],
    code: input.code,
    footnote:
      'Se você não está tentando entrar na sua conta, alguém pode ter a sua senha: troque-a em "Esqueci minha senha". Nunca informe este código a ninguém.',
  });
  return { subject: 'Seu código de verificação na Bravô Clinic', html, text };
}
