import { formatDocument, parseDocument, updateMeSchema, type Me } from '@bravo/core';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { cx, focusRing } from '../../components/ui/cx';
import { Icon } from '../../components/ui/Icon';
import { Alert, Spinner } from '../../components/ui/Feedback';
import { DocumentInput, Input, PhoneInput } from '../../components/ui/form';
import { maskPhone } from '../../components/ui/form/masked';
import { safeNextPath } from '../../features/auth/hooks';
import { useProfile, useUpdateMe } from '../../features/profile/api';
import { ApiError } from '../../lib/api';
import { usePageTitle } from '../../lib/usePageTitle';

interface FormValues {
  name: string;
  phone: string;
  profession: string;
  professionalRegistry: string;
  document: string;
}

const DOCUMENT_TAKEN_MESSAGE = 'Este CPF/CNPJ já está cadastrado.';

const toFormValues = (me: Me): FormValues => ({
  name: me.name,
  phone: me.phone ? maskPhone(me.phone.replace(/^\+55/, '')) : '',
  profession: me.profession ?? '',
  professionalRegistry: me.professionalRegistry ?? '',
  document: '',
});

function ProfileForm({ me }: { me: Me }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const complete = searchParams.get('completar') === '1';
  const next = safeNextPath(searchParams.get('next'));
  const update = useUpdateMe();
  const [saved, setSaved] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const hasDocument = me.document !== null;
  const highlight = complete && !hasDocument;

  const {
    register,
    handleSubmit,
    setError,
    setFocus,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues: toFormValues(me) });

  const focused = useRef(false);
  useEffect(() => {
    if (highlight && !focused.current) {
      focused.current = true;
      setFocus('document');
    }
  }, [highlight, setFocus]);

  const onSubmit = handleSubmit(async (values) => {
    setSaved(false);
    setFormError(null);
    const payload = {
      name: values.name,
      phone: values.phone,
      profession: values.profession,
      professionalRegistry: values.professionalRegistry,
      // The document is set once; when it is already on file it is never sent again.
      ...(!hasDocument && values.document.trim() !== '' ? { document: values.document } : {}),
    };
    const parsed = updateMeSchema.safeParse(payload);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (typeof field === 'string' && field in values) {
          setError(field as keyof FormValues, { message: issue.message });
        }
      }
      return;
    }
    try {
      await update.mutateAsync(parsed.data);
      if (next) {
        void navigate(next, { replace: true });
        return;
      }
      setSaved(true);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'DOCUMENT_TAKEN') {
        setError('document', { message: DOCUMENT_TAKEN_MESSAGE });
      } else {
        setFormError(
          error instanceof ApiError
            ? error.message
            : 'Não foi possível salvar o perfil. Tente novamente.',
        );
      }
    }
  });

  const documentDisplay = me.document
    ? (() => {
        const parsedDocument = parseDocument(me.document);
        return parsedDocument ? formatDocument(parsedDocument) : me.document;
      })()
    : '';

  return (
    <form
      onSubmit={(event) => void onSubmit(event)}
      noValidate
      className="mx-auto max-w-xl space-y-space-md"
    >
      {complete && !hasDocument ? (
        <Alert tone="info">Complete seu cadastro com CPF ou CNPJ para reservar.</Alert>
      ) : null}
      {saved ? <Alert tone="success">Perfil atualizado.</Alert> : null}
      {formError ? <Alert tone="error">{formError}</Alert> : null}

      <Card>
        <div className="space-y-space-md">
          <Input label="E-mail" value={me.email} readOnly disabled />
          <Input
            label="Nome completo"
            autoComplete="name"
            error={errors.name?.message}
            {...register('name')}
          />
          <PhoneInput label="Telefone" error={errors.phone?.message} {...register('phone')} />
          <Input label="Profissão" error={errors.profession?.message} {...register('profession')} />
          <Input
            label="Registro profissional"
            help="Opcional. Ex.: CRM, CRO, CRP."
            error={errors.professionalRegistry?.message}
            {...register('professionalRegistry')}
          />
          {hasDocument ? (
            <Input
              label="CPF ou CNPJ"
              value={documentDisplay}
              readOnly
              help="O documento não pode ser alterado. Fale com a recepção se precisar corrigir."
            />
          ) : (
            <DocumentInput
              label="CPF ou CNPJ"
              error={errors.document?.message}
              help="Necessário para reservar. Não poderá ser alterado depois."
              className={highlight ? 'border-accent ring-2 ring-accent' : undefined}
              {...register('document')}
            />
          )}
        </div>
      </Card>

      <Button type="submit" block loading={update.isPending}>
        Salvar
      </Button>

      <nav aria-label="Configurações da conta" className="space-y-space-sm pt-space-md">
        {SETTINGS_LINKS.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className={cx(
              'flex items-center justify-between gap-space-md rounded-md bg-surface-raised px-space-lg py-space-md font-body text-body text-ink shadow-card transition-transform duration-200 hover:-translate-y-0.5',
              focusRing,
            )}
          >
            {item.label}
            <Icon as={ChevronRight} size={18} className="text-ink-muted" />
          </Link>
        ))}
      </nav>
    </form>
  );
}

const SETTINGS_LINKS = [
  { to: '/app/perfil/cartoes', label: 'Meus cartões' },
  { to: '/app/perfil/notificacoes', label: 'Notificações' },
  { to: '/app/perfil/seguranca', label: 'Segurança' },
  { to: '/app/perfil/privacidade', label: 'Privacidade e dados' },
] as const;

/** `/app/perfil`: edit the profile; `?completar=1` highlights the document and `next` returns. */
export function ProfilePage() {
  usePageTitle('Perfil');
  const profile = useProfile();

  return (
    <div className="space-y-space-lg">
      <h1 className="mx-auto max-w-xl font-display-l-mobile text-display-l-mobile text-ink lg:font-display-l lg:text-display-l">
        Perfil
      </h1>
      {profile.isPending ? (
        <div className="flex justify-center">
          <Spinner label="Carregando perfil" />
        </div>
      ) : profile.isError ? (
        <Alert tone="error" className="mx-auto max-w-xl">
          Não foi possível carregar seu perfil agora.
        </Alert>
      ) : (
        <ProfileForm me={profile.data} />
      )}
    </div>
  );
}
