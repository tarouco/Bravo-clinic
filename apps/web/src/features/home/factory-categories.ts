import type { HourlyCategory } from '@bravo/core';

const everyDay = [1, 2, 3, 4, 5, 6, 7];

/**
 * The four factory hourly categories (design.md "Seeds"). The Home simulator uses them until the
 * live catalog arrives or when the API is unreachable.
 */
export const FACTORY_HOURLY_CATEGORIES: HourlyCategory[] = [
  {
    id: 'factory-1h',
    name: '1 hora',
    weekdays: everyDay,
    appliesOnHolidays: true,
    startMinute: 0,
    endMinute: 1140,
    weekdayRateCents: 9700,
    weekendRateCents: 12000,
    minDurationMinutes: 60,
    status: 'active',
    isReference: true,
    displayOrder: 1,
  },
  {
    id: 'factory-2h',
    name: '2 horas ou mais',
    weekdays: everyDay,
    appliesOnHolidays: true,
    startMinute: 0,
    endMinute: 1140,
    weekdayRateCents: 8000,
    weekendRateCents: 9900,
    minDurationMinutes: 120,
    status: 'active',
    isReference: false,
    displayOrder: 2,
  },
  {
    id: 'factory-1h-night',
    name: '1 hora — noite',
    weekdays: everyDay,
    appliesOnHolidays: true,
    startMinute: 1140,
    endMinute: 1440,
    weekdayRateCents: 12000,
    weekendRateCents: 12000,
    minDurationMinutes: 60,
    status: 'active',
    isReference: false,
    displayOrder: 3,
  },
  {
    id: 'factory-2h-night',
    name: '2 horas ou mais — noite',
    weekdays: everyDay,
    appliesOnHolidays: true,
    startMinute: 1140,
    endMinute: 1440,
    weekdayRateCents: 9900,
    weekendRateCents: 9900,
    minDurationMinutes: 120,
    status: 'active',
    isReference: false,
    displayOrder: 4,
  },
];
