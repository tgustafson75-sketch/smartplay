import * as fs from 'fs';
import * as path from 'path';

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, '../../', rel), 'utf-8');

/**
 * 2026-08-22 (Tim — "adding the PDF from SmartPump, but the dashboard says it can't find any dated
 * workouts"). Verified live against the deployed endpoint with two generated PDFs.
 */
describe('the workout import says WHICH problem it hit', () => {
  const api = read('api/workout-import.ts');
  const client = read('services/smartPumpIngest.ts');

  it('tells the model what day it is', () => {
    // Without this it dropped everything on a dateless page -- and worse, when it did guess it
    // returned 2024, 2023 and even 2014 for the same file, silently importing workouts years off.
    expect(api).toMatch(/REFERENCE DATE \(today, UTC\)/);
    expect(api).toMatch(/const refDate =/);
    expect(api).toMatch(/Never emit a date in the future/);
  });

  it('resolves a bare MM-DD server-side as a backstop, never into the future', () => {
    expect(api).toMatch(/const resolveDate =/);
    expect(api).toMatch(/never the future/);
  });

  it('counts sessions the model saw but could not date', () => {
    // The model drops undated rows before emitting, so the row count structurally cannot see them.
    // Asking for the number explicitly is the only way to tell an EMPTY file from a DATELESS one.
    expect(api).toMatch(/sessions_seen_without_dates/);
    expect(api).toMatch(/required: \['workouts', 'confidence', 'warnings', 'sessions_seen_without_dates'\]/);
    expect(api).toMatch(/undatable_count:/);
  });

  it('turns that into a message naming the fix, not just the symptom', () => {
    expect(client).toMatch(/workouts_without_dates/);
    expect(client).toMatch(/no dates on them/);
    expect(client).toMatch(/Add dates to the export and re-import/);
  });

  it('still reads a prose training-block summary, not only a table', () => {
    expect(api).toMatch(/PROSE SUMMARY/);
    expect(api).toMatch(/Foundation phase/);
  });

  it('refuses to invent a date to fill a stated session count', () => {
    // Fabricating dates would corrupt the very trend this feeds.
    expect(api).toMatch(/inventing dates to fill a count would corrupt/);
  });
});
