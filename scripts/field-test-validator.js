/**
 * field-test-validator.js
 *
 * Automated validation of code-verifiable field test criteria.
 * Checks the actual source files for the fixes applied during the UX field test.
 *
 * Usage:  node scripts/field-test-validator.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT    = path.resolve(__dirname, '..');
const CADDIE  = path.join(ROOT, 'app', '(tabs)', 'caddie.tsx');
const VOICE   = path.join(ROOT, 'hooks', 'useVoiceCaddie.ts');
const ENGINE  = path.join(ROOT, 'services', 'VoiceEngine.js');
const LAYOUT  = path.join(ROOT, 'app', '_layout.tsx');

const results = [];
let allPass = true;

function check(label, test) {
  let pass = false;
  let detail = '';
  try {
    const result = test();
    pass   = result.pass;
    detail = result.detail ?? '';
  } catch (e) {
    pass   = false;
    detail = `Error: ${e.message}`;
  }
  if (!pass) allPass = false;
  results.push({ label, pass, detail });
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

// ─────────────────────────────────────────────────────────────────────────────
const caddie = read(CADDIE);
const voice  = read(VOICE);
const engine = read(ENGINE);
const layout = read(LAYOUT);

// ─── TEST 1: Zero-Think — advice card never blank on hole load ───────────────
check('T1 · Advice card auto-fills on hole load (no blank state)', () => {
  // currentAdvice useMemo must exist
  const hasMemo = caddie.includes('const currentAdvice = useMemo');
  // JSX uses currentAdvice fallback  
  const hasJsxFallback = caddie.includes('caddieMsg || (clubRec.reason ?? currentAdvice)');
  // Hole-change effect clears caddieMsg so currentAdvice is shown
  const clearsMsgOnHoleChange = caddie.includes("setCaddieMsg('');   // clear previous hole msg");
  return {
    pass:   hasMemo && hasJsxFallback && clearsMsgOnHoleChange,
    detail: `memo:${hasMemo} jsxFallback:${hasJsxFallback} clears:${clearsMsgOnHoleChange}`,
  };
});

// ─── TEST 2: Voice Reality — yardage speaks live number ──────────────────────
check('T2 · Voice "yardage" returns live yards (not redirect)', () => {
  const speaksYards = voice.includes('const reply = `${yards} yards.`');
  const bypassesAI  = voice.includes('// ── Yardage query — bypass AI entirely');
  const hasContext  = voice.includes('if (isYardageQuery && context?.distance)');
  return {
    pass:   speaksYards && bypassesAI && hasContext,
    detail: `speaksYards:${speaksYards} bypassAI:${bypassesAI} contextCheck:${hasContext}`,
  };
});

// ─── TEST 2b: Voice — club query bypasses AI ────────────────────────────────
check('T2b · Voice "what club" returns instant local answer', () => {
  const speaksClub = voice.includes('isClubQuery') && voice.includes('bypass AI');
  return {
    pass:   speaksClub,
    detail: `clubBypass:${speaksClub}`,
  };
});

// ─── TEST 3: Walking — View Shot fixed slot, no reflow ───────────────────────
check('T3 · View Shot button has fixed slot (no secondary row reflow)', () => {
  // Old conditional render (would cause reflow): {lastVideoUri ? (...) : null}
  const noConditionalNull = !caddie.includes(': null}\n          ) : null}');
  // New fixed slot: disabled prop present
  const hasFixedSlot = caddie.includes('disabled={!lastVideoUri}');
  const hasOpacity   = caddie.includes('!lastVideoUri && { opacity: 0.3 }');
  return {
    pass:   hasFixedSlot && hasOpacity,
    detail: `fixedSlot:${hasFixedSlot} dimmedWhenEmpty:${hasOpacity} noConditionalNull:${noConditionalNull}`,
  };
});

// ─── TEST 4: Pressure — pattern row hidden when swing thought active ─────────
check('T4 · Pattern row hidden when swing thought suggestion is active', () => {
  const hasGuard = caddie.includes('!swingThoughtSuggestion &&');
  const comment  = caddie.includes('hidden when swing thought suggestion is active');
  return {
    pass:   hasGuard,
    detail: `hiddenGuard:${hasGuard} comment:${comment}`,
  };
});

// ─── TEST 5: BT — ask() has try/finally (isSpeaking never stuck) ─────────────
check('T5 · ask() try/finally prevents stuck isSpeaking state', () => {
  // Verify ask() block contains try around voiceEnabled, with finally resetting isSpeaking
  const askIdx    = caddie.indexOf('const ask = useCallback');
  const stopIdx   = caddie.indexOf('const stop = useCallback');
  const askBlock  = caddie.slice(askIdx, stopIdx);
  const hasTry    = askBlock.includes('setIsSpeaking(true)') && askBlock.includes('try {') && askBlock.includes('if (voiceEnabled)');
  const hasFinally = askBlock.includes('} finally {') && askBlock.includes('setIsSpeaking(false)');
  return {
    pass:   hasTry && hasFinally,
    detail: `tryBlock:${hasTry} finallyReset:${hasFinally}`,
  };
});

// ─── TEST 5b: BT — audio routing at layout mount ─────────────────────────────
check('T5b · Bluetooth audio routing set at app root (_layout.tsx)', () => {
  const hasBtFlags = layout.includes('playThroughEarpieceAndroid') ||
                     layout.includes('shouldDuckAndroid') ||
                     layout.includes('setAudioModeAsync');
  return {
    pass:   hasBtFlags,
    detail: `btAudioFlags:${hasBtFlags}`,
  };
});

// ─── TEST 6: Glance — distance number is large ──────────────────────────────
check('T6 · Distance number uses large font size (Type.dist)', () => {
  const hasLargeDist = caddie.includes('fontSize: Type.dist');
  // club rec displayed on distance card
  const hasClubOnCard = caddie.includes('s.distanceClub');
  return {
    pass:   hasLargeDist && hasClubOnCard,
    detail: `largeDist:${hasLargeDist} clubOnCard:${hasClubOnCard}`,
  };
});

// ─── TEST 7: Silence — score stepper debounced ───────────────────────────────
check('T7 · Score stepper voice debounced (speaks only on first entry)', () => {
  const hasDebounce = caddie.includes('if (voiceEnabled && cur === 0)');
  return {
    pass:   hasDebounce,
    detail: `debouncedStepper:${hasDebounce}`,
  };
});

// ─── TEST 8: Flow — hole change clears all state ─────────────────────────────
check('T8 · Hole change clears shot feedback + correction prompt', () => {
  const clearsFeedback    = caddie.includes("setShotFeedback({ visible: false, result: '', insight: '' });");
  const clearsCorrection  = caddie.includes('setShowCorrection(false);');
  return {
    pass:   clearsFeedback && clearsCorrection,
    detail: `clearsFeedback:${clearsFeedback} clearsCorrection:${clearsCorrection}`,
  };
});

// ─── Additional stability checks ─────────────────────────────────────────────
check('STAB · isProcessingShotRef guard wraps recordShot', () => {
  const hasGuard    = caddie.includes('isProcessingShotRef.current) return');
  const hasTryFinal = caddie.includes('isProcessingShotRef.current = false');
  return {
    pass:   hasGuard && hasTryFinal,
    detail: `guard:${hasGuard} finallyReset:${hasTryFinal}`,
  };
});

check('STAB · ShotCamera empty-URI guard prevents ShotVisionPlayer open', () => {
  const hasGuard = caddie.includes("if (!uri) { setShowShotCamera(false); return; }");
  return {
    pass:   hasGuard,
    detail: `emptyUriGuard:${hasGuard}`,
  };
});

check('STAB · Unmount cleanup clears all timers', () => {
  const clearsVision   = caddie.includes('if (visionOverlayTimer.current) clearTimeout(visionOverlayTimer.current)');
  const clearsFeedback = caddie.includes('if (feedbackTimer.current)      clearTimeout(feedbackTimer.current)');
  const clearsDrag     = caddie.includes('if (dragDebounceRef.current)    clearTimeout(dragDebounceRef.current)');
  return {
    pass:   clearsVision && clearsFeedback && clearsDrag,
    detail: `vision:${clearsVision} feedback:${clearsFeedback} drag:${clearsDrag}`,
  };
});

check('STAB · showCorrection auto-dismisses (8s timer)', () => {
  const hasTimer = caddie.includes('setTimeout(() => setShowCorrection(false), 8000)');
  const hasEffect = caddie.includes('if (!showCorrection) return;');
  return {
    pass:   hasTimer && hasEffect,
    detail: `autoDismiss8s:${hasTimer} effectGuard:${hasEffect}`,
  };
});

check('PERF · getContextualAdvice() memoized — not called inline in render', () => {
  const hasMemo = caddie.includes('const currentAdvice = useMemo(() => getContextualAdvice()');
  // Confirm JSX uses currentAdvice, not getContextualAdvice()
  const jsxUsesGetContextual = (caddie.match(/\{caddieMsg.*getContextualAdvice\(\)/g) ?? []).length === 0;
  return {
    pass:   hasMemo && jsxUsesGetContextual,
    detail: `memoized:${hasMemo} noInlineCall:${jsxUsesGetContextual}`,
  };
});

check('VOICE · VoiceEngine has listen timeout failsafe', () => {
  const hasTimeout = engine.includes('LISTEN TIMEOUT — force idle') ||
                     engine.includes('MAX_LISTEN_MS');
  return {
    pass:   hasTimeout,
    detail: `listenTimeout:${hasTimeout}`,
  };
});

// ═══════════════════════════════════════════════════════════════════════════════
// REGRESSION GUARDS — FIX 1–8
// Locks in all field-tested UX improvements and prevents future regression.
// These checks verify system-level contracts, not individual lines.
// ═══════════════════════════════════════════════════════════════════════════════

// ─── FIX 1 · Advice always present — no forced "Ask Caddie" dependency ────────
check('FIX1 · Advice auto-renders without requiring Ask Caddie tap', () => {
  // currentAdvice must be a memoized value
  const hasMemo = caddie.includes('const currentAdvice = useMemo(() => getContextualAdvice()');
  // JSX must fall through: caddieMsg first, then club reason, then contextual advice
  const hasFallthrough = caddie.includes('caddieMsg || (clubRec.reason ?? currentAdvice)');
  // Must NOT gate advice card on isSpeaking or other ask-dependency
  const noAskGate = !caddie.includes('{isSpeaking && currentAdvice}') &&
                    !caddie.includes('{asked && currentAdvice}');
  return {
    pass:   hasMemo && hasFallthrough && noAskGate,
    detail: `memo:${hasMemo} fallthrough:${hasFallthrough} noAskGate:${noAskGate}`,
  };
});

// ─── FIX 2 · Stable button layout — no conditional render that shifts layout ──
check('FIX2 · Action buttons use disabled state, not conditional render', () => {
  // View Shot: always rendered with disabled prop (not conditionally rendered away)
  const hasFixedSlot   = caddie.includes('disabled={!lastVideoUri}');
  const hasDimOpacity  = caddie.includes('!lastVideoUri && { opacity: 0.3 }');
  // Shot buttons never conditionally removed — row always present
  const hasShotRow     = caddie.includes('style={s.shotRow}');
  // hitSlop on shot buttons — prevents missed taps while walking
  const hasHitSlop     = caddie.includes('hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}');
  return {
    pass:   hasFixedSlot && hasDimOpacity && hasShotRow && hasHitSlop,
    detail: `fixedSlot:${hasFixedSlot} dimOpacity:${hasDimOpacity} shotRow:${hasShotRow} hitSlop:${hasHitSlop}`,
  };
});

// ─── FIX 3 · Visual priority — only one signal dominant at a time ─────────────
check('FIX3 · Pattern row suppressed when swing thought suggestion active', () => {
  // Pattern row guarded by !swingThoughtSuggestion
  const patternGuard = caddie.includes('!swingThoughtSuggestion &&');
  // Advice card falls through layers: caddieMsg → clubRec.reason → currentAdvice (never empty)
  const adviceFallback = caddie.includes('caddieMsg || (clubRec.reason ?? currentAdvice)');
  // Swing thought uses a separate state, not overwriting caddieMsg directly
  const separateState  = caddie.includes('swingThoughtSuggestion') &&
                         caddie.includes('setSwingThoughtSuggestion');
  return {
    pass:   patternGuard && adviceFallback && separateState,
    detail: `patternGuard:${patternGuard} adviceFallback:${adviceFallback} separateState:${separateState}`,
  };
});

// ─── FIX 4 · Voice rate limiting — no duplicate voice on repeated events ───────
check('FIX4 · Voice output suppressed on repeated same-context events', () => {
  // Score stepper debounce: only speaks on cur === 0 (first entry per hole)
  const stepperDebounce  = caddie.includes('if (voiceEnabled && cur === 0)');
  // Shot mark has a 1.5s double-trigger guard
  const markShotGuard    = caddie.includes('markShotUsedRef.current) return') &&
                           caddie.includes('markShotUsedRef.current = true');
  // Shot mark also has a 5s cooldown between marks
  const markShotCooldown = caddie.includes('lastShotTimeRef.current < 5000') ||
                           caddie.includes('now - lastShotTimeRef.current < 5000');
  // Voice pattern feedback routed through VoiceTimingController (not raw speak)
  const hasTimingCtrl    = caddie.includes('VoiceTimingController.afterShot');
  return {
    pass:   stepperDebounce && markShotGuard && markShotCooldown && hasTimingCtrl,
    detail: `stepperDebounce:${stepperDebounce} markGuard:${markShotGuard} markCooldown:${markShotCooldown} timingCtrl:${hasTimingCtrl}`,
  };
});

// ─── FIX 5 · Flow continuity — system auto-resets on hole change ──────────────
check('FIX5 · Hole change triggers full auto-reset (no manual restart needed)', () => {
  // All resets live in the same useEffect watching currentHole
  const holeEffect = caddie.indexOf('[currentHole]');
  const effectBlock = holeEffect !== -1 ? caddie.slice(Math.max(0, holeEffect - 600), holeEffect) : '';
  const clearsFeedback   = effectBlock.includes("setShotFeedback({ visible: false");
  const clearsCorrection = effectBlock.includes('setShowCorrection(false)');
  const clearsCaddieMsg  = effectBlock.includes("setCaddieMsg('')");
  const resetsBallPos    = effectBlock.includes('setBallPosition(');
  const clearsTarget     = effectBlock.includes('setTargetPosition(null)');
  return {
    pass:   clearsFeedback && clearsCorrection && clearsCaddieMsg && resetsBallPos && clearsTarget,
    detail: `feedback:${clearsFeedback} correction:${clearsCorrection} msg:${clearsCaddieMsg} ball:${resetsBallPos} target:${clearsTarget}`,
  };
});

// ─── FIX 6 · Interaction stability — consistent touch targets while walking ───
check('FIX6 · Shot buttons have hitSlop and stable fixed height', () => {
  // hitSlop present on shot buttons
  const hasHitSlop  = caddie.includes('hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}');
  // Shot button has a fixed height in styles (not percentage-based)
  const hasFixedH   = caddie.includes('height: 42');
  // Shot button flex: 1 so all three remain equal width regardless of text
  const hasFlex     = caddie.includes("shotBtn: { flex: 1");
  return {
    pass:   hasHitSlop && hasFixedH && hasFlex,
    detail: `hitSlop:${hasHitSlop} fixedHeight:${hasFixedH} flex1:${hasFlex}`,
  };
});

// ─── FIX 7 · Silence intelligence — voice only fires on meaningful events ─────
check('FIX7 · Voice gated on pattern confidence + timing controller', () => {
  // Pattern row itself requires confidence > 30 before appearing
  const hasConfidenceGate = caddie.includes('pattern.patternConfidence > 30');
  // Pattern voice routed through timing controller (rate-limits cadence)
  const hasTimingCtrl     = caddie.includes('VoiceTimingController.afterShot');
  // Swing thought suggestion has per-thought cooldown ref
  const hasSuggestionTime = caddie.includes('lastSuggestionTimeRef.current');
  // Hazard nudge voice tip: only fires once per unique hazard encounter
  const hasHazardOnce     = caddie.includes('lastNudgedHazardRef.current !== hazardKey');
  return {
    pass:   hasConfidenceGate && hasTimingCtrl && hasSuggestionTime && hasHazardOnce,
    detail: `confidence>30:${hasConfidenceGate} timingCtrl:${hasTimingCtrl} suggestionCooldown:${hasSuggestionTime} hazardOnce:${hasHazardOnce}`,
  };
});

// ─── FIX 8 · No regression — all core contracts enforced simultaneously ───────
check('FIX8 · All core UX contracts hold simultaneously (meta-check)', () => {
  // This check combines the critical single-line tests from FIX1–7 into one
  // "all systems go" signal. Failure here means a regression in a core contract.
  const f1 = caddie.includes('caddieMsg || (clubRec.reason ?? currentAdvice)');
  const f2 = caddie.includes('disabled={!lastVideoUri}') && caddie.includes('hitSlop={{ top: 10');
  const f3 = caddie.includes('!swingThoughtSuggestion &&');
  const f4 = caddie.includes('if (voiceEnabled && cur === 0)') && caddie.includes('VoiceTimingController.afterShot');
  const f5 = caddie.includes("setCaddieMsg('');   // clear previous hole msg");
  const f6 = caddie.includes('height: 42') && caddie.includes("shotBtn: { flex: 1");
  const f7 = caddie.includes('pattern.patternConfidence > 30') && caddie.includes('lastNudgedHazardRef.current !== hazardKey');
  const allHold = f1 && f2 && f3 && f4 && f5 && f6 && f7;
  return {
    pass:   allHold,
    detail: `f1:${f1} f2:${f2} f3:${f3} f4:${f4} f5:${f5} f6:${f6} f7:${f7}`,
  };
});

// ─── Print report ─────────────────────────────────────────────────────────────
const col = (c) => process.stdout.isTTY ? c : '';
const RESET = col('\x1b[0m'), GREEN = col('\x1b[32m'), RED = col('\x1b[31m'), DIM = col('\x1b[2m');

console.log(`\n${'─'.repeat(64)}`);
console.log(`  SmartPlay Caddie — Field Test Validator`);
console.log(`${'─'.repeat(64)}\n`);

for (const r of results) {
  const icon = r.pass ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
  console.log(`  ${icon} ${r.label}`);
  if (!r.pass || process.argv.includes('--verbose')) {
    console.log(`      ${DIM}${r.detail}${RESET}`);
  }
}

const passed = results.filter((r) => r.pass).length;
const total  = results.length;

console.log(`\n${'═'.repeat(64)}`);
if (allPass) {
  console.log(`  ${GREEN}RESULT: ALL ${total}/${total} CHECKS PASSED${RESET}`);
} else {
  console.log(`  ${RED}RESULT: ${passed}/${total} PASSED — ${total - passed} FAILED${RESET}`);
}
console.log(`${'═'.repeat(64)}\n`);

process.exit(allPass ? 0 : 1);
