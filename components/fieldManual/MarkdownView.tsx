/**
 * Minimal markdown renderer for the in-app Field Manual.
 *
 * Handles the subset of markdown we actually use in docs/field-manual/:
 *   - Headings (#, ##, ###)
 *   - Paragraphs
 *   - Bullet lists (- item)
 *   - Tables (|---|---|---|) — rendered as monospace pre-blocks
 *   - Fenced code blocks (```)
 *   - Horizontal rules (---)
 *   - Inline: **bold**, `code`, [link](url)
 *
 * Intentionally tiny — no dependency on react-native-markdown-display
 * or similar; ships ~200 lines and renders 800-line manuals fine.
 *
 * 2026-05-24 — Built per Tim's note that Linking-to-GitHub was wrong UX.
 */

import React from 'react';
import { View, Text, StyleSheet, Linking } from 'react-native';

interface Props { source: string }

type Block =
  | { kind: 'h1' | 'h2' | 'h3'; text: string }
  | { kind: 'p'; text: string }
  | { kind: 'li'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'table'; rows: string[] }
  | { kind: 'hr' };

function parse(md: string): Block[] {
  const out: Block[] = [];
  const lines = md.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') { i++; continue; }
    if (line.startsWith('### ')) { out.push({ kind: 'h3', text: line.slice(4).trim() }); i++; continue; }
    if (line.startsWith('## '))  { out.push({ kind: 'h2', text: line.slice(3).trim() }); i++; continue; }
    if (line.startsWith('# '))   { out.push({ kind: 'h1', text: line.slice(2).trim() }); i++; continue; }
    if (line.trim() === '---')   { out.push({ kind: 'hr' }); i++; continue; }
    if (line.startsWith('```')) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) { body.push(lines[i]); i++; }
      i++; // skip closing fence
      out.push({ kind: 'code', text: body.join('\n') });
      continue;
    }
    if (line.startsWith('|') && lines[i + 1]?.startsWith('|') && lines[i + 1].includes('---')) {
      const rows: string[] = [];
      while (i < lines.length && lines[i].startsWith('|')) { rows.push(lines[i]); i++; }
      out.push({ kind: 'table', rows });
      continue;
    }
    if (line.startsWith('- ')) {
      // Collect contiguous list items; preserve indented continuation.
      const text: string[] = [line.slice(2)];
      i++;
      while (i < lines.length && (lines[i].startsWith('  ') || (!lines[i].startsWith('- ') && !lines[i].startsWith('#') && lines[i].trim() !== '' && !lines[i].startsWith('|') && !lines[i].startsWith('```')))) {
        if (lines[i].startsWith('  ')) text.push(lines[i].trim());
        else break;
        i++;
      }
      out.push({ kind: 'li', text: text.join(' ') });
      continue;
    }
    // Default: paragraph (may span multiple non-blank lines).
    const para: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== '' && !lines[i].startsWith('#') && !lines[i].startsWith('- ') && !lines[i].startsWith('|') && !lines[i].startsWith('```') && lines[i].trim() !== '---') {
      para.push(lines[i]);
      i++;
    }
    out.push({ kind: 'p', text: para.join(' ') });
  }
  return out;
}

interface InlineToken { kind: 'text' | 'bold' | 'code' | 'link'; text: string; href?: string }

function tokenizeInline(s: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let i = 0;
  while (i < s.length) {
    // Link: [text](url)
    if (s[i] === '[') {
      const close = s.indexOf(']', i + 1);
      if (close > -1 && s[close + 1] === '(') {
        const urlClose = s.indexOf(')', close + 2);
        if (urlClose > -1) {
          tokens.push({ kind: 'link', text: s.slice(i + 1, close), href: s.slice(close + 2, urlClose) });
          i = urlClose + 1;
          continue;
        }
      }
    }
    // Bold: **text**
    if (s[i] === '*' && s[i + 1] === '*') {
      const close = s.indexOf('**', i + 2);
      if (close > -1) {
        tokens.push({ kind: 'bold', text: s.slice(i + 2, close) });
        i = close + 2;
        continue;
      }
    }
    // Inline code: `text`
    if (s[i] === '`') {
      const close = s.indexOf('`', i + 1);
      if (close > -1) {
        tokens.push({ kind: 'code', text: s.slice(i + 1, close) });
        i = close + 1;
        continue;
      }
    }
    // Plain run — accumulate until the next special.
    let next = s.length;
    for (const ch of ['[', '*', '`']) {
      const at = s.indexOf(ch, i);
      if (at !== -1 && at < next) next = at;
    }
    if (next === i) next = i + 1; // safety
    tokens.push({ kind: 'text', text: s.slice(i, next) });
    i = next;
  }
  return tokens;
}

