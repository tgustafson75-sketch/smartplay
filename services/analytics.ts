import * as Sentry from '@sentry/react-native';

const hasDsn = !!process.env.EXPO_PUBLIC_SENTRY_DSN;

export function track(event: string, properties?: Record<string, unknown>): void {
  if (hasDsn) {
    Sentry.addBreadcrumb({ message: event, data: properties, level: 'info' });
  } else {
    console.log('[analytics]', event, properties ?? '');
  }
}

export function identify(userId: string, traits?: Record<string, unknown>): void {
  if (hasDsn) {
    Sentry.setUser({ id: userId, ...traits });
  }
}

export function captureError(err: unknown, context?: Record<string, unknown>): void {
  if (hasDsn) {
    Sentry.withScope(scope => {
      if (context) scope.setExtras(context);
      Sentry.captureException(err);
    });
  } else {
    console.error('[analytics:error]', err, context ?? '');
  }
}
