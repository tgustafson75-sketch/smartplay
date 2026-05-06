import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { searchCourses } from '../services/golfCourseApi';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PickedCourse {
  id: string; // 'local:palms' | 'local:lakes' | api course_id string
  name: string;
  fullName: string;
  isLocal: boolean;
}

interface Props {
  onSelect: (course: PickedCourse | null) => void;
  selected: PickedCourse | null;
  /** Phase D-1 — Optional handler for the per-row (i) info affordance. When
   *  provided, each API result row gets a tappable info button that opens the
   *  Course Detail screen for that course. Local courses don't have detail
   *  pages so the affordance is hidden for them. */
  onInfo?: (courseId: string) => void;
}

// ─── Local fallback courses ────────────────────────────────────────────────────

const LOCAL_COURSES: PickedCourse[] = [
  { id: 'local:palms', name: 'Palms', fullName: 'Palms Golf Course', isLocal: true },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function CoursePicker({ onSelect, selected, onInfo }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ id: string; club_name: string; course_name: string; location: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback(async (q: string) => {
    if (q.trim().length < 3) {
      setResults([]);
      setSearched(false);
      return;
    }
    setLoading(true);
    const found = await searchCourses(q.trim());
    // Filter out error sentinels before setting results
    setResults(found.filter(r => !r._error));
    if (found.length === 1 && found[0]._error) {
      setSearchError(found[0]._error);
    } else {
      setSearchError(null);
    }
    setSearched(true);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(query), 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, runSearch]);

  const selectApiResult = (r: { id: string; club_name: string; course_name: string; location: string }) => {
    onSelect({
      id: r.id,
      name: r.club_name,
      fullName: `${r.club_name} — ${r.location}`,
      isLocal: false,
    });
  };

  const selectLocal = (c: PickedCourse) => onSelect(c);

  return (
    <View style={styles.root}>
      {/* Selected display */}
      {selected && (
        <View style={styles.selectedRow}>
          <Text style={styles.selectedIcon}>{selected.isLocal ? '📍' : '🔍'}</Text>
          <View style={styles.selectedText}>
            <Text style={styles.selectedName} numberOfLines={1}>{selected.name}</Text>
            {!selected.isLocal && (
              <Text style={styles.selectedSub} numberOfLines={1}>{selected.fullName}</Text>
            )}
          </View>
          <TouchableOpacity onPress={() => onSelect(null)} style={styles.clearBtn}>
            <Text style={styles.clearBtnText}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Search input */}
      <TextInput
        style={styles.input}
        placeholder="Search any US course..."
        placeholderTextColor="#4b5563"
        value={query}
        onChangeText={setQuery}
        autoCorrect={false}
        autoCapitalize="words"
        returnKeyType="search"
      />

      {/* Loading */}
      {loading && (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color="#00C896" />
          <Text style={styles.loadingText}>Searching...</Text>
        </View>
      )}

      {/* API results */}
      {!loading && searched && searchError && (
        <View style={styles.searchErrorBlock}>
          <Text style={styles.searchError}>{searchError}</Text>
          {/* Make the failure mode actionable rather than silent. The
              most common cause is GOLFCOURSE_API_KEY missing or expired
              on the Vercel deployment — surface that explicitly so a
              tester can flag it instead of assuming the app is broken. */}
          <Text style={styles.searchErrorHint}>
            {searchError.toLowerCase().includes('api key') || searchError.toLowerCase().includes('not set')
              ? 'Course-search API key is not configured on the server. Use a course from the local list below for now.'
              : 'Check your network — or pick a course from the local list below.'}
          </Text>
        </View>
      )}
      {!loading && searched && !searchError && results.length === 0 && (
        <Text style={styles.noResults}>No courses found. Try a different name or city.</Text>
      )}

      {!loading && results.length > 0 && (
        <ScrollView style={styles.results} nestedScrollEnabled keyboardShouldPersistTaps="handled">
          {results.map((r) => (
            <View key={r.id} style={styles.resultRowWrap}>
              <TouchableOpacity
                style={[styles.resultRow, styles.resultRowFlex, selected?.id === r.id && styles.resultRowActive]}
                onPress={() => selectApiResult(r)}
                activeOpacity={0.75}
              >
                <Text style={styles.resultName} numberOfLines={1}>{r.club_name}</Text>
                <Text style={styles.resultSub} numberOfLines={1}>{r.location}</Text>
              </TouchableOpacity>
              {onInfo && (
                <TouchableOpacity
                  onPress={() => onInfo(r.id)}
                  style={styles.infoBtn}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Course detail for ${r.club_name}`}
                >
                  <Text style={styles.infoBtnText}>i</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
        </ScrollView>
      )}

      {/* Local courses + manual option */}
      {!loading && query.trim().length < 3 && (
        <View style={styles.localSection}>
          <Text style={styles.localLabel}>RECENT / LOCAL</Text>
          {LOCAL_COURSES.map((c) => (
            <TouchableOpacity
              key={c.id}
              style={[styles.resultRow, selected?.id === c.id && styles.resultRowActive]}
              onPress={() => selectLocal(c)}
              activeOpacity={0.75}
            >
              <Text style={styles.resultName}>{c.name}</Text>
              <Text style={styles.resultSub}>Local data</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            style={[styles.resultRow, selected === null && styles.resultRowSkip]}
            onPress={() => onSelect(null)}
            activeOpacity={0.75}
          >
            <Text style={styles.skipText}>Skip — manual round (no course data)</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    gap: 6,
  },
  selectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0d2b1c',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#00C89644',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  selectedIcon: { fontSize: 16 },
  selectedText: { flex: 1 },
  selectedName: {
    color: '#e8f5e9',
    fontSize: 14,
    fontWeight: '700',
  },
  selectedSub: {
    color: '#6b7280',
    fontSize: 11,
    marginTop: 1,
  },
  clearBtn: {
    padding: 4,
  },
  clearBtnText: {
    color: '#6b7280',
    fontSize: 14,
  },
  input: {
    backgroundColor: '#0a1e12',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e3a28',
    color: '#e8f5e9',
    fontSize: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  loadingText: {
    color: '#6b7280',
    fontSize: 12,
  },
  noResults: {
    color: '#6b7280',
    fontSize: 12,
    paddingVertical: 4,
  },
  searchError: {
    color: '#f87171',
    fontSize: 12,
    fontWeight: '700',
  },
  searchErrorBlock: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(248, 113, 113, 0.08)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(248, 113, 113, 0.35)',
    marginBottom: 8,
    gap: 4,
  },
  searchErrorHint: {
    color: '#fca5a5',
    fontSize: 11,
    lineHeight: 15,
  },
  results: {
    maxHeight: 180,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e3a28',
    overflow: 'hidden',
  },
  resultRowWrap: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: '#0a1e12',
    borderBottomWidth: 1,
    borderBottomColor: '#1e3a28',
  },
  resultRowFlex: {
    flex: 1,
    borderBottomWidth: 0,
  },
  infoBtn: {
    width: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: 1,
    borderLeftColor: '#1e3a28',
  },
  infoBtnText: {
    color: '#00C896',
    fontSize: 14,
    fontWeight: '800',
    fontStyle: 'italic',
    fontFamily: 'serif',
  },
  resultRow: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1e3a28',
    backgroundColor: '#0a1e12',
  },
  resultRowActive: {
    backgroundColor: '#0d2b1c',
    borderBottomColor: '#00C89622',
  },
  resultRowSkip: {
    backgroundColor: 'transparent',
  },
  resultName: {
    color: '#e8f5e9',
    fontSize: 13,
    fontWeight: '600',
  },
  resultSub: {
    color: '#6b7280',
    fontSize: 11,
    marginTop: 1,
  },
  localSection: {
    gap: 4,
  },
  localLabel: {
    color: '#4b5563',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: 4,
    marginBottom: 2,
  },
  skipText: {
    color: '#6b7280',
    fontSize: 12,
    fontStyle: 'italic',
  },
});
