export type Role = 'tenant' | 'reception' | 'admin';

export function isStaff(role: Role): boolean {
  return role === 'admin' || role === 'reception';
}

export type AdminSection =
  | 'calendario'
  | 'reservas'
  | 'financeiro'
  | 'integracoes'
  | 'cupons'
  | 'servicos-extras'
  | 'clientes'
  | 'salas'
  | 'usuarios'
  | 'auditoria';

export const adminSectionMeta: Record<AdminSection, { label: string; path: string }> = {
  calendario: { label: 'Calendário', path: '/admin/calendario' },
  reservas: { label: 'Gestão de Reservas', path: '/admin/reservas' },
  financeiro: { label: 'Financeiro', path: '/admin/financeiro' },
  integracoes: { label: 'Integrações', path: '/admin/integracoes' },
  cupons: { label: 'Cupons', path: '/admin/cupons' },
  'servicos-extras': { label: 'Serviços Extras', path: '/admin/servicos-extras' },
  clientes: { label: 'Clientes', path: '/admin/clientes' },
  salas: { label: 'Salas', path: '/admin/salas' },
  usuarios: { label: 'Usuários', path: '/admin/usuarios' },
  auditoria: { label: 'Log de auditoria', path: '/admin/auditoria' },
};

const ADMIN_SECTIONS: readonly AdminSection[] = [
  'calendario',
  'reservas',
  'financeiro',
  'integracoes',
  'cupons',
  'servicos-extras',
  'clientes',
  'salas',
  'usuarios',
  'auditoria',
];

const RECEPTION_SECTIONS: readonly AdminSection[] = ['reservas', 'clientes'];

/** Admin sections a role may open, in sidebar order. Tenants have none. */
export function adminSectionsFor(role: Role): AdminSection[] {
  if (role === 'admin') return [...ADMIN_SECTIONS];
  if (role === 'reception') return [...RECEPTION_SECTIONS];
  return [];
}

export interface AppNavItem {
  label: string;
  path: string;
  /** Name of the lucide-react icon export; core stays free of UI imports. */
  icon: string;
}

/** Tenant app navigation (PRD 7.2), in tab/sidebar order. */
export const appNav: readonly AppNavItem[] = [
  { label: 'Reservar', path: '/app/reservar', icon: 'CalendarPlus' },
  { label: 'Minhas reservas', path: '/app/minhas-reservas', icon: 'CalendarCheck' },
  { label: 'Agenda', path: '/app/agenda', icon: 'CalendarDays' },
  { label: 'Compras', path: '/app/compras', icon: 'ShoppingBag' },
  { label: 'Perfil', path: '/app/perfil', icon: 'User' },
];
