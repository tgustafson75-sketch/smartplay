// Translation hook — built in Day 15

export const useTranslation = () => ({
  t: (key: string) => key,
  locale: 'en' as 'en' | 'es' | 'zh',
});
