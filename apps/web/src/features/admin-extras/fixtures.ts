import { parseFixture } from '../../test/fixtures/parse';
import {
  extraServiceListSchema,
  quoteRequestPageSchema,
  type QuoteRequest,
  type QuoteRequestPage,
} from './contracts';

// Extras fixtures for the web tests, validated against the response contracts (AD-035).

export const SERVICE_IDS = {
  filming: 'e1000000-0000-4000-8000-000000000001',
  videomaker: 'e1000000-0000-4000-8000-000000000002',
  marketing: 'e1000000-0000-4000-8000-000000000003',
  editing: 'e1000000-0000-4000-8000-000000000004',
} as const;

/** The three seeded services plus an inactive online one. */
export const extraServices = parseFixture(
  extraServiceListSchema,
  {
    items: [
      {
        id: SERVICE_IDS.filming,
        name: 'Pacote de filmagem',
        description: 'Câmera, iluminação e operador durante a locação.',
        referencePriceCents: 8000,
        unit: 'hour',
        saleMode: 'quote',
        status: 'active',
        displayOrder: 1,
      },
      {
        id: SERVICE_IDS.videomaker,
        name: 'Videomaker',
        description: '',
        referencePriceCents: null,
        unit: 'project',
        saleMode: 'quote',
        status: 'active',
        displayOrder: 2,
      },
      {
        id: SERVICE_IDS.marketing,
        name: 'Marketing digital',
        description: 'Gestão de redes e campanhas.',
        referencePriceCents: 150000,
        unit: 'project',
        saleMode: 'quote',
        status: 'active',
        displayOrder: 3,
      },
      {
        id: SERVICE_IDS.editing,
        name: 'Edição de vídeo',
        description: 'Edição de até 10 minutos.',
        referencePriceCents: 25000,
        unit: 'project',
        saleMode: 'online',
        status: 'inactive',
        displayOrder: 4,
      },
    ],
  },
  'extraServices',
);

export const QUOTE_IDS = {
  novoAna: 'f1000000-0000-4000-8000-000000000001',
  novoBruno: 'f1000000-0000-4000-8000-000000000002',
  contacted: 'f1000000-0000-4000-8000-000000000003',
  sent: 'f1000000-0000-4000-8000-000000000004',
  won: 'f1000000-0000-4000-8000-000000000005',
} as const;

const base = {
  phone: '47999990000',
  email: null,
  desiredOn: null,
  bookingCode: null,
  staffNotes: null,
  createdAt: '2026-10-20T13:00:00.000Z',
} as const;

/** One request per status except `lost`; two are new. */
export const quoteRequests: QuoteRequest[] = [
  {
    ...base,
    id: QUOTE_IDS.novoAna,
    status: 'new',
    serviceId: SERVICE_IDS.filming,
    serviceName: 'Pacote de filmagem',
    name: 'Ana Souza',
    email: 'ana@example.com',
    description: 'Filmagem de um curso de 3 horas no sábado.',
    desiredOn: '2026-11-14',
    bookingCode: 'BRV-7K2Q9X',
    staffNotes: 'Cliente pediu retorno pela manhã.',
  },
  {
    ...base,
    id: QUOTE_IDS.novoBruno,
    status: 'new',
    serviceId: SERVICE_IDS.marketing,
    serviceName: 'Marketing digital',
    name: 'Bruno Lima',
    description: 'Divulgação de uma clínica nova em Itajaí.',
  },
  {
    ...base,
    id: QUOTE_IDS.contacted,
    status: 'contacted',
    serviceId: SERVICE_IDS.videomaker,
    serviceName: 'Videomaker',
    name: 'Carla Dias',
    description: 'Vídeo institucional de dois minutos.',
  },
  {
    ...base,
    id: QUOTE_IDS.sent,
    status: 'quote_sent',
    serviceId: SERVICE_IDS.marketing,
    serviceName: 'Marketing digital',
    name: 'Davi Rocha',
    description: 'Pacote mensal de posts e anúncios.',
  },
  {
    ...base,
    id: QUOTE_IDS.won,
    status: 'won',
    serviceId: SERVICE_IDS.filming,
    serviceName: 'Pacote de filmagem',
    name: 'Elisa Prado',
    description: 'Gravação de podcast com dois convidados.',
  },
];

export function buildQuotePage(items: QuoteRequest[] = quoteRequests): QuoteRequestPage {
  return parseFixture(quoteRequestPageSchema, { items, nextCursor: null }, 'quoteRequests');
}
