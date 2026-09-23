/**
 * 2026-09-23 (Tim) — "you could watch a progress on the load of the course live on the card and then
 * once it's done it could be added to your courses."
 *
 * Rendered for real from the store the pipeline writes: a building course shows its stage, a finished
 * one says it is in Your courses with its measured green count (and says so honestly when there are
 * none), and a failed build shows why. Nothing renders for a course that was never touched.
 */
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../../i18n/locales/en.json';
import CourseBuildProgress from '../../components/course/CourseBuildProgress';
import { useDownloadedCoursesStore } from '../../store/downloadedCoursesStore';

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    lng: 'en', fallbackLng: 'en', resources: { en: { translation: en } },
    interpolation: { escapeValue: false },
  });
});

describe('the course card shows the build', () => {
  beforeEach(() => { useDownloadedCoursesStore.setState({ downloaded: {}, downloading: {} } as never); });

  it('shows the stage while it builds, under the id the card holds', () => {
    useDownloadedCoursesStore.getState().markDownloading('place:abc', 'Grassy Hill', 0.4, 'map');
    render(<CourseBuildProgress ids={['place:abc']} />);
    expect(screen.getByText('Mapping the greens…')).toBeTruthy();
  });

  it('says it is in Your courses, with the greens actually mapped', () => {
    useDownloadedCoursesStore.getState().markDownloaded({ courseId: 'gh', name: 'Grassy Hill', holeCount: 18, at: 1, greens: 18 });
    render(<CourseBuildProgress ids={['gh']} />);
    expect(screen.getByText(/18 greens mapped · in Your courses/)).toBeTruthy();
  });

  it('one green reads as one green', () => {
    useDownloadedCoursesStore.getState().markDownloaded({ courseId: 'one', name: 'One', holeCount: 9, at: 1, greens: 1 });
    render(<CourseBuildProgress ids={['one']} />);
    expect(screen.getByText('Ready · 1 green mapped · in Your courses')).toBeTruthy();
  });

  it('never claims a green map it does not have', () => {
    useDownloadedCoursesStore.getState().markDownloaded({ courseId: 'hemet', name: 'Hemet', holeCount: 18, at: 1, greens: 0 });
    render(<CourseBuildProgress ids={['hemet']} />);
    expect(screen.queryByText(/greens mapped/)).toBeNull();
    expect(screen.getByText(/yardages are estimates/)).toBeTruthy();
  });

  it('an older record with no green count claims no number', () => {
    useDownloadedCoursesStore.getState().markDownloaded({ courseId: 'old', name: 'Old', holeCount: 18, at: 1 });
    render(<CourseBuildProgress ids={['old']} />);
    expect(screen.queryByText(/greens mapped/)).toBeNull();
    expect(screen.getByText('Ready · in Your courses')).toBeTruthy();
  });

  it('shows why a build failed', () => {
    useDownloadedCoursesStore.getState().markBuildFailed('place:x', 'Nowhere', "Couldn't find Nowhere in the course database");
    render(<CourseBuildProgress ids={['place:x']} />);
    expect(screen.getByText(/Couldn't find Nowhere/)).toBeTruthy();
  });

  it('renders nothing for a course nobody touched', () => {
    const { toJSON } = render(<CourseBuildProgress ids={['untouched']} />);
    expect(toJSON()).toBeNull();
  });
});
