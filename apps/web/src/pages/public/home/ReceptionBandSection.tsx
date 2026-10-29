const DETAILS = [
  {
    src: '/images/copa.webp',
    alt: 'Copa com bancada curva e bancos altos, com vista para a recepção',
    caption: 'Café e copa',
  },
  {
    src: '/images/lavabo.webp',
    alt: 'Lavabo em verde-oliva com painéis de madeira, cuba escultural e metais dourados',
    caption: 'Lavabo privativo',
  },
];

/**
 * Full-bleed photo of the lounge on the emerald-deep band (the v3 dark band): what the
 * professional's patient sees on arrival.
 */
export function ReceptionBandSection() {
  return (
    <section className="relative isolate w-full overflow-hidden bg-emerald-deep text-on-emerald">
      <img
        className="absolute inset-0 -z-20 h-full w-full object-cover"
        src="/images/recepcao-lounge.webp"
        alt="Lounge da recepção com sofá curvo, poltrona em bouclé, quadros em tons de areia e ripado curvo iluminado"
        loading="lazy"
      />
      <div className="absolute inset-0 -z-10 bg-gradient-to-t from-emerald-deep/95 via-emerald-deep/40 to-transparent" />

      <div className="max-w-7xl mx-auto px-gutter min-h-[560px] md:min-h-[640px] flex flex-col justify-end gap-space-xl py-space-3xl md:flex-row md:items-end md:justify-between">
        <h2 className="max-w-md font-display text-display-l-mobile text-gold md:text-display-l [text-wrap:balance]">
          A primeira impressão do seu paciente começa aqui.
        </h2>
        <ul className="flex gap-space-md">
          {DETAILS.map((detail) => (
            <li key={detail.src} className="w-36 sm:w-44">
              <figure>
                <img
                  className="aspect-[4/5] w-full rounded-md object-cover shadow-lift-2 ring-1 ring-on-emerald/20"
                  src={detail.src}
                  alt={detail.alt}
                  loading="lazy"
                />
                <figcaption className="mt-space-xs font-caption text-caption text-on-emerald/85">
                  {detail.caption}
                </figcaption>
              </figure>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
