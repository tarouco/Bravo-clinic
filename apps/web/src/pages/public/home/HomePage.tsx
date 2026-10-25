import { useEffect, useState } from 'react';
import type { RoomSlug } from '../../../features/home/room-slug';
import { ArchitectureSection } from './ArchitectureSection';
import { ExtrasSection } from './ExtrasSection';
import { HeroSection } from './HeroSection';
import { AmenitiesSection, LaunchCtaSection, PoliciesSection } from './HomeStaticSections';
import { PricingSimulatorSection } from './PricingSimulatorSection';
import { RoomsSection } from './RoomsSection';

export const HOME_TITLE = 'Bravô Clinic – Salas Inteligentes | Praia Brava, Itajaí';

function scrollToSimulator(): void {
  document.getElementById('simulador')?.scrollIntoView?.({ behavior: 'smooth' });
}

export function HomePage() {
  const [selectedRoom, setSelectedRoom] = useState<RoomSlug>('principal');

  useEffect(() => {
    document.title = HOME_TITLE;
  }, []);

  return (
    <div className="flex flex-col w-full">
      <HeroSection
        selectedRoom={selectedRoom}
        onRoomChange={setSelectedRoom}
        onCheck={scrollToSimulator}
      />
      <ArchitectureSection />
      <RoomsSection
        onReserve={(slug) => {
          setSelectedRoom(slug);
          scrollToSimulator();
        }}
      />
      <PricingSimulatorSection />
      <ExtrasSection />
      <AmenitiesSection />
      <PoliciesSection />
      <LaunchCtaSection />
    </div>
  );
}
