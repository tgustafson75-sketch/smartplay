/**
 * 2026-06-23 (Tim — "the course log button stacks the course in triplicate, I had
 * to back out three times") — Expo Router does NOT dedupe pushes, so a rapid
 * double/triple tap (or a multi-fire onPress while the screen loads) stacks the
 * same /course/<id> route 2-3 times. This guarded push ignores a repeat push to
 * the SAME route within a short window, so one tap = one screen.
 */
type PushRouter = { push: (route: never) => void };

let lastRoute = '';
let lastAt = 0;
const DEDUPE_MS = 1200;

export function pushCourseGuarded(router: PushRouter, courseId: string): void {
  const route = `/course/${courseId}`;
  const now = Date.now();
  if (route === lastRoute && now - lastAt < DEDUPE_MS) return; // swallow rapid repeats
  lastRoute = route;
  lastAt = now;
  router.push(route as never);
}
