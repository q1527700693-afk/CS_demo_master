import { featureFlags } from './config'
import { createModuleNavigation, createModuleRoutes, moduleView } from './module-system'
import type { FeatureModule } from './module-system'

// One registration point for routes, navigation and release availability.
// Business pages, APIs and data contracts stay in their own feature folders.
export const featureModules: FeatureModule[] = [
  {
    id: 'overview',
    title: '总览',
    enabled: true,
    navigation: { path: '/', label: '总览', icon: 'overview', order: 10 },
    routes: [
      {
        path: '/',
        name: 'overview',
        component: moduleView(() => import('@/features/overview/OverviewPage.vue')),
        meta: { title: '总览' },
      },
    ],
  },
  {
    id: 'auth',
    title: '账号登录',
    enabled: true,
    routes: [
      {
        path: '/login',
        name: 'login',
        component: moduleView(() => import('@/features/auth/AuthPage.vue')),
        meta: { title: '登录 / 注册' },
      },
    ],
  },
  {
    id: 'replay',
    title: '复盘',
    enabled: featureFlags.replay,
    navigation: { path: '/replays', label: '我的复盘', icon: 'replay', order: 20 },
    routes: [
      {
        path: '/replays',
        name: 'replays',
        component: moduleView(() => import('@/features/replay/ReplayListPage.vue')),
        meta: { title: '我的复盘', requiresAuth: true },
      },
      {
        path: '/replays/new',
        name: 'upload',
        component: moduleView(() => import('@/features/replay/UploadPage.vue')),
        meta: { title: '新建复盘', requiresAuth: true },
      },
      {
        path: '/replays/:id',
        name: 'report',
        component: moduleView(() => import('@/features/replay/ReportPage.vue')),
        meta: { title: '复盘报告', requiresAuth: true },
      },
    ],
  },
  {
    id: 'training',
    title: '瞄准训练',
    enabled: featureFlags.training,
    navigation: {
      path: '/training',
      label: '瞄准训练',
      icon: 'crosshair',
      order: 30,
      badge: 'PLAY',
    },
    routes: [
      {
        path: '/training',
        name: 'training',
        component: moduleView(() => import('@/features/training/TrainingPage.vue')),
        meta: { title: '瞄准训练' },
      },
      { path: '/training/:mode', name: 'game', redirect: '/training' },
    ],
  },
  {
    id: 'lobby',
    title: '校园车队',
    enabled: featureFlags.lobby,
    navigation: { path: '/lobbies', label: '校园车队', icon: 'users', order: 40 },
    routes: [
      {
        path: '/lobbies',
        name: 'lobbies',
        component: moduleView(() => import('@/features/lobby/LobbyPage.vue')),
        meta: { title: '校园车队' },
      },
    ],
  },
  {
    id: 'social',
    title: '玩家与好友',
    enabled: featureFlags.social,
    navigation: { path: '/friends', label: '玩家与好友', icon: 'users', order: 45 },
    routes: [
      {
        path: '/friends',
        name: 'friends',
        component: moduleView(() => import('@/features/social/FriendsPage.vue')),
        meta: { title: '玩家与好友', requiresAuth: true },
      },
      {
        path: '/players/:userId',
        name: 'player-card',
        component: moduleView(() => import('@/features/player/PlayerCardPage.vue')),
        meta: { title: '玩家名片' },
      },
    ],
  },
  {
    id: 'profile',
    title: '个人中心',
    enabled: featureFlags.profile,
    navigation: { path: '/profile', label: '个人中心', icon: 'user', order: 50 },
    routes: [
      {
        path: '/profile',
        name: 'profile',
        component: moduleView(() => import('@/features/profile/ProfilePage.vue')),
        meta: { title: '个人中心', requiresAuth: true },
      },
    ],
  },
]

export const moduleNavigation = createModuleNavigation(featureModules)
export const moduleRoutes = createModuleRoutes(featureModules)
