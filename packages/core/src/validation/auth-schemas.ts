import { z } from 'zod';
import { parseDocument } from './document';

export const PASSWORD_MESSAGE = 'A senha precisa ter de 8 a 128 caracteres, com letras e números';
export const DOCUMENT_MESSAGE = 'CPF ou CNPJ inválido';

/** 8..128 characters with at least one letter and one digit. One message for every failure. */
export const passwordSchema = z
  .string({ error: PASSWORD_MESSAGE })
  .refine((v) => v.length >= 8 && v.length <= 128 && /\p{L}/u.test(v) && /\d/.test(v), {
    error: PASSWORD_MESSAGE,
  });

/** Trimmed, lower-cased e-mail. */
export const emailSchema = z
  .string({ error: 'Informe o e-mail' })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'E-mail inválido' }).max(254, { error: 'E-mail inválido' }));

const PHONE_MESSAGE = 'Telefone inválido. Use DDD + número';

function normalizePhone(input: string): string | null {
  let digits = input.replace(/\D/g, '');
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
    digits = digits.slice(2);
  }
  return /^[1-9]\d{9,10}$/.test(digits) ? `+55${digits}` : null;
}

/** Brazilian phone (DDD + 8 or 9 digits, masked input accepted) normalized to E.164. */
export const phoneSchema = z
  .string({ error: PHONE_MESSAGE })
  .refine((v) => normalizePhone(v) !== null, { error: PHONE_MESSAGE })
  .transform((v) => normalizePhone(v) ?? v);

const CODE_MESSAGE = 'Código inválido';
const TOTP_DIGITS = /^\d{6}$/;
const RECOVERY_CODE = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

/** A 6-digit TOTP code (spaces ignored) or a recovery code XXXX-XXXX (upper-cased). */
export const totpCodeSchema = z
  .string({ error: CODE_MESSAGE })
  .transform((v) => v.replace(/\s/g, '').toUpperCase())
  .refine((v) => TOTP_DIGITS.test(v) || RECOVERY_CODE.test(v), { error: CODE_MESSAGE });

function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max, { error: `Use no máximo ${String(max)} caracteres` })
    .transform((v) => (v === '' ? undefined : v))
    .optional();
}

export const signupSchema = z.object({
  name: z
    .string({ error: 'Informe seu nome' })
    .trim()
    .min(2, { error: 'Informe seu nome completo' })
    .max(120, { error: 'Use no máximo 120 caracteres' }),
  document: z
    .string({ error: DOCUMENT_MESSAGE })
    .trim()
    .refine((v) => parseDocument(v) !== null, { error: DOCUMENT_MESSAGE }),
  email: emailSchema,
  phone: phoneSchema,
  profession: optionalText(80),
  professionalRegistry: optionalText(40),
  password: passwordSchema,
  acceptTerms: z.literal(true, { error: 'É necessário aceitar os Termos de uso' }),
  acceptPrivacy: z.literal(true, { error: 'É necessário aceitar a Política de privacidade' }),
});
export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z
    .string({ error: 'Informe a senha' })
    .min(1, { error: 'Informe a senha' })
    .max(128, { error: 'Senha muito longa' }),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const passwordResetRequestSchema = z.object({ email: emailSchema });
export type PasswordResetRequestInput = z.infer<typeof passwordResetRequestSchema>;

export const passwordResetConfirmSchema = z.object({
  token: z.string({ error: 'Link inválido' }).min(1, { error: 'Link inválido' }),
  password: passwordSchema,
});
export type PasswordResetConfirmInput = z.infer<typeof passwordResetConfirmSchema>;
