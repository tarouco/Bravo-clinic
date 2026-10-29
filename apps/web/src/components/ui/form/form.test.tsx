import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  Checkbox,
  DocumentInput,
  Field,
  Input,
  PasswordInput,
  PhoneInput,
  Select,
  Textarea,
} from './index';

describe('Field and Input', () => {
  it('binds the visible label to the control so getByLabelText finds it', () => {
    render(<Input label="E-mail" />);
    const input = screen.getByLabelText('E-mail');
    expect(input.tagName.toLowerCase()).toBe('input');
    expect(screen.getByText('E-mail').tagName.toLowerCase()).toBe('label');
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(input).not.toHaveAttribute('aria-describedby');
  });

  it('sets aria-invalid and points aria-describedby at the error text when an error is passed', () => {
    render(<Input label="E-mail" error="Obrigatório" />);
    const input = screen.getByLabelText('E-mail');
    const error = screen.getByText('Obrigatório');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(error.id).not.toBe('');
    expect(input).toHaveAttribute('aria-describedby', error.id);
  });

  it('describes the control by help text and error text together', () => {
    render(<Input label="E-mail" help="Usamos para avisos" error="Obrigatório" />);
    const input = screen.getByLabelText('E-mail');
    const help = screen.getByText('Usamos para avisos');
    const error = screen.getByText('Obrigatório');
    expect(input).toHaveAttribute('aria-describedby', `${help.id} ${error.id}`);
  });

  it('styles the control as the sunken v3 field, whose focus is the neon border (bv.css)', () => {
    render(<Input label="Nome" />);
    const input = screen.getByLabelText('Nome');
    expect(input).toHaveClass('bv-field', 'h-12');
    expect(input).not.toHaveClass('focus-visible:ring-2');
    expect(screen.getByText('Nome')).toHaveClass('text-small', 'font-medium', 'text-ink');
  });

  it('paints an invalid field and its message in danger', () => {
    render(<Input label="Nome" error="Obrigatório" />);
    expect(screen.getByLabelText('Nome')).toHaveClass('bv-field', 'border-danger');
    expect(screen.getByText('Obrigatório')).toHaveClass('text-caption', 'text-danger');
  });

  it('Field passes the id, aria-invalid and aria-describedby to a custom control', () => {
    render(
      <Field label="Cidade" error="Escolha uma cidade">
        {(control) => <input {...control} />}
      </Field>,
    );
    const input = screen.getByLabelText('Cidade');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', screen.getByText('Escolha uma cidade').id);
  });
});

describe('Select, Textarea and Checkbox', () => {
  it('wires label, focus ring and error on Select', () => {
    render(
      <Select label="Sala" error="Escolha uma sala">
        <option value="a">Sala Principal</option>
      </Select>,
    );
    const select = screen.getByLabelText('Sala');
    expect(select.tagName.toLowerCase()).toBe('select');
    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(select).toHaveClass('bv-field', 'appearance-none');
  });

  it('wires label, focus ring and error on Textarea', () => {
    render(<Textarea label="Observações" error="Muito longo" />);
    const textarea = screen.getByLabelText('Observações');
    expect(textarea.tagName.toLowerCase()).toBe('textarea');
    expect(textarea).toHaveAttribute('aria-describedby', screen.getByText('Muito longo').id);
    expect(textarea).toHaveClass('bv-field');
  });

  it('toggles a Checkbox through its label and wires the error', async () => {
    const onChange = vi.fn();
    render(<Checkbox label="Aceito os Termos de uso" error="Obrigatório" onChange={onChange} />);
    const checkbox = screen.getByLabelText('Aceito os Termos de uso');
    expect(checkbox).toHaveAttribute('type', 'checkbox');
    expect(checkbox).toHaveAttribute('aria-invalid', 'true');
    expect(checkbox).toHaveAttribute('aria-describedby', screen.getByText('Obrigatório').id);
    expect(checkbox).toHaveClass(
      'h-5',
      'w-5',
      'rounded-[6px]',
      'accent-emerald',
      'focus-visible:ring-2',
      'focus-visible:ring-accent',
    );
    await userEvent.click(screen.getByText('Aceito os Termos de uso'));
    expect(checkbox).toBeChecked();
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe('DocumentInput and PhoneInput masks', () => {
  it('masks 11 typed digits as a CPF', async () => {
    render(<DocumentInput label="CPF ou CNPJ" />);
    const input = screen.getByLabelText('CPF ou CNPJ');
    await userEvent.type(input, '52998224725');
    expect(input).toHaveValue('529.982.247-25');
  });

  it('masks 14 typed digits as a CNPJ', async () => {
    render(<DocumentInput label="CPF ou CNPJ" />);
    const input = screen.getByLabelText('CPF ou CNPJ');
    await userEvent.type(input, '11222333000181');
    expect(input).toHaveValue('11.222.333/0001-81');
  });

  it('passes the masked value to the consumer onChange and ignores non-digits', async () => {
    const seen: string[] = [];
    render(
      <DocumentInput label="CPF ou CNPJ" onChange={(event) => seen.push(event.target.value)} />,
    );
    await userEvent.type(screen.getByLabelText('CPF ou CNPJ'), '529a98');
    expect(seen.at(-1)).toBe('529.98');
  });

  it('masks a phone as (47) 99999-0000', async () => {
    render(<PhoneInput label="Celular" />);
    const input = screen.getByLabelText('Celular');
    await userEvent.type(input, '47999990000');
    expect(input).toHaveValue('(47) 99999-0000');
  });
});

describe('PasswordInput', () => {
  it('switches the input type between password and text with an accessible toggle label', async () => {
    render(<PasswordInput label="Senha" />);
    const input = screen.getByLabelText('Senha');
    expect(input).toHaveAttribute('type', 'password');

    await userEvent.click(screen.getByRole('button', { name: 'Mostrar senha' }));
    expect(input).toHaveAttribute('type', 'text');

    await userEvent.click(screen.getByRole('button', { name: 'Ocultar senha' }));
    expect(input).toHaveAttribute('type', 'password');
  });

  it('wires the error text to the password control', () => {
    render(<PasswordInput label="Senha" error="Senha inválida" />);
    expect(screen.getByLabelText('Senha')).toHaveAttribute(
      'aria-describedby',
      screen.getByText('Senha inválida').id,
    );
  });
});
