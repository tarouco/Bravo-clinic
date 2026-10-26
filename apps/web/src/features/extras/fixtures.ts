import { parseFixture } from '../../test/fixtures/parse';
import {
  ownQuoteRequestPageSchema,
  publicExtraServiceListSchema,
  type OwnQuoteRequestPage,
} from './contracts';

// Extras fixtures for the public and tenant web tests, validated against the response
// contracts (AD-035).

export const PUBLIC_SERVICE_IDS = {
  filming: 'd1000000-0000-4000-8000-000000000001',
  videomaker: 'd1000000-0000-4000-8000-000000000002',
  marketing: 'd1000000-0000-4000-8000-000000000003',
  onlineHour: 'd1000000-0000-4000-8000-000000000004',
  onlineProject: 'd1000000-0000-4000-8000-000000000005',
} as const;

/** The three seeded quote services. */
export const publicExtraServices = parseFixture(
  publicExtraServiceListSchema,
  {
    items: [
      {
        id: PUBLIC_SERVICE_IDS.filming,
        name: 'Pacote de filmagem',
        description: 'Câmera, iluminação e operador durante a locação.',
        referencePriceCents: 8000,
        unit: 'hour',
        saleMode: 'quote',
      },
      {
        id: PUBLIC_SERVICE_IDS.videomaker,
        name: 'Videomaker',
        description: '',
        referencePriceCents: null,
        unit: 'project',
        saleMode: 'quote',
      },
      {
        id: PUBLIC_SERVICE_IDS.marketing,
        name: 'Marketing digital',
        description: 'Gestão de redes e campanhas.',
        referencePriceCents: 150000,
        unit: 'project',
        saleMode: 'quote',
      },
    ],
  },
  'publicExtraServices',
);

/** The seeded services plus one hourly and one per-project service sold online (GES-88). */
export const publicExtraServicesWithOnline = parseFixture(
  publicExtraServiceListSchema,
  {
    items: [
      ...publicExtraServices.items,
      {
        id: PUBLIC_SERVICE_IDS.onlineHour,
        name: 'Operador de câmera',
        description: 'Operador dedicado durante a locação.',
        referencePriceCents: 8000,
        unit: 'hour',
        saleMode: 'online',
      },
      {
        id: PUBLIC_SERVICE_IDS.onlineProject,
        name: 'Edição de vídeo',
        description: 'Edição de até 10 minutos.',
        referencePriceCents: 25000,
        unit: 'project',
        saleMode: 'online',
      },
    ],
  },
  'publicExtraServicesWithOnline',
);

/** Two of the signed-in tenant's requests: one new and one with a linked booking. */
export const ownQuoteRequests: OwnQuoteRequestPage = parseFixture(
  ownQuoteRequestPageSchema,
  {
    items: [
      {
        id: 'd2000000-0000-4000-8000-000000000001',
        status: 'new',
        serviceName: 'Pacote de filmagem',
        description: 'Gravação de 4 horas para um curso online.',
        desiredOn: '2026-11-20',
        bookingCode: null,
        createdAt: '2026-10-25T14:00:00.000Z',
      },
      {
        id: 'd2000000-0000-4000-8000-000000000002',
        status: 'quote_sent',
        serviceName: 'Videomaker',
        description: 'Cobertura de um dia de procedimentos.',
        desiredOn: null,
        bookingCode: 'BRV-7K2Q9X',
        createdAt: '2026-10-20T09:30:00.000Z',
      },
    ],
    nextCursor: null,
  },
  'ownQuoteRequests',
);
