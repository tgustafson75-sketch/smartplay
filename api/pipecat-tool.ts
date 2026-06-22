/**
 * Pipecat tool bridge — called by the Python Pipecat server when Claude fires
 * a data tool (log_shot, log_score, log_emotional_state, lookup_course, lookup_hole).
 *
 * UI tools (open_smartvision, open_smartfinder, open_swinglab, record_swing) are
 * handled client-side via WebSocket push and never reach this endpoint.
 *
 * Auth: X-Pipecat-Secret header must match PIPECAT_SESSION_SECRET env var.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { Course } from '../types/course';
import { searchCourses, getCourse } from '../services/golfCourseApi';

const SESSION_SECRET = process.env.PIPECAT_SESSION_SECRET ?? '';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const incomingSecret = req.headers['x-pipecat-secret'];
  if (SESSION_SECRET && incomingSecret !== SESSION_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { tool, args = {}, playerId } = req.body as {
    tool: string;
    args: Record<string, unknown>;
    sessionId?: string;
    playerId?: string;
  };

  try {
    const result = await routeTool(tool, args, playerId);
    return res.status(200).json({ result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[pipecat-tool] ${tool} error:`, msg);
    return res.status(200).json({ result: `Got it — ${tool} noted.` });
  }
}

async function routeTool(
  tool: string,
  args: Record<string, unknown>,
  _playerId?: string,
): Promise<string> {
  switch (tool) {
    case 'log_shot': {
      const parts: string[] = [];
      if (args.club)           parts.push(`club: ${args.club}`);
      if (args.direction)      parts.push(`direction: ${args.direction}`);
      if (args.contactQuality) parts.push(`contact: ${args.contactQuality}`);
      if (args.outcome)        parts.push(`landed: ${args.outcome}`);
      console.log(`[pipecat-tool] log_shot: ${parts.join(', ')}`);
      return 'Shot logged.';
    }

    case 'log_score': {
      const { hole, score } = args as { hole?: number; score: number };
      console.log(`[pipecat-tool] log_score hole=${hole ?? 'current'} score=${score}`);
      return `Score ${score} logged${hole ? ` for hole ${hole}` : ''}.`;
    }

    case 'log_emotional_state': {
      const { state, valence } = args as { state: string; valence: string };
      console.log(`[pipecat-tool] log_emotional_state: ${valence} — ${state}`);
      return 'Noted.';
    }

    case 'lookup_course': {
      const { query } = args as { query: string };
      const courses = await searchCourses(query);
      if (!courses.length || courses[0]?._error) return `No courses found matching "${query}".`;
      const summary = courses
        .filter(c => !c._error)
        .map(c => `${c.club_name} (${c.location})`)
        .join('; ');
      return `Found: ${summary}.`;
    }

    case 'lookup_hole': {
      const { course_id, hole_number, tee_name } = args as {
        course_id: string;
        hole_number: number;
        tee_name?: string;
      };
      const course: Course | null = await getCourse(course_id);
      if (!course) return `Course ${course_id} not found.`;

      const tee = tee_name
        ? (course.tees.find(t => t.tee_name.toLowerCase() === tee_name.toLowerCase()) ?? course.tees[0])
        : course.tees[0];

      if (!tee) return `No tee data at ${course.club_name}.`;

      const hole = tee.holes.find(h => h.hole_number === hole_number);
      if (!hole) return `Hole ${hole_number} not found at ${course.club_name}.`;

      return `Hole ${hole_number} at ${course.club_name}: par ${hole.par}, ${hole.yardage}y from ${tee.tee_name}.`;
    }

    default:
      return `Tool "${tool}" not handled server-side.`;
  }
}
