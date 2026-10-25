import { describe, expect, it } from 'vitest';
import { adminSectionMeta, adminSectionsFor, appNav, isStaff } from './access';

describe('adminSectionsFor (FND-74)', () => {
  it('lists the ten admin sections in order', () => {
    expect(adminSectionsFor('admin')).toEqual([
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
    ]);
  });

  it('gives reception only reservas and clientes', () => {
    expect(adminSectionsFor('reception')).toEqual(['reservas', 'clientes']);
  });

  it('gives tenants no admin section', () => {
    expect(adminSectionsFor('tenant')).toEqual([]);
  });

  it('returns a fresh array each call', () => {
    adminSectionsFor('admin').pop();
    expect(adminSectionsFor('admin')).toHaveLength(10);
  });
});

describe('adminSectionMeta (FND-117)', () => {
  it('has the pt-BR labels in sidebar order', () => {
    const labels = adminSectionsFor('admin').map((s) => adminSectionMeta[s].label);
    expect(labels).toEqual([
      'Calendário',
      'Gestão de Reservas',
      'Financeiro',
      'Integrações',
      'Cupons',
      'Serviços Extras',
      'Clientes',
      'Salas',
      'Usuários',
      'Log de auditoria',
    ]);
  });

  it('maps every section to /admin/<key>', () => {
    for (const section of adminSectionsFor('admin')) {
      expect(adminSectionMeta[section].path).toBe(`/admin/${section}`);
    }
  });
});

describe('appNav (FND-118)', () => {
  it('lists Reservar, Minhas reservas, Agenda, Compras, Perfil in order', () => {
    expect(appNav.map((i) => i.label)).toEqual([
      'Reservar',
      'Minhas reservas',
      'Agenda',
      'Compras',
      'Perfil',
    ]);
  });

  it('links each item to its /app path', () => {
    expect(appNav.map((i) => i.path)).toEqual([
      '/app/reservar',
      '/app/minhas-reservas',
      '/app/agenda',
      '/app/compras',
      '/app/perfil',
    ]);
  });
});

describe('isStaff', () => {
  it('is true for admin and reception, false for tenant', () => {
    expect(isStaff('admin')).toBe(true);
    expect(isStaff('reception')).toBe(true);
    expect(isStaff('tenant')).toBe(false);
  });
});
