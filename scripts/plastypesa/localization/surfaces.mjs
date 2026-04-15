import {
  PUBLIC_WEB_ROUTES,
  SUPPORTED_MOBILE_LOCALES,
  SUPPORTED_WEB_LANGUAGES,
  defaultAdminFrontendRoot,
  defaultAdminRepoRoot,
  defaultMobileRoot,
} from './config.mjs';

export function buildSurfaceInventory() {
  const adminRepoRoot = defaultAdminRepoRoot();
  const adminFrontendRoot = defaultAdminFrontendRoot();
  const mobileRoot = defaultMobileRoot();

  return {
    generatedAt: new Date().toISOString(),
    roots: {
      neoxten: {
        path: 'C:/Users/Bobby/Documents/NeoXten-Automation-Framework',
        purpose: 'Cross-repo automation, orchestration, and audit reporting',
      },
      adminRepo: {
        path: adminRepoRoot,
        purpose: 'Public landing page, legal pages, and internal operator dashboard',
      },
      mobileRepo: {
        path: mobileRoot,
        purpose: 'Flutter user app and device-facing localization surfaces',
      },
    },
    web: {
      supportedLanguages: [...SUPPORTED_WEB_LANGUAGES],
      frontendRoot: adminFrontendRoot,
      translationSources: [
        `${adminFrontendRoot}/src/i18n/config.ts`,
        `${adminFrontendRoot}/public/locales/<lang>/*.json`,
      ],
      routes: PUBLIC_WEB_ROUTES.map((route) => ({
        ...route,
        coverage: route.localized
          ? 'Audit once per supported locale'
          : 'Audit in default route only',
      })),
      surfaces: [
        {
          id: 'landing-page',
          path: `${adminFrontendRoot}/src/pages/LandingPage`,
          components: [
            'HeroSection',
            'PlastyPesaDifference',
            'FeaturesSection',
            'HowItWorkSection',
            'LeaderboardTeaser',
            'CTASection',
            'EnvironmentalImpact',
            'BecomeCollector',
            'TestimonialsSection',
            'EcoWinsWall',
            'CommunitySignup',
            'FAQSection',
            'Footer',
            'MobileDownloadBar',
            'Navbar',
          ],
        },
        {
          id: 'seo-meta',
          path: `${adminFrontendRoot}/src/components/SEOHead.tsx`,
          components: ['SEOHead'],
        },
        {
          id: 'legal-pages',
          path: `${adminFrontendRoot}/src/pages/PrivacyPolicy`,
          components: ['PrivacyPolicy'],
        },
        {
          id: 'language-switcher',
          path: `${adminFrontendRoot}/src/components/LanguageSwitcher.tsx`,
          components: ['LanguageSwitcher', 'LanguageWrapper'],
        },
      ],
      notes: [
        'Internal admin dashboard routes are currently English-only and are tracked as a separate localization decision.',
        'Landing page and legal pages use route-prefixed locales via /:lang.',
        'API-driven landing content can leak English independently of locale JSON quality.',
      ],
    },
    mobile: {
      supportedLocales: [...SUPPORTED_MOBILE_LOCALES],
      appRoot: mobileRoot,
      translationSources: [
        `${mobileRoot}/lib/core/translations/app_translations.dart`,
        `${mobileRoot}/lib/core/translations/en.dart`,
        `${mobileRoot}/lib/core/translations/it.dart`,
        `${mobileRoot}/lib/core/translations/es.dart`,
        `${mobileRoot}/lib/core/translations/de.dart`,
        `${mobileRoot}/lib/core/translations/fr.dart`,
        `${mobileRoot}/lib/core/translations/pt.dart`,
        `${mobileRoot}/lib/core/translations/ro.dart`,
      ],
      shellScreens: [
        {
          id: 'initial-language',
          path: `${mobileRoot}/lib/features/user/auth/initial_language_screen.dart`,
          entry: 'Cold start without token',
        },
        {
          id: 'login',
          path: `${mobileRoot}/lib/features/user/auth/user_login_screen.dart`,
          entry: 'Initial language screen continue path',
        },
        {
          id: 'home',
          path: `${mobileRoot}/lib/features/user/home/user_home_screen.dart`,
          entry: 'Bottom nav index 0',
        },
        {
          id: 'learn',
          path: `${mobileRoot}/lib/features/user/learn/learn_screen.dart`,
          entry: 'Bottom nav index 1',
        },
        {
          id: 'quiz',
          path: `${mobileRoot}/lib/features/user/game/screen/game_main_screen.dart`,
          entry: 'Bottom nav index 2',
        },
        {
          id: 'activity',
          path: `${mobileRoot}/lib/features/user/activity/activity_screen.dart`,
          entry: 'Bottom nav index 3',
        },
        {
          id: 'community-hub',
          path: `${mobileRoot}/lib/features/user/features/features_screen.dart`,
          entry: 'Bottom nav index 4',
        },
        {
          id: 'profile',
          path: `${mobileRoot}/lib/features/user/profile/your_profile_screen.dart`,
          entry: 'Bottom nav index 5',
        },
      ],
      highRiskDetailScreens: [
        `${mobileRoot}/lib/features/user/points/points_screen.dart`,
        `${mobileRoot}/lib/features/user/leaderboard/leaderboard_screen.dart`,
        `${mobileRoot}/lib/features/user/pledge/pledge_screen.dart`,
        `${mobileRoot}/lib/features/user/sort/sort_proof_screen.dart`,
        `${mobileRoot}/lib/features/user/community/community_feed_screen.dart`,
        `${mobileRoot}/lib/features/user/community/create_post_screen.dart`,
        `${mobileRoot}/lib/features/user/game/screen/quiz_screen.dart`,
      ],
      apiDrivenContent: [
        {
          route: 'home/landing-data',
          note: 'Landing-style feed strings and featured posts can leak backend English into localized UI.',
        },
        {
          route: 'community/feed',
          note: 'Community posts and server-sourced categories appear in the mobile hub and feed.',
        },
        {
          route: 'home/leaderboard',
          note: 'Leaderboard data mixes localized shell copy with API point totals and winner metadata.',
        },
        {
          route: 'notification/my',
          note: 'Announcements and in-app banners can surface author-controlled text.',
        },
      ],
      notes: [
        'GetX locale selection comes from GetStorage key "language" and Get.updateLocale.',
        'Device audit should preserve and restore local session state after test runs.',
        'Guest and authenticated surfaces need separate coverage.',
      ],
    },
    remediationOrder: [
      'Source English and product glossary',
      'Localization wiring and hardcoded UI strings',
      'Per-language translation cleanup',
      'Automated rerun and manual screenshot review',
    ],
  };
}
