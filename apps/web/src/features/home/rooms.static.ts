import { Leaf, Video, type LucideIcon } from 'lucide-react';
import type { RoomSlug } from './room-slug';

export interface StaticRoom {
  slug: RoomSlug;
  name: string;
  /** Cover photo; omitted until the clinic supplies photos (RoomCard falls back to the placeholder). */
  imageUrl?: string;
  imageAlt: string;
  featureChip: { label: string; icon: LucideIcon };
  tags: string[];
  description: string;
  equipment: string[];
  /** Lowest hourly rate in integer cents (unified tariff: same in every room). */
  fromPriceCents: number;
}

/** Home copy for the three rooms, taken from the reference. Replaced by API data in `nucleo`. */
export const staticRooms: readonly StaticRoom[] = [
  {
    slug: 'principal',
    name: 'Sala Principal',
    imageAlt:
      'Sala clínica e estética de alto padrão com maca motorizada, foco cirúrgico, painéis de nogueira e estrutura para gravação de vídeo',
    featureChip: { label: 'Filmagem & Estúdio', icon: Video },
    tags: ['Médico', 'Estética Avançada', 'Criadores de Conteúdo'],
    description:
      'Espaço flagship equipado com maca de procedimentos dermatológicos/estéticos totalmente motorizada, foco cirúrgico estético de temperatura ajustável e iluminação de cinema para gravação de aulas e mídias.',
    equipment: [
      'Maca motorizada de 4 motores com controle',
      'Mesa executiva em pedra e poltronas para consulta',
      'Pontos de luz difusa e suporte para smartphones e câmeras',
      'Pia de assepsia cirúrgica integrada na marcenaria',
    ],
    fromPriceCents: 8000,
  },
  {
    slug: 'secundaria',
    name: 'Sala Secundária',
    imageAlt:
      'Consultório médico boutique com ripado acústico em madeira clara, poltrona de couro para o paciente e luz âmbar difusa',
    featureChip: { label: 'Filmagem & Estúdio', icon: Video },
    tags: ['Médico Geral', 'Nutrição & Estética', 'Telemedicina'],
    description:
      'Ambiente cirúrgico/clínico intimista, desenhado para consultas diagnósticas, procedimentos injetáveis, pequenos tratamentos estéticos e criação de conteúdos verticais para redes sociais.',
    equipment: [
      'Maca reclinável hidráulica ultra-conforto',
      'Bancada e armários para insumos e descartáveis',
      'Isolamento acústico com painéis de madeira ripada',
      'Foco de luz articulado com temperatura neutra',
    ],
    fromPriceCents: 8000,
  },
  {
    slug: 'terceira',
    name: 'Sala Terceira',
    imageAlt:
      'Sala de terapias e relaxamento com luz indireta quente, maca de massagem em madeira, linho natural e difusor de aromas',
    featureChip: { label: 'Terapia & Relaxamento', icon: Leaf },
    tags: ['Massoterapia', 'Fisioterapia', 'Terapias Integrativas'],
    description:
      'Dedicada ao alívio e bem-estar corporal. Configuração com iluminação dimerizável quente, difusor ultrassônico com sinergias olfativas e isolamento de som para imersão total do cliente.',
    equipment: [
      'Maca de massagem ergonômica com aquecimento opcional',
      'Sistema de som surround com conectividade Bluetooth',
      'Luz indireta regulável (zero ofuscamento ocular)',
      'Toalheiro térmico e higienização hospitalar prévia',
    ],
    fromPriceCents: 8000,
  },
];
