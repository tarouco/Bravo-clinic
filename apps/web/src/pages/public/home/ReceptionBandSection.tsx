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

/** Full-bleed photo of the lounge: what the professional's patient sees on arrival. */
export function ReceptionBandSection() {
  return (
    <section className="relative isolate w-full overflow-hidden bg-surface-night">
      <img
        className="absolute inset-0 -z-20 h-full w-full object-cover"
        src="/images/recepcao-lounge.webp"
        alt="Lounge da recepção com sofá curvo, poltrona em bouclé, quadros em tons de areia e ripado curvo iluminado"
        loading="lazy"
      />
      <div className="absolute inset-0 -z-10 bg-gradient-to-t from-surface-night/90 via-surface-night/30 to-transparent" />

      <div className="max-w-7xl mx-auto px-gutter min-h-[560px] md:min-h-[640px] flex flex-col justify-end gap-space-xl py-space-3xl md:flex-row md:items-end md:justify-between">
        <h2 className="max-w-md font-display-l-mobile text-display-l-mobile md:font-display-l md:text-display-l text-ink-night [text-wrap:balance]">
          A primeira impressão do seu paciente começa aqui.
        </h2>
        <ul className="flex gap-space-md">
          {DETAILS.map((detail) => (
            <li key={detail.src} className="w-36 sm:w-44">
              <figure>
                <img
                  className="aspect-[4/5] w-full rounded-xl object-cover shadow-lg ring-1 ring-ink-night/20"
                  src={detail.src}
                  alt={detail.alt}
                  loading="lazy"
                />
                <figcaption className="mt-space-xs font-caption text-caption text-ink-night/85">
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
