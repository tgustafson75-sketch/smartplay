import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type TypicalMiss = 'right' | 'left' | 'straight' | null;
export type BiggestStruggle = 'driver' | 'irons' | 'short-game' | 'putting' | 'mental' | null;
export type BigStrength = 'distance' | 'accuracy' | 'short-game' | 'putting' | 'consistency' | null;
export type PhysicalLimitation = 'back' | 'shoulder' | 'knee' | 'none' | null;
export type CoachingStyle = 'calm' | 'aggressive' | 'encouraging' | 'focused';

interface PlayerProfileState {
  typicalMiss: TypicalMiss;
  biggestStruggle: BiggestStruggle;
  bigStrength: BigStrength;
  physicalLimitation: PhysicalLimitation;
  profileComplete: boolean;
  coachingStyle: CoachingStyle;

  setTypicalMiss: (v: TypicalMiss) => void;
  setBiggestStruggle: (v: BiggestStruggle) => void;
  setBigStrength: (v: BigStrength) => void;
  setPhysicalLimitation: (v: PhysicalLimitation) => void;
  setProfileComplete: (v: boolean) => void;
  setCoachingStyle: (v: CoachingStyle) => void;
  resetProfile: () => void;
}

export const usePlayerProfileStore = create<PlayerProfileState>()(
  persist(
    (set) => ({
      typicalMiss: null,
      biggestStruggle: null,
      bigStrength: null,
      physicalLimitation: null,
      profileComplete: false,
      coachingStyle: 'calm' as CoachingStyle,

      setTypicalMiss: (v) => set({ typicalMiss: v }),
      setBiggestStruggle: (v) => set({ biggestStruggle: v }),
      setBigStrength: (v) => set({ bigStrength: v }),
      setPhysicalLimitation: (v) => set({ physicalLimitation: v }),
      setProfileComplete: (v) => set({ profileComplete: v }),
      setCoachingStyle: (v) => set({ coachingStyle: v }),
      resetProfile: () =>
        set({
          typicalMiss: null,
          biggestStruggle: null,
          bigStrength: null,
          physicalLimitation: null,
          profileComplete: false,
          coachingStyle: 'calm',
        }),
    }),
    {
      name: 'smartplay-player-profile',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);

/** Build a concise one-liner coach note from the persisted profile for injection into advice. */
export function buildProfileHint(
  typicalMiss: TypicalMiss,
  physicalLimitation: PhysicalLimitation
): string {
  const parts: string[] = [];
  if (typicalMiss === 'right') parts.push('you tend to miss right — aim a touch left and keep the face square');
  else if (typicalMiss === 'left') parts.push('your miss goes left — start it right of your target and hold through');
  if (physicalLimitation === 'back') parts.push('keep the swing tempo smooth to protect the back');
  else if (physicalLimitation === 'shoulder') parts.push('use rotation over arm power to protect the shoulder');
  else if (physicalLimitation === 'knee') parts.push('stay on a stable base — minimize the lateral shift');
  if (parts.length === 0) return '';
  return parts.join('. ');
}

/** Generate a simple initial practice plan string from the full profile. */
export function buildInitialPracticePlan(
  typicalMiss: TypicalMiss,
  biggestStruggle: BiggestStruggle,
  bigStrength: BigStrength,
  physicalLimitation: PhysicalLimitation
): string {
  const lines: string[] = [];

  if (typicalMiss === 'right')
    lines.push('Your miss is right — inside-out path drills, tee lower, swing to right field for 20 reps.');
  else if (typicalMiss === 'left')
    lines.push('Your miss is left — hold the face, keep the trail arm connected, 20 controlled reps.');
  else if (typicalMiss === 'straight')
    lines.push("You hit it straight — focus on distance control and shot shaping.");

  if (biggestStruggle === 'driver')
    lines.push('Driver is your priority. Spend 60% of warmup on tee work: grip, tempo, alignment.');
  else if (biggestStruggle === 'irons')
    lines.push('Iron play is your gap. Dedicate half your range time to ball-position and alignment.');
  else if (biggestStruggle === 'short-game')
    lines.push('70% of strokes come from inside 100 yards. Chipping and pitching drills first.');
  else if (biggestStruggle === 'putting')
    lines.push('Putting is your fastest score-saver. Speed-control lags and 5-foot circle drills top the plan.');
  else if (biggestStruggle === 'mental')
    lines.push('Mental game matters. Practice pre-shot routine — same process every shot, no exceptions.');

  if (bigStrength === 'putting')
    lines.push('Your putting is a strength — 10 warm-up putts is enough; invest the extra time in ball-striking.');
  else if (bigStrength === 'distance')
    lines.push('You have the distance — channel it into accuracy with a narrow target drill each session.');

  if (physicalLimitation === 'back')
    lines.push('With your back, drill at 80% power. Tempo-based reps beat max-effort swings every time.');
  else if (physicalLimitation === 'shoulder')
    lines.push('With your shoulder, short game work will give you the most improvement with minimal strain.');
  else if (physicalLimitation === 'knee')
    lines.push('With your knee, a wide stable stance and arm swing will keep you consistent and safe.');

  return lines.join('\n\n');
}
