/**
 * The silk wave of the emerald card (guias/Card.md, exemplos/WebHero.html): the last child of a
 * `bv-card--emerald`, decorative and below the card's text.
 */
export function EmeraldSilk() {
  return (
    <svg
      className="bv-silk"
      viewBox="0 0 400 200"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M0 150 C 120 40, 240 220, 400 70 L400 200 L0 200Z" fill="rgba(5,30,22,.45)" />
      <path
        d="M0 120 C 140 30, 230 190, 400 40"
        fill="none"
        stroke="rgba(47,165,133,.75)"
        strokeWidth="2"
      />
      <path
        d="M0 132 C 140 46, 236 200, 400 54"
        fill="none"
        stroke="rgba(255,235,151,.45)"
        strokeWidth="1"
      />
    </svg>
  );
}
