import { useEffect } from 'react';
import { ArchitectureSection } from './ArchitectureSection';
import { ExtrasSection } from './ExtrasSection';
import { HeroSection } from './HeroSection';
import { AmenitiesSection, LaunchCtaSection, PoliciesSection } from './HomeStaticSections';
import { PricingSimulatorSection } from './PricingSimulatorSection';
import { ReceptionBandSection } from './ReceptionBandSection';
import { RoomsSection } from './RoomsSection';

export const HOME_TITLE = 'Bravô Clinic – Salas Inteligentes | Praia Brava, Itajaí';

function scrollToSimulator(): void {
  document.getElementById('simulador')?.scrollIntoView?.({ behavior: 'smooth' });
}

export function HomePage() {
  useEffect(() => {
    document.title = HOME_TITLE;
  }, []);

  // Every section below the hero renders only near the viewport (`defer-render`, GES-143).
  return (
    <div className="flex flex-col w-full">
      <HeroSection />
      <div className="defer-render">
        <ArchitectureSection />
      </div>
      <div className="defer-render">
        <RoomsSection onReserve={scrollToSimulator} />
      </div>
      <div className="defer-render">
        <ReceptionBandSection />
      </div>
      <div className="defer-render">
        <PricingSimulatorSection />
      </div>
      <div className="defer-render">
        <ExtrasSection />
      </div>
      <div className="defer-render">
        <AmenitiesSection />
      </div>
      <div className="defer-render">
        <PoliciesSection />
      </div>
      <div className="defer-render">
        <LaunchCtaSection />
      </div>
    </div>
  );
}
