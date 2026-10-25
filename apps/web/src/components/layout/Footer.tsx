import { Clock, Mail, MapPin, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useClinicConfig } from '../../features/config/useClinicConfig';
import { BrandLockup } from '../ui/Brand';
import { Icon } from '../ui/Icon';

const NAVIGATION_LINKS = [
  { to: '/salas', label: 'Salas Clínicas' },
  { to: '/#estrutura', label: 'Estrutura & Amenidades' },
  { to: '/precos', label: 'Preços & Assinaturas' },
  { to: '/servicos-extras', label: 'Serviços Extras & Apoio' },
] as const;

const GUIDELINE_LINKS = [
  { to: '/politicas', label: 'Regras de Reserva & Cancelamento' },
  { to: '/termos', label: 'Termos de Uso' },
  { to: '/privacidade', label: 'Política de Privacidade (LGPD)' },
  { to: '/login', label: 'Área do Profissional Locatário' },
  { to: '/contato', label: 'Ouvidoria & Atendimento' },
] as const;

const linkClasses = 'text-ink-muted hover:text-bronze transition-colors';
const headingClasses =
  'font-eyebrow text-eyebrow uppercase tracking-[0.2em] text-ink font-semibold';

function LinkColumn({
  title,
  links,
}: {
  title: string;
  links: ReadonlyArray<{ to: string; label: string }>;
}) {
  return (
    <div className="space-y-space-md">
      <h3 className={headingClasses}>{title}</h3>
      <ul className="space-y-space-sm font-small text-small">
        {links.map((link) => (
          <li key={link.to} className="list-none">
            <Link to={link.to} className={linkClasses}>
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Footer() {
  const { contactEmail } = useClinicConfig();

  return (
    <footer className="w-full bg-surface-container-high border-t border-hairline/60 pt-space-3xl pb-space-2xl text-on-surface-variant">
      <div className="max-w-7xl mx-auto px-gutter">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-space-2xl pb-space-2xl border-b border-hairline/40">
          <div className="lg:col-span-2 space-y-space-md">
            <BrandLockup variant="footer" />
            <p className="font-body text-body text-ink-muted max-w-sm pt-space-xs">
              Infraestrutura médica e estética de alto padrão sob demanda. O equilíbrio perfeito
              entre arquitetura limpa, conforto sensorial e tecnologia clínica para profissionais
              exigentes.
            </p>
            <div className="pt-space-sm flex items-center gap-space-sm text-ink-muted">
              <Icon as={ShieldCheck} size={14} className="text-bronze" />
              <span className="font-caption text-caption text-ink-muted uppercase tracking-[0.08em]">
                Conformidade e Biossegurança RDC Anvisa • LGPD Compliant
              </span>
            </div>
          </div>

          <LinkColumn title="Navegação" links={NAVIGATION_LINKS} />
          <LinkColumn title="Diretrizes" links={GUIDELINE_LINKS} />

          <div className="space-y-space-md">
            <h3 className={headingClasses}>Atendimento</h3>
            <p className="font-small text-small text-ink-muted flex items-start gap-space-xs">
              <Icon as={Clock} size={16} className="text-bronze mt-0.5" />
              <span>
                Horário de funcionamento:
                <br />
                <strong className="text-ink font-medium">
                  Seg a sex 07:00–00:00 · Sáb, dom e feriados 09:00–00:00
                </strong>
              </span>
            </p>
            {contactEmail ? (
              <p className="font-small text-small text-ink-muted flex items-start gap-space-xs">
                <Icon as={Mail} size={16} className="text-bronze mt-0.5" />
                <span>{contactEmail}</span>
              </p>
            ) : null}
            <p className="font-small text-small text-ink-muted flex items-start gap-space-xs">
              <Icon as={MapPin} size={16} className="text-bronze mt-0.5" />
              <span>Praia Brava, Itajaí – SC</span>
            </p>
          </div>
        </div>

        <div className="pt-space-xl flex flex-col sm:flex-row items-center justify-between gap-space-md font-caption text-caption text-ink-muted">
          <p>
            © 2026 Bravô Clinic • Salas Inteligentes. Todos os direitos reservados. Saúde • Beleza •
            Bem-estar.
          </p>
          <div className="flex items-center gap-space-md">
            <span className="inline-flex items-center gap-1.5 px-space-sm py-0.5 rounded bg-surface-raised text-on-surface-variant font-caption text-caption border border-hairline/40">
              <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-bronze" />
              Privacidade Assegurada (LGPD)
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
