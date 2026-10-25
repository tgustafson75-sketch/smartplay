/** 2026-10-24 (Tim — "link smartplay golf in the swinglab too") — SmartPlay Golf, the free 3D game, in app. */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { HostedWebApp } from '../../components/HostedWebApp';
import { SMARTPLAY_GOLF_URL } from '../../services/smartBayHost';

export default function SmartPlayGolfScreen() {
  const { t } = useTranslation();
  return <HostedWebApp title={t('hosted_web.golf_title')} url={`${SMARTPLAY_GOLF_URL}/?utm_source=smartplaycaddie&utm_medium=app&utm_campaign=swinglab`} origin={SMARTPLAY_GOLF_URL} />;
}
