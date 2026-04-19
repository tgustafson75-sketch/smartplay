/**
 * engine/serviceEngine.ts
 *
 * Handles on-course service questions: food, restrooms, clubhouse.
 * Uses course data from context when available, falls back to generic guidance.
 */

import type { FocusContext } from './contextBuilder';

export const serviceEngine = (query: string, context: FocusContext): string => {
  const q = query.toLowerCase();
  const { services, hole } = context;

  if (q.includes('restroom') || q.includes('bathroom') || q.includes('toilet') || q.includes('facilities')) {
    if (services.restrooms.length > 0) {
      return `Restrooms at: ${services.restrooms.join(', ')}.`;
    }
    return 'Restrooms are typically at the turn and near the clubhouse. Check ahead at hole 9.';
  }

  if (q.includes('food') || q.includes('drink') || q.includes('eat') || q.includes('hungry') || q.includes('snack') || q.includes('water')) {
    if (services.food) {
      return `Food available at ${services.food}. Worth a stop if you need fuel.`;
    }
    return 'Grab something at the turn — hole 9 or 10. Keep the energy up.';
  }

  if (q.includes('clubhouse') || q.includes('pro shop')) {
    if (services.clubhouse) {
      return `Clubhouse is at ${services.clubhouse}.`;
    }
    return 'The clubhouse is back at the start — worth checking after your round.';
  }

  if (q.includes('cart')) {
    return 'Watch for the cart coming around — usually shows up at the turn and after hole 14.';
  }

  return `Services available at the clubhouse. You're on hole ${hole} — focus on the shot first.`;
};
