import { ArrowRight, Play } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { buttonClasses } from '../../components/ui/Button';
import { cx, focusRing } from '../../components/ui/cx';
import { Icon } from '../../components/ui/Icon';
import { iconButtonClasses } from '../../components/ui/IconButton';
import { Modal } from '../../components/ui/Modal';
import { usePageTitle } from '../../lib/usePageTitle';

export interface StructureVideo {
  id: string;
  title: string;
  duration: string;
  src: string;
  poster: string;
}

export const STRUCTURE_VIDEOS: readonly StructureVideo[] = [
  {
    id: 'institucional',
    title: 'Conheça a Bravô Clinic',
    duration: '0:29',
    src: '/videos/institucional.mp4',
    poster: '/videos/institucional-poster.webp',
  },
  {
    id: 'atendimento',
    title: 'Um atendimento na clínica',
    duration: '0:17',
    src: '/videos/reels-atendimento.mp4',
    poster: '/videos/reels-poster.webp',
  },
];

interface GalleryPhoto {
  src: string;
  alt: string;
  caption: string;
}

const GALLERY: { title: string; photos: GalleryPhoto[] }[] = [
  {
    title: 'Salas',
    photos: [
      {
        src: '/images/sala-principal.webp',
        alt: 'Sala Principal com maca motorizada, mesa de mármore orgânica e poltronas em bouclé',
        caption: 'Sala Principal',
      },
      {
        src: '/images/mesa-jardim.webp',
        alt: 'Mesa de mármore da Sala Principal diante do papel de parede botânico com pássaros e limões',
        caption: 'Sala Principal · mesa de consulta',
      },
      {
        src: '/images/sala-secundaria.webp',
        alt: 'Sala Secundária com ripado claro, cadeira em couro caramelo e mesa de mármore',
        caption: 'Sala Secundária',
      },
      {
        src: '/images/sala-terceira.webp',
        alt: 'Sala Terceira com maca, nicho orgânico em madeira iluminado e forro ripado com luz linear',
        caption: 'Sala Terceira',
      },
      {
        src: '/images/consultorio.webp',
        alt: 'Detalhe da mesa de mármore e das cadeiras em bouclé',
        caption: 'Mármore e bouclé',
      },
    ],
  },
  {
    title: 'Recepção e convivência',
    photos: [
      {
        src: '/images/recepcao-lounge.webp',
        alt: 'Lounge da recepção com sofá curvo, quadros em tons de areia e ripado curvo iluminado',
        caption: 'Lounge da recepção',
      },
      {
        src: '/images/copa.webp',
        alt: 'Copa com bancada curva e bancos altos, com vista para a recepção',
        caption: 'Copa e café',
      },
      {
        src: '/images/lavabo.webp',
        alt: 'Lavabo em verde-oliva com painéis de madeira, cuba escultural e metais dourados',
        caption: 'Lavabo',
      },
    ],
  },
];

/** Poster card that opens the video; the click that opens it also starts playback. */
function VideoCard({ video, onOpen }: { video: StructureVideo; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cx(
        'group relative block aspect-[9/16] w-full overflow-hidden rounded-lg bg-emerald-deep text-left shadow-lift-2',
        focusRing,
      )}
    >
      <img
        className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]"
        src={video.poster}
        alt=""
        loading="lazy"
      />
      <span className="absolute inset-0 bg-gradient-to-t from-emerald-deep/90 via-emerald-deep/10 to-transparent" />
      <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-space-sm p-space-md text-on-emerald">
        <span>
          <span className="block font-body text-body font-medium leading-snug">{video.title}</span>
          <span className="font-caption text-caption text-on-emerald/80">{video.duration}</span>
        </span>
        <span className={cx(iconButtonClasses({ tone: 'emerald' }), 'shrink-0')}>
          <Icon as={Play} size={20} />
          <span className="sr-only">Assistir</span>
        </span>
      </span>
    </button>
  );
}

/** `/estrutura`: the clinic's photo gallery plus the institutional and reels videos. */
export function StructurePage() {
  usePageTitle('Estrutura');
  const [playing, setPlaying] = useState<StructureVideo | null>(null);

  return (
    <div className="mx-auto max-w-7xl space-y-space-3xl px-gutter py-space-3xl">
      <div className="grid items-end gap-space-xl md:grid-cols-[1fr_auto]">
        <div className="max-w-xl space-y-space-sm">
          <h1 className="font-display text-display-l-mobile text-ink [text-wrap:balance] md:text-display-l">
            A estrutura da Bravô Clinic.
          </h1>
          <p className="font-lead text-lead text-ink-muted">
            Três salas, recepção e copa na Praia Brava, em Itajaí.
          </p>
        </div>
        <ul className="grid grid-cols-2 gap-space-md md:w-[420px]">
          {STRUCTURE_VIDEOS.map((video) => (
            <li key={video.id}>
              <VideoCard
                video={video}
                onOpen={() => {
                  setPlaying(video);
                }}
              />
            </li>
          ))}
        </ul>
      </div>

      {GALLERY.map((group) => (
        <section key={group.title} className="space-y-space-lg">
          <h2 className="font-heading text-heading-mobile text-ink md:text-heading">
            {group.title}
          </h2>
          <ul className="columns-1 gap-space-md sm:columns-2 lg:columns-3">
            {group.photos.map((photo) => (
              <li key={photo.src} className="mb-space-md break-inside-avoid">
                <figure>
                  <img
                    className="w-full rounded-lg object-cover shadow-lift-2"
                    src={photo.src}
                    alt={photo.alt}
                    loading="lazy"
                  />
                  <figcaption className="mt-space-xs font-caption text-caption text-ink-muted">
                    {photo.caption}
                  </figcaption>
                </figure>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <div className="flex flex-wrap items-center gap-space-lg border-t border-hairline pt-space-xl">
        <Link to="/salas" className={buttonClasses({ variant: 'primary' })}>
          <span>Ver as salas</span>
          <Icon as={ArrowRight} size={18} />
        </Link>
        <Link to="/#simulador" className={buttonClasses({ variant: 'link' })}>
          Simular o valor da reserva
        </Link>
      </div>

      <Modal
        open={playing !== null}
        onClose={() => {
          setPlaying(null);
        }}
        title={playing?.title ?? ''}
      >
        {playing ? (
          <video
            className="mx-auto max-h-[70vh] w-auto rounded-md bg-emerald-deep"
            src={playing.src}
            poster={playing.poster}
            controls
            autoPlay
            loop
            playsInline
          >
            Seu navegador não reproduz este vídeo.
          </video>
        ) : null}
      </Modal>
    </div>
  );
}
