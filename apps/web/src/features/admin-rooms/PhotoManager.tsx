import { roomPhotoInputSchema, toPhotoUrl } from '@bravo/core';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Alert } from '../../components/ui/Feedback';
import { FileUpload } from '../../components/ui/FileUpload';
import { Input } from '../../components/ui/form';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';
import { messageOf } from '../../lib/api-errors';
import {
  useAddRoomPhoto,
  useDeleteRoomPhoto,
  useReorderRoomPhotos,
  useUpdateRoomPhoto,
} from './api';
import type { RoomPhoto } from './contracts';
import { prepareRoomPhoto, type PreparedPhoto } from './prepare-photo';

/** A room holds at most 12 photos (GES-106). */
export const MAX_PHOTOS = 12;
/** The original may be a phone photo; the API limit (5 MiB) applies to the resized variants. */
const MAX_ORIGINAL_BYTES = 25 * 1024 * 1024;
const PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp';

const altSchema = roomPhotoInputSchema.shape.alt;
const altMessage = (alt: string): string | null => {
  const parsed = altSchema.safeParse(alt);
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? 'Descrição inválida');
};

interface PhotoItemProps {
  roomId: string;
  photo: RoomPhoto;
  index: number;
  photos: readonly RoomPhoto[];
}

function PhotoItem({ roomId, photo, index, photos }: PhotoItemProps) {
  const update = useUpdateRoomPhoto(roomId);
  const reorder = useReorderRoomPhotos(roomId);
  const remove = useDeleteRoomPhoto(roomId);
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [alt, setAlt] = useState(photo.alt);
  const [altError, setAltError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = update.isPending || reorder.isPending || remove.isPending;

  const fail = (fallback: string) => (failure: Error) => {
    setError(messageOf(failure, fallback));
  };

  const move = (offset: -1 | 1) => {
    const ids = photos.map((p) => p.id);
    const target = index + offset;
    const a = ids[index];
    const b = ids[target];
    if (a === undefined || b === undefined) return;
    ids[index] = b;
    ids[target] = a;
    setError(null);
    reorder.mutate(ids, { onError: fail('Não foi possível reordenar as fotos.') });
  };

  const saveAlt = () => {
    const message = altMessage(alt);
    if (message) {
      setAltError(message);
      return;
    }
    setAltError(null);
    update.mutate(
      { photoId: photo.id, body: { alt: alt.trim() } },
      {
        onSuccess: () => {
          setEditing(false);
        },
        onError: fail('Não foi possível salvar a descrição.'),
      },
    );
  };

  return (
    <li
      aria-label={photo.alt}
      className="space-y-space-sm rounded-lg bg-surface-raised shadow-card p-space-sm"
    >
      <img
        src={toPhotoUrl(photo.storageKey, 'small')}
        alt={photo.alt}
        width={photo.width}
        height={photo.height}
        loading="lazy"
        className="aspect-[4/3] w-full rounded-sm object-cover"
      />
      <div className="flex flex-wrap items-center gap-space-xs">
        {photo.isCover ? <Badge tone="emerald">Capa</Badge> : null}
        <span className="font-small text-small text-ink">{photo.alt}</span>
      </div>

      {editing ? (
        <div className="space-y-space-xs">
          <Input
            label="Descrição"
            value={alt}
            maxLength={200}
            error={altError ?? undefined}
            onChange={(event) => {
              setAlt(event.target.value);
            }}
          />
          <div className="flex gap-space-xs">
            <Button size="sm" loading={update.isPending} onClick={saveAlt}>
              Salvar descrição
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setEditing(false);
                setAlt(photo.alt);
                setAltError(null);
              }}
            >
              Cancelar
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-space-xs">
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Subir ${photo.alt}`}
          leadingIcon={ArrowUp}
          disabled={index === 0 || busy}
          onClick={() => {
            move(-1);
          }}
        />
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Descer ${photo.alt}`}
          leadingIcon={ArrowDown}
          disabled={index === photos.length - 1 || busy}
          onClick={() => {
            move(1);
          }}
        />
        {photo.isCover ? null : (
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Definir ${photo.alt} como capa`}
            disabled={busy}
            onClick={() => {
              setError(null);
              update.mutate(
                { photoId: photo.id, body: { isCover: true } },
                { onError: fail('Não foi possível definir a capa.') },
              );
            }}
          >
            Tornar capa
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Editar descrição de ${photo.alt}`}
          disabled={busy}
          onClick={() => {
            setEditing(true);
          }}
        >
          Descrição
        </Button>
        <Button
          className="text-danger"
          variant="ghost"
          size="sm"
          aria-label={`Excluir foto ${photo.alt}`}
          disabled={busy}
          onClick={() => {
            setDeleting(true);
          }}
        >
          Excluir
        </Button>
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}

      <Modal
        open={deleting}
        onClose={() => {
          setDeleting(false);
        }}
        title="Excluir foto"
      >
        <p className="font-body text-body text-ink">
          A foto &quot;{photo.alt}&quot; sai do site e os arquivos são apagados. Isso não pode ser
          desfeito.
        </p>
        <div className="mt-space-lg flex flex-wrap justify-end gap-space-sm">
          <Button
            variant="secondary"
            onClick={() => {
              setDeleting(false);
            }}
          >
            Cancelar
          </Button>
          <Button
            variant="danger"
            loading={remove.isPending}
            onClick={() => {
              remove.mutate(photo.id, {
                onSuccess: () => {
                  setDeleting(false);
                  toast({ message: 'Foto excluída.' });
                },
                onError: (failure) => {
                  setDeleting(false);
                  setError(messageOf(failure, 'Não foi possível excluir a foto.'));
                },
              });
            }}
          >
            Excluir foto
          </Button>
        </div>
      </Modal>
    </li>
  );
}

