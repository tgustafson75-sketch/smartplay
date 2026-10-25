/**
 * 2026-10-24 (Tim) — SmartBay AI inside SwingLab: the bay's full lesson (baseline, one fix, a drill, a
 * retest) on the player's phone, with the sim-screen read a switch on the page (Range | Bay) instead of a
 * requirement. Contract and reasons: services/smartBayHost.ts. A finished lesson lands in practice
 * history through the same importBayLesson the .json import uses.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HostedWebApp } from '../../components/HostedWebApp';
import { SMARTBAY_ORIGIN, loadBayWhere, saveBayWhere, smartBayUrl, parseBayHostMessage } from '../../services/smartBayHost';
import { buildPlayerExport, importBayLesson, parseBayLesson } from '../../services/bayExchange';
import { derivePlayerId } from '../../store/swingSessionStore';
import { useToastStore } from '../../store/toastStore';

export default function SmartBayScreen() {
  const { t } = useTranslation();
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const where = await loadBayWhere();
      const player = await buildPlayerExport(Date.now()).catch(() => null);
      if (live) setUrl(smartBayUrl(where, player));
    })();
    return () => { live = false; };
  }, []);

  const onMessage = useCallback((raw: string) => {
    const m = parseBayHostMessage(raw);
    if (!m) return;
    if (m.type === 'smartbay:where') void saveBayWhere(m.where);
    if (m.type === 'smartbay:lesson') {
      const lesson = parseBayLesson(m.lesson);
      if (!lesson) return;
      const r = importBayLesson(lesson, derivePlayerId());
      if (r.ok && !r.duplicate) useToastStore.getState().show(t('hosted_web.lesson_added', { label: r.label }));
    }
  }, [t]);

  return <HostedWebApp title={t('hosted_web.smartbay_title')} url={url} origin={SMARTBAY_ORIGIN} needsCamera onMessage={onMessage} />;
}
