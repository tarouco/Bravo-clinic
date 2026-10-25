import { pathToFileURL } from 'node:url';
import {
  emailSchema,
  holidaySeed,
  passwordSchema,
  settingDefaults,
  settingKeys,
} from '@bravo/core';
import { eq } from 'drizzle-orm';
import { hashPassword } from '../lib/crypto';
import { createDb, withTransaction, type Db } from './client';
import { auditLog, businessHours, holidays, rooms, settings, users } from './schema';

export interface AdminBootstrap {
  email: string;
  password: string;
  name: string;
}

export interface SeedReport {
  settingsInserted: number;
  roomsInserted: number;
  holidaysInserted: number;
  businessHoursInserted: number;
  adminCreated: boolean;
}

const BUSINESS_HOURS = [
  ...(['mon', 'tue', 'wed', 'thu', 'fri'] as const).map((dayType) => ({
    dayType,
    openMinute: 420,
    closeMinute: 1440,
  })),
  ...(['sat', 'sun', 'holiday'] as const).map((dayType) => ({
    dayType,
    openMinute: 540,
    closeMinute: 1440,
  })),
];

const ROOMS = [
  {
    slug: 'principal',
    name: 'Sala Principal',
    description:
      'Espaço flagship equipado com maca de procedimentos dermatológicos/estéticos totalmente motorizada, foco cirúrgico estético de temperatura ajustável e iluminação de cinema para gravação de aulas e mídias.',
    idealFor: ['Médico', 'Estética', 'Gravação de vídeos'],
    equipment: [
      'Maca motorizada de 4 motores com controle',
      'Mesa executiva em pedra e poltronas para consulta',
      'Pontos de luz difusa e suporte para smartphones e câmeras',
      'Pia de assepsia cirúrgica integrada na marcenaria',
    ],
  },
  {
    slug: 'secundaria',
    name: 'Sala Secundária',
    description:
      'Ambiente cirúrgico/clínico intimista, desenhado para consultas diagnósticas, procedimentos injetáveis, pequenos tratamentos estéticos e criação de conteúdos verticais para redes sociais.',
    idealFor: ['Médico', 'Estética', 'Gravação de vídeos'],
    equipment: [
      'Maca reclinável hidráulica ultra-conforto',
      'Bancada e armários para insumos e descartáveis',
      'Isolamento acústico com painéis de madeira ripada',
      'Foco de luz articulado com temperatura neutra',
    ],
  },
  {
    slug: 'terceira',
    name: 'Sala Terceira',
    description:
      'Dedicada ao alívio e bem-estar corporal. Configuração com iluminação dimerizável quente, difusor ultrassônico com sinergias olfativas e isolamento de som para imersão total do cliente.',
    idealFor: ['Massagem', 'Terapia', 'Estética'],
    equipment: [
      'Maca de massagem ergonômica com aquecimento opcional',
      'Sistema de som surround com conectividade Bluetooth',
      'Luz indireta regulável (zero ofuscamento ocular)',
      'Toalheiro térmico e higienização hospitalar prévia',
    ],
  },
].map((room, index) => ({ ...room, status: 'active', displayOrder: index + 1 }));

/** Prepares the first admin: null when none is needed, throws before any write when the password is weak. */
async function prepareAdmin(db: Db, bootstrap: AdminBootstrap | undefined) {
  if (bootstrap === undefined) return null;
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, 'admin'))
    .limit(1);
  if (existing.length > 0) return null;
  if (!passwordSchema.safeParse(bootstrap.password).success) {
    throw new Error('ADMIN_BOOTSTRAP_PASSWORD does not meet the password policy');
  }
  return {
    name: bootstrap.name,
    email: emailSchema.parse(bootstrap.email),
    passwordHash: await hashPassword(bootstrap.password),
  };
}

/** Loads defaults. Every insert is ON CONFLICT DO NOTHING: reruns never duplicate or overwrite. */
export async function runSeed(
  db: Db,
  opts: { adminBootstrap?: AdminBootstrap } = {},
): Promise<SeedReport> {
  const admin = await prepareAdmin(db, opts.adminBootstrap);

  return withTransaction(db, async (tx) => {
    const defaults: Record<string, unknown> = settingDefaults();
    const insertedSettings = await tx
      .insert(settings)
      .values(settingKeys.map((key) => ({ key, value: defaults[key] })))
      .onConflictDoNothing()
      .returning({ key: settings.key });
    const insertedHours = await tx
      .insert(businessHours)
      .values(BUSINESS_HOURS)
      .onConflictDoNothing()
      .returning({ dayType: businessHours.dayType });
    const insertedRooms = await tx
      .insert(rooms)
      .values(ROOMS)
      .onConflictDoNothing()
      .returning({ id: rooms.id });
    const insertedHolidays = await tx
      .insert(holidays)
      .values(
        holidaySeed.map((holiday) => ({
          date: holiday.date,
          name: holiday.name,
          scope: holiday.scope,
          source: 'seed',
          isClosed: false,
          needsReview: holiday.needsReview,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: holidays.id });

    let adminCreated = false;
    if (admin !== null) {
      const [created] = await tx
        .insert(users)
        .values({ ...admin, role: 'admin', emailVerifiedAt: new Date() })
        .onConflictDoNothing()
        .returning({ id: users.id });
      if (created !== undefined) {
        adminCreated = true;
        await tx.insert(auditLog).values({
          origin: 'system',
          action: 'user.bootstrap_admin',
          entityType: 'user',
          entityId: created.id,
          after: { email: admin.email, role: 'admin' },
        });
      }
    }

    return {
      settingsInserted: insertedSettings.length,
      roomsInserted: insertedRooms.length,
      holidaysInserted: insertedHolidays.length,
      businessHoursInserted: insertedHours.length,
      adminCreated,
    };
  });
}

// CLI: `npm run db:seed -w apps/api`. The target and ADMIN_BOOTSTRAP_* come from the shell only.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (url === undefined || url === '') {
    process.stderr.write('DATABASE_URL_UNPOOLED or DATABASE_URL is required\n');
    process.exit(1);
  }
  const email = process.env.ADMIN_BOOTSTRAP_EMAIL;
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  const adminBootstrap =
    email && password ? { email, password, name: 'Administrador geral' } : undefined;
  const { pool, db } = createDb(url);
  try {
    const report = await runSeed(db, adminBootstrap ? { adminBootstrap } : {});
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } finally {
    await pool.end();
  }
}
