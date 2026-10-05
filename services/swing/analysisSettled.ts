/**
 * 2026-10-04 (Tim: "Once an uploaded video gets a high confidence finding successfully, it should be
 * marked as essentially done with analysis from the app point of view in terms of opening it and
 * predicting action. We still have a re-analyze button but that is user driven once in the file.
 * This allows user tools like smartcapture without the same reload issue every time.")
 *
 * SETTLED = the read landed ('ok') with a HIGH-confidence named finding. Opening a settled swing does
 * no analysis work of its own — no warm-up, no auto-analyze, no automatic second pass. Everything
 * after that is the player's: Re-analyze, the Body / Swing trace toggles, Smart Capture.
 */
type Settleable = {
  analysis_status?: string | null;
  primary_issue?: { confidence?: string | null; issue_id?: string | null } | null;
} | null | undefined;

export function isAnalysisSettled(s: Settleable): boolean {
  if (!s || s.analysis_status !== 'ok') return false;
  const pi = s.primary_issue;
  if (!pi || pi.confidence !== 'high') return false;
  // A soft "observation" is not a finding; a contact read is.
  return pi.issue_id !== 'smartmotion_observation';
}