export interface PhotoManagerProps {
  roomId: string;
  /** Photos in display order. */
  photos: readonly RoomPhoto[];
  /** Resizes a chosen file into the WebP variants; the browser implementation by default. */
  prepare?: (file: File) => Promise<PreparedPhoto>;
}

/** Photo manager of a room: upload with progress, alt text, cover, order and deletion (GES-105..GES-109). */
export function PhotoManager({ roomId, photos, prepare = prepareRoomPhoto }: PhotoManagerProps) {
  const add = useAddRoomPhoto(roomId);
  const { toast } = useToast();
  const [preparing, setPreparing] = useState(false);
  const [ready, setReady] = useState<{ name: string; prepared: PreparedPhoto } | null>(null);
  const [alt, setAlt] = useState('');
  const [altError, setAltError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | undefined>(undefined);
  const full = photos.length >= MAX_PHOTOS;

  const choose = (file: File) => {
    setError(null);
    setPreparing(true);
    prepare(file)
      .then((prepared) => {
        setReady({ name: file.name, prepared });
        setAlt('');
        setAltError(null);
      })
      .catch((failure: unknown) => {
        setError(failure instanceof Error ? failure.message : 'Não foi possível preparar a foto.');
      })
      .finally(() => {
        setPreparing(false);
      });
  };

  const send = () => {
    if (!ready) return;
    const message = altMessage(alt);
    if (message) {
      setAltError(message);
      return;
    }
    setAltError(null);
    setError(null);
    add.mutate(
      { prepared: ready.prepared, alt: alt.trim(), onProgress: setProgress },
      {
        onSuccess: () => {
          setReady(null);
          setAlt('');
          toast({ message: 'Foto enviada.' });
        },
        onError: (failure) => {
          setError(messageOf(failure, 'Não foi possível enviar a foto.'));
        },
        onSettled: () => {
          setProgress(undefined);
        },
      },
    );
  };

  return (
    <div className="space-y-space-md">
      {photos.length === 0 ? (
        <p className="font-small text-small text-ink-muted">Esta sala ainda não tem fotos.</p>
      ) : (
        <ul aria-label="Fotos da sala" className="grid gap-space-md sm:grid-cols-2 lg:grid-cols-3">
          {photos.map((photo, index) => (
            <PhotoItem key={photo.id} roomId={roomId} photo={photo} index={index} photos={photos} />
          ))}
        </ul>
      )}

      {full ? (
        <Alert tone="info">A sala já tem {MAX_PHOTOS} fotos. Exclua uma para enviar outra.</Alert>
      ) : null}
      <FileUpload
        label="Adicionar foto"
        accept={PHOTO_ACCEPT}
        maxBytes={MAX_ORIGINAL_BYTES}
        disabled={full}
        busy={preparing || add.isPending}
        progress={progress}
        help="JPEG, PNG ou WebP. A foto é reduzida no seu navegador antes de ser enviada."
        onFile={choose}
      />
      {ready ? (
        <form
          noValidate
          className="space-y-space-sm rounded-lg bg-surface-deboss shadow-deboss p-space-md"
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
        >
          <p className="font-small text-small text-ink">Foto pronta: {ready.name}</p>
          <Input
            label="Descrição da foto"
            value={alt}
            maxLength={200}
            error={altError ?? undefined}
            help="Texto alternativo para leitores de tela. Descreva o que a foto mostra."
            onChange={(event) => {
              setAlt(event.target.value);
            }}
          />
          <div className="flex gap-space-sm">
            <Button type="submit" loading={add.isPending}>
              Enviar foto
            </Button>
            <Button
              variant="secondary"
              disabled={add.isPending}
              onClick={() => {
                setReady(null);
              }}
            >
              Descartar
            </Button>
          </div>
        </form>
      ) : null}
      {error ? <Alert tone="error">{error}</Alert> : null}
    </div>
  );
}
