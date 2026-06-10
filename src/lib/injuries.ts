import type { InjurySide, InjuryStatus } from '@/types/database';

// Domain helpers for the injury tracker. Pure — no React/RN imports —
// so the body-region catalog and the check-in cadence can be unit
// tested and shared by the member tracker, the staff surfaces, and
// the programming analysis page.

export const CHECK_IN_INTERVAL_DAYS = 7;

// Coarse, gym-relevant region vocabulary. Keys are persisted on
// member_injuries.body_region; labels are display-only. views controls
// which figure of the body map carries the hit area.
export const BODY_REGIONS: {
  key: string;
  label: string;
  views: ('front' | 'back')[];
}[] = [
  { key: 'head', label: 'Head', views: ['front', 'back'] },
  { key: 'neck', label: 'Neck', views: ['front', 'back'] },
  { key: 'shoulder', label: 'Shoulder', views: ['front', 'back'] },
  { key: 'chest', label: 'Chest', views: ['front'] },
  { key: 'abdomen', label: 'Abdomen / core', views: ['front'] },
  { key: 'upper_back', label: 'Upper back', views: ['back'] },
  { key: 'lower_back', label: 'Lower back', views: ['back'] },
  { key: 'hip_groin', label: 'Hip / groin', views: ['front'] },
  { key: 'glute', label: 'Glutes', views: ['back'] },
  { key: 'upper_arm', label: 'Upper arm', views: ['front', 'back'] },
  { key: 'elbow', label: 'Elbow', views: ['front', 'back'] },
  { key: 'forearm', label: 'Forearm', views: ['front', 'back'] },
  { key: 'wrist_hand', label: 'Wrist / hand', views: ['front', 'back'] },
  { key: 'quad', label: 'Quad', views: ['front'] },
  { key: 'hamstring', label: 'Hamstring', views: ['back'] },
  { key: 'knee', label: 'Knee', views: ['front', 'back'] },
  { key: 'shin', label: 'Shin', views: ['front'] },
  { key: 'calf', label: 'Calf', views: ['back'] },
  { key: 'ankle_foot', label: 'Ankle / foot', views: ['front', 'back'] },
];

export function regionLabel(key: string): string {
  return BODY_REGIONS.find((r) => r.key === key)?.label ?? key;
}

export function sideLabel(side: InjurySide): string {
  switch (side) {
    case 'left':
      return 'Left';
    case 'right':
      return 'Right';
    case 'both':
      return 'Both sides';
    default:
      return '';
  }
}

export function injuryTitle(region: string, side: InjurySide): string {
  const s = sideLabel(side);
  return s ? `${s} ${regionLabel(region).toLowerCase()}` : regionLabel(region);
}

// 0 (no pain) → emerald, mid → amber, 10 (worst) → red. Used for the
// pain chips, badges, and the analysis heat tints.
export function painColour(level: number): string {
  const clamped = Math.max(0, Math.min(10, Math.round(level)));
  if (clamped <= 2) return '#10B981';
  if (clamped <= 4) return '#F59E0B';
  if (clamped <= 6) return '#F97316';
  return '#EF4444';
}

export const STATUS_META: Record<
  InjuryStatus,
  { label: string; colour: string }
> = {
  active: { label: 'Active', colour: '#EF4444' },
  improving: { label: 'Improving', colour: '#F59E0B' },
  resolved: { label: 'Resolved', colour: '#10B981' },
};

// A weekly check-in is due when the injury is unresolved and the last
// touch (creation or latest update) is older than the interval.
export function isCheckInDue(
  updatedAtIso: string,
  status: InjuryStatus,
  now: Date = new Date(),
): boolean {
  if (status === 'resolved') return false;
  const updated = new Date(updatedAtIso).getTime();
  if (Number.isNaN(updated)) return false;
  return (
    now.getTime() - updated >= CHECK_IN_INTERVAL_DAYS * 24 * 60 * 60 * 1000
  );
}

export function daysAgo(iso: string, now: Date = new Date()): number {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((now.getTime() - then) / (24 * 60 * 60 * 1000)));
}
