import { describe, expect, it } from 'vitest';
import {
  emailSchema,
  loginSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  passwordSchema,
  phoneSchema,
  signupSchema,
  totpCodeSchema,
} from './auth-schemas';

const PASSWORD_MESSAGE = 'A senha precisa ter de 8 a 128 caracteres, com letras e números';

const validSignup = {
  name: 'Camila Duarte',
  document: '529.982.247-25',
  email: 'camila@example.com',
  phone: '(47) 99999-0000',
  password: 'senha123',
  acceptTerms: true,
  acceptPrivacy: true,
};

interface Failure {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}

function issuesOf(result: Failure) {
  return (result.error?.issues ?? []).map((i) => ({
    path: i.path.map(String).join('.'),
    message: i.message,
  }));
}

describe('passwordSchema (FND-17)', () => {
  it.each([
    ['too short', 'abc12'],
    ['7 characters long with letters and digits', 'abcde12'],
    ['without a digit', 'abcdefgh'],
    ['without a letter', '12345678'],
    ['129 characters long', `a1${'x'.repeat(127)}`],
  ])('rejects a password that is %s with the exact policy message', (_label, value) => {
    const result = passwordSchema.safeParse(value);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.message)).toEqual([PASSWORD_MESSAGE]);
  });

  it('rejects a non-string value with the policy message', () => {
    const result = passwordSchema.safeParse(undefined);
    expect(result.error?.issues.map((i) => i.message)).toEqual([PASSWORD_MESSAGE]);
  });

  it('accepts "senha123" and the 8 and 128 character boundaries', () => {
    expect(passwordSchema.parse('senha123')).toBe('senha123');
    expect(passwordSchema.safeParse('abcdefg1').success).toBe(true);
    expect(passwordSchema.safeParse(`a1${'x'.repeat(126)}`).success).toBe(true);
  });

  it('accepts exactly 8 ("abcdef12") and exactly 128 characters, rejecting 7 and 129', () => {
    const at128 = `a1${'x'.repeat(126)}`;
    const at129 = `a1${'x'.repeat(127)}`;
    expect(at128).toHaveLength(128);
    expect(at129).toHaveLength(129);
    expect('abcdef12').toHaveLength(8);
    expect('abcde12').toHaveLength(7);
    expect(passwordSchema.safeParse('abcdef12').success).toBe(true);
    expect(passwordSchema.safeParse(at128).success).toBe(true);
    expect(passwordSchema.safeParse('abcde12').success).toBe(false);
    expect(passwordSchema.safeParse(at129).success).toBe(false);
  });
});

describe('emailSchema', () => {
  it('trims and lower-cases', () => {
    expect(emailSchema.parse('  Ana@Ex.com ')).toBe('ana@ex.com');
  });

  it('rejects an invalid e-mail', () => {
    expect(emailSchema.safeParse('not-an-email').success).toBe(false);
  });
});

describe('phoneSchema', () => {
  it('normalizes a masked mobile number to E.164', () => {
    expect(phoneSchema.parse('(47) 99999-0000')).toBe('+5547999990000');
  });

  it('accepts a landline and a number already carrying +55', () => {
    expect(phoneSchema.parse('(47) 3333-4444')).toBe('+554733334444');
    expect(phoneSchema.parse('+55 47 99999-0000')).toBe('+5547999990000');
  });

  it('rejects numbers that are not Brazilian phones', () => {
    expect(phoneSchema.safeParse('12345').success).toBe(false);
    expect(phoneSchema.safeParse('(47) 999-0000-123').success).toBe(false);
  });
});

describe('totpCodeSchema', () => {
  it('strips spaces from a 6-digit code ("123 456" becomes "123456")', () => {
    expect(totpCodeSchema.parse('123 456')).toBe('123456');
  });

  it('accepts a recovery code XXXX-XXXX, normalized to upper case', () => {
    expect(totpCodeSchema.parse('abcd-efgh')).toBe('ABCD-EFGH');
  });

  it('rejects short codes and recovery codes using the excluded characters', () => {
    expect(totpCodeSchema.safeParse('12345').success).toBe(false);
    expect(totpCodeSchema.safeParse('ABCO-EFG1').success).toBe(false);
  });
});

describe('signupSchema (FND-44, FND-47)', () => {
  it('accepts a valid body and normalizes e-mail and phone', () => {
    const parsed = signupSchema.parse({ ...validSignup, email: ' Camila@Example.com ' });
    expect(parsed.email).toBe('camila@example.com');
    expect(parsed.phone).toBe('+5547999990000');
    expect(parsed.document).toBe('529.982.247-25');
  });

  it('rejects document "529.982.247-24" at path document with "CPF ou CNPJ inválido"', () => {
    const result = signupSchema.safeParse({ ...validSignup, document: '529.982.247-24' });
    expect(issuesOf(result)).toEqual([{ path: 'document', message: 'CPF ou CNPJ inválido' }]);
  });

  it('accepts a CNPJ document', () => {
    const result = signupSchema.safeParse({ ...validSignup, document: '11.222.333/0001-81' });
    expect(result.success).toBe(true);
  });

  it('rejects acceptTerms false at path acceptTerms', () => {
    const result = signupSchema.safeParse({ ...validSignup, acceptTerms: false });
    expect(result.success).toBe(false);
    expect(issuesOf(result).map((i) => i.path)).toEqual(['acceptTerms']);
  });

  it('rejects acceptPrivacy false at path acceptPrivacy', () => {
    const result = signupSchema.safeParse({ ...validSignup, acceptPrivacy: false });
    expect(result.success).toBe(false);
    expect(issuesOf(result).map((i) => i.path)).toEqual(['acceptPrivacy']);
  });

  it('applies the password policy at path password', () => {
    const result = signupSchema.safeParse({ ...validSignup, password: 'abc12' });
    expect(issuesOf(result)).toEqual([{ path: 'password', message: PASSWORD_MESSAGE }]);
  });

  it('keeps profession and professionalRegistry optional', () => {
    const parsed = signupSchema.parse({
      ...validSignup,
      profession: 'Dermatologista',
      professionalRegistry: 'CRM-SC 12345',
    });
    expect(parsed.profession).toBe('Dermatologista');
    expect(parsed.professionalRegistry).toBe('CRM-SC 12345');
    expect(signupSchema.parse(validSignup).profession).toBeUndefined();
  });
});

describe('loginSchema', () => {
  it('normalizes the e-mail and requires a password', () => {
    expect(loginSchema.parse({ email: ' Ana@Ex.com', password: 'x' })).toEqual({
      email: 'ana@ex.com',
      password: 'x',
    });
    expect(loginSchema.safeParse({ email: 'ana@ex.com', password: '' }).success).toBe(false);
  });
});

describe('password reset schemas (FND-60, FND-61)', () => {
  it('request takes only a normalized e-mail', () => {
    expect(passwordResetRequestSchema.parse({ email: 'ANA@ex.com' })).toEqual({
      email: 'ana@ex.com',
    });
  });

  it('confirm requires a token and a policy-compliant password', () => {
    expect(passwordResetConfirmSchema.parse({ token: 'tok', password: 'senha123' })).toEqual({
      token: 'tok',
      password: 'senha123',
    });
    const weak = passwordResetConfirmSchema.safeParse({ token: 'tok', password: 'abc' });
    expect(issuesOf(weak)).toEqual([{ path: 'password', message: PASSWORD_MESSAGE }]);
    const noToken = passwordResetConfirmSchema.safeParse({ token: '', password: 'senha123' });
    expect(noToken.success).toBe(false);
  });
});
