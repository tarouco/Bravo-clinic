import { expenseCategoryInputSchema } from '@bravo/core';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Drawer } from '../../components/ui/Drawer';
import { Alert, Spinner } from '../../components/ui/Feedback';
import { Input } from '../../components/ui/form';
import { messageOf } from '../../lib/api-errors';
import { useCreateExpenseCategory, useExpenseCategories, useUpdateExpenseCategory } from './api';
import type { ExpenseCategory } from './contracts';

const nameSchema = expenseCategoryInputSchema.pick({ name: true });

function firstMessage(name: string): string | null {
  const parsed = nameSchema.safeParse({ name });
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? 'Nome inválido');
}

function CategoryRow({
  category,
  position,
  neighbours,
  onError,
}: {
  category: ExpenseCategory;
  position: number;
  neighbours: { previous: ExpenseCategory | null; next: ExpenseCategory | null };
  onError: (message: string | null) => void;
}) {
  const update = useUpdateExpenseCategory();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const [nameError, setNameError] = useState<string | null>(null);

  const patch = (body: { name?: string; active?: boolean }, after?: () => void) => {
    onError(null);
    update.mutate(
      { id: category.id, body },
      {
        onSuccess: after ?? (() => undefined),
        onError: (error) => {
          if (editing) setNameError(messageOf(error, 'Não foi possível salvar a categoria.'));
          else onError(messageOf(error, 'Não foi possível salvar a categoria.'));
        },
      },
    );
  };

  // Moving swaps the display order with the neighbour (two PATCH calls).
  const move = async (other: ExpenseCategory | null) => {
    if (!other) return;
    onError(null);
    try {
      await update.mutateAsync({ id: category.id, body: { displayOrder: other.displayOrder } });
      await update.mutateAsync({ id: other.id, body: { displayOrder: category.displayOrder } });
    } catch (error) {
      onError(messageOf(error, 'Não foi possível reordenar as categorias.'));
    }
  };

  const saveName = () => {
    const message = firstMessage(name);
    if (message) {
      setNameError(message);
      return;
    }
    setNameError(null);
    patch({ name: name.trim() }, () => {
      setEditing(false);
    });
  };

  return (
    <li className="space-y-space-xs border-b border-hairline/60 py-space-sm last:border-b-0">
      {editing ? (
        <div className="space-y-space-xs">
          <Input
            label={`Novo nome de ${category.name}`}
            value={name}
            error={nameError ?? undefined}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
          <div className="flex gap-space-sm">
            <Button size="sm" loading={update.isPending} onClick={saveName}>
              Salvar nome
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setEditing(false);
                setName(category.name);
                setNameError(null);
              }}
            >
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-space-sm">
          <span className="flex items-center gap-space-sm font-small text-small text-ink">
            <span className="text-ink-muted">{position}.</span>
            {category.name}
            {category.active ? null : <Badge tone="neutral">Inativa</Badge>}
          </span>
          <span className="flex flex-wrap items-center gap-space-xs">
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Subir ${category.name}`}
              disabled={!neighbours.previous || update.isPending}
              leadingIcon={ArrowUp}
              onClick={() => {
                void move(neighbours.previous);
              }}
            />
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Descer ${category.name}`}
              disabled={!neighbours.next || update.isPending}
              leadingIcon={ArrowDown}
              onClick={() => {
                void move(neighbours.next);
              }}
            />
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Renomear ${category.name}`}
              onClick={() => {
                setEditing(true);
              }}
            >
              Renomear
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`${category.active ? 'Desativar' : 'Ativar'} ${category.name}`}
              disabled={update.isPending}
              onClick={() => {
                patch({ active: !category.active });
              }}
            >
              {category.active ? 'Desativar' : 'Ativar'}
            </Button>
          </span>
        </div>
      )}
    </li>
  );
}

function NewCategoryForm({ onError }: { onError: (message: string | null) => void }) {
  const create = useCreateExpenseCategory();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    onError(null);
    const message = firstMessage(name);
    if (message) {
      setError(message);
      return;
    }
    setError(null);
    create.mutate(
      { name: name.trim() },
      {
        onSuccess: () => {
          setName('');
        },
        onError: (failure) => {
          setError(messageOf(failure, 'Não foi possível criar a categoria.'));
        },
      },
    );
  };

  return (
    <form
      noValidate
      className="space-y-space-xs"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Input
        label="Nova categoria"
        value={name}
        error={error ?? undefined}
        onChange={(event) => {
          setName(event.target.value);
        }}
      />
      <Button type="submit" size="sm" loading={create.isPending}>
        Adicionar categoria
      </Button>
    </form>
  );
}

export interface CategoriesDrawerProps {
  open: boolean;
  onClose: () => void;
}

/** Expense category management: add, rename, reorder and (de)activate (GES-19). */
export function CategoriesDrawer({ open, onClose }: CategoriesDrawerProps) {
  const categories = useExpenseCategories();
  const [error, setError] = useState<string | null>(null);
  const sorted = [...(categories.data?.items ?? [])].sort(
    (a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name, 'pt-BR'),
  );

  return (
    <Drawer open={open} onClose={onClose} title="Categorias de despesa">
      <div className="space-y-space-md">
        <p className="font-small text-small text-ink-muted">
          Desativar uma categoria a tira da lista de novas despesas; os lançamentos antigos
          continuam nos relatórios.
        </p>
        {categories.isPending ? <Spinner label="Carregando as categorias" /> : null}
        {categories.isError ? (
          <Alert tone="error">
            {messageOf(categories.error, 'Não foi possível carregar as categorias.')}
          </Alert>
        ) : null}
        {error ? <Alert tone="error">{error}</Alert> : null}
        {categories.data ? (
          <ul aria-label="Categorias de despesa">
            {sorted.map((category, index) => (
              <CategoryRow
                key={category.id}
                category={category}
                position={index + 1}
                neighbours={{
                  previous: sorted[index - 1] ?? null,
                  next: sorted[index + 1] ?? null,
                }}
                onError={setError}
              />
            ))}
          </ul>
        ) : null}
        <NewCategoryForm onError={setError} />
      </div>
    </Drawer>
  );
}