function InlineRun({ s }: { s: string }) {
  const tokens = tokenizeInline(s);
  return (
    <Text style={styles.p}>
      {tokens.map((t, idx) => {
        if (t.kind === 'bold') return <Text key={idx} style={styles.bold}>{t.text}</Text>;
        if (t.kind === 'code') return <Text key={idx} style={styles.codeInline}>{t.text}</Text>;
        if (t.kind === 'link') return (
          <Text key={idx} style={styles.link} onPress={() => { if (t.href && /^https?:\/\//.test(t.href)) void Linking.openURL(t.href).catch(() => undefined); }}>
            {t.text}
          </Text>
        );
        return <Text key={idx}>{t.text}</Text>;
      })}
    </Text>
  );
}

export default function MarkdownView({ source }: Props) {
  const blocks = parse(source);
  return (
    <View style={{ padding: 16 }}>
      {blocks.map((b, idx) => {
        if (b.kind === 'h1') return <Text key={idx} style={styles.h1}>{b.text}</Text>;
        if (b.kind === 'h2') return <Text key={idx} style={styles.h2}>{b.text}</Text>;
        if (b.kind === 'h3') return <Text key={idx} style={styles.h3}>{b.text}</Text>;
        if (b.kind === 'hr') return <View key={idx} style={styles.hr} />;
        if (b.kind === 'code') return <Text key={idx} style={styles.codeBlock}>{b.text}</Text>;
        if (b.kind === 'li') return (
          <View key={idx} style={styles.liRow}>
            <Text style={styles.bullet}>•</Text>
            <View style={{ flex: 1 }}><InlineRun s={b.text} /></View>
          </View>
        );
        if (b.kind === 'table') {
          // Render as monospace pre-block. Tim's not reading a 4-column
          // table on phone with native-table fidelity anyway — readable
          // raw is good enough.
          return <Text key={idx} style={styles.codeBlock}>{b.rows.join('\n')}</Text>;
        }
        return <InlineRun key={idx} s={b.text} />;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  h1: { color: '#fff', fontSize: 22, fontWeight: '900', marginTop: 16, marginBottom: 12 },
  h2: { color: '#00C896', fontSize: 17, fontWeight: '800', marginTop: 18, marginBottom: 8 },
  h3: { color: '#e5e7eb', fontSize: 14, fontWeight: '700', marginTop: 14, marginBottom: 6, letterSpacing: 0.5 },
  p: { color: '#d1d5db', fontSize: 13, lineHeight: 20, marginBottom: 10 },
  bold: { fontWeight: '700', color: '#fff' },
  codeInline: { fontFamily: 'Courier', backgroundColor: '#0a1c12', color: '#9bf0c4', paddingHorizontal: 4, fontSize: 12 },
  codeBlock: { fontFamily: 'Courier', backgroundColor: '#0a1c12', color: '#9bf0c4', padding: 10, fontSize: 11, lineHeight: 16, marginVertical: 8, borderRadius: 6, borderWidth: 1, borderColor: '#1e3a28' },
  link: { color: '#00C896', textDecorationLine: 'underline' },
  hr: { height: 1, backgroundColor: '#1e3a28', marginVertical: 14 },
  liRow: { flexDirection: 'row', marginBottom: 6 },
  bullet: { color: '#00C896', width: 18, marginTop: 2, fontWeight: '900' },
});
