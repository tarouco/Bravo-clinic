import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FileUpload, formatMaxBytes } from './FileUpload';

const FIVE_MIB = 5 * 1024 * 1024;
const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp';

function fileOf(name: string, type: string, size: number): File {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

function setup(props: Partial<React.ComponentProps<typeof FileUpload>> = {}) {
  const onFile = vi.fn();
  render(
    <FileUpload label="Anexo" accept={ACCEPT} maxBytes={FIVE_MIB} onFile={onFile} {...props} />,
  );
  return { onFile, input: screen.getByLabelText<HTMLInputElement>('Anexo') };
}

describe('FileUpload', () => {
  it('hands an accepted file to onFile', async () => {
    const { onFile, input } = setup();
    const file = fileOf('nota.pdf', 'application/pdf', 1024);

    await userEvent.upload(input, file);

    expect(onFile).toHaveBeenCalledTimes(1);
    expect(onFile).toHaveBeenCalledWith(file);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('refuses a file over maxBytes with "Arquivo maior que 5 MB" before calling onFile', async () => {
    const { onFile, input } = setup();

    await userEvent.upload(input, fileOf('grande.pdf', 'application/pdf', FIVE_MIB + 1));

    expect(await screen.findByRole('alert')).toHaveTextContent('Arquivo maior que 5 MB');
    expect(onFile).not.toHaveBeenCalled();
  });

  it('accepts a file of exactly maxBytes', async () => {
    const { onFile, input } = setup();

    await userEvent.upload(input, fileOf('limite.png', 'image/png', FIVE_MIB));

    expect(onFile).toHaveBeenCalledTimes(1);
  });

  it('refuses a type outside accept with "Formato não suportado"', async () => {
    const { onFile, input } = setup({ accept: ACCEPT });

    // user-event honours `accept`, so fire the change directly as a drag-and-drop would.
    const file = fileOf('programa.exe', 'application/x-msdownload', 100);
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Formato não suportado');
    expect(onFile).not.toHaveBeenCalled();
  });

  it('clears a previous refusal after a valid pick', async () => {
    const { onFile, input } = setup();
    await userEvent.upload(input, fileOf('grande.pdf', 'application/pdf', FIVE_MIB + 1));
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    await userEvent.upload(input, fileOf('ok.pdf', 'application/pdf', 10));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(onFile).toHaveBeenCalledTimes(1);
  });

  it('shows an error from the caller and a busy state while uploading', () => {
    const { input } = setup({ busy: true, error: 'Formato não suportado' });

    expect(screen.getByRole('alert')).toHaveTextContent('Formato não suportado');
    expect(screen.getByRole('status')).toHaveTextContent('Enviando');
    expect(input).toBeDisabled();
  });

  it('shows a progress bar when progress is given', () => {
    setup({ progress: 0.4 });

    expect(screen.getByRole('progressbar', { name: 'Progresso do envio de Anexo' })).toHaveValue(
      0.4,
    );
  });
});

describe('formatMaxBytes', () => {
  it('writes binary megabytes in pt-BR', () => {
    expect(formatMaxBytes(FIVE_MIB)).toBe('5 MB');
    expect(formatMaxBytes(1.5 * 1024 * 1024)).toBe('1,5 MB');
  });
});
