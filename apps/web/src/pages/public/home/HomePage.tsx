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

  return (
    <div className="flex flex-col w-full">
      <HeroSection />
      <ArchitectureSection />
      <RoomsSection onReserve={scrollToSimulator} />
      <ReceptionBandSection />
      <PricingSimulatorSection />
      <ExtrasSection />
      <AmenitiesSection />
      <PoliciesSection />
      <LaunchCtaSection />
    </div>
  );
}
