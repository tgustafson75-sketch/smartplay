/**
 * components/OwnerIssueLogPrompt.tsx — owner-only "you've got N issues, send them"
 * nudge. 2026-06-28 (Tim) — mostly for Tank, who won't dig into Owner Tools to
 * export. When 5+ FAILURES pile up since the last export, an owner sees a banner
 * with a one-tap "Send now" that opens the pre-filled support email. Owner-gated,
 * dismissable, re-arms only after another batch accrues (no nagging).
 */

import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useIssueLogStore, type IssueLogKind } from '../store/issueLogStore';
import { usePlayerProfileStore, isOwnerEmail } from '../store/playerProfileStore';
import { exportAllIssues } from '../services/issueLogExport';

const THRESHOLD = 5;
// Real failures only — boot breadcrumbs + manual user notes don't count toward the nudge.
const FAILURE_KINDS: ReadonlySet<IssueLogKind> = new Set<IssueLogKind>([
  'voice_error', 'voice_silent_fail', 'transcribe_error',
  'gps_error', 'analysis_error', 'voice_miss', 'app_error',
]);

export function OwnerIssueLogPrompt(): React.ReactElement | null {
  const email = usePlayerProfileStore(s => s.email);
  const entries = useIssueLogStore(s => s.entries);
  const lastExportedAt = useIssueLogStore(s => s.lastExportedAt);
  const [dismissedAtCount, setDismissedAtCount] = useState<number | null>(null);
  const [sending, setSending] = useState(false);

  const isOwner = useMemo(() => isOwnerEmail(email), [email]);
  const unsent = useMemo(
    () => entries.filter(e => e.timestamp > (lastExportedAt ?? 0) && e.kind != null && FAILURE_KINDS.has(e.kind)).length,
    [entries, lastExportedAt],
  );

  // Show at the threshold; after "Later", stay hidden until another full batch accrues.
  const show = isOwner && unsent >= THRESHOLD &&
    (dismissedAtCount == null || unsent >= dismissedAtCount + THRESHOLD);
  if (!show) return null;

  return (
    <View
      style={{
        position: 'absolute', left: 12, right: 12, bottom: 96,
        backgroundColor: '#111827', borderRadius: 14, borderWidth: 1, borderColor: '#f59e0b',
        padding: 14, shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 10, elevation: 8,
      }}
    >
      <Text style={{ color: '#fbbf24', fontSize: 14, fontWeight: '800', marginBottom: 2 }}>
        ⚠ {unsent} issues logged
      </Text>
      <Text style={{ color: '#cbd5e1', fontSize: 13, marginBottom: 12 }}>
        Send them to the team so we can fix the voice / GPS flow. One tap opens the email — just hit Send.
      </Text>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <TouchableOpacity
          style={{ flex: 1, paddingVertical: 11, borderRadius: 10, alignItems: 'center', borderWidth: 1, borderColor: '#374151' }}
          onPress={() => setDismissedAtCount(unsent)}
          disabled={sending}
        >
          <Text style={{ color: '#9ca3af', fontWeight: '600' }}>Later</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={{ flex: 1.4, paddingVertical: 11, borderRadius: 10, alignItems: 'center', backgroundColor: '#f59e0b' }}
          onPress={async () => {
            setSending(true);
            try { await exportAllIssues(); } finally { setSending(false); }
          }}
          disabled={sending}
        >
          {sending
            ? <ActivityIndicator size="small" color="#1f2937" />
            : <Text style={{ color: '#1f2937', fontWeight: '800' }}>Send now</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}
