import { describe, expect, it, vi } from 'vitest'
import { createModuleNavigation, createModuleRoutes, moduleView } from './module-system'
import type { FeatureModule } from './module-system'

describe('independently replaceable feature modules', () => {
  it('hides a disabled module from navigation and prevents direct links from loading it', async () => {
    const realPage = vi.fn(async () => ({ default: {} }))
    const disabled: FeatureModule = {
      id: 'example',
      title: '示例',
      enabled: false,
      navigation: { path: '/example', label: '示例', icon: 'user', order: 10 },
      routes: [
        { path: '/example', name: 'example', component: realPage, meta: { requiresAuth: true } },
      ],
    }
    expect(createModuleNavigation([disabled])).toEqual([])
    const route = createModuleRoutes([disabled])[0]
    expect(route.path).toBe('/example')
    expect(route.name).toBe('example')
    expect(route.meta).toMatchObject({ featureId: 'example', title: '示例' })
    expect(route.meta?.requiresAuth).toBeUndefined()
    expect(route.component).not.toBe(realPage)
    expect(realPage).not.toHaveBeenCalled()
  })

  it('retains enabled modules guards and legacy redirects while ordering navigation', () => {
    const modules: FeatureModule[] = [
      {
        id: 'b',
        title: 'B',
        enabled: true,
        navigation: { path: '/b', label: 'B', icon: 'user', order: 20 },
        routes: [{ path: '/b', component: {}, meta: { requiresAuth: true } }],
      },
      {
        id: 'a',
        title: 'A',
        enabled: true,
        navigation: { path: '/a', label: 'A', icon: 'user', order: 10 },
        routes: [{ path: '/a/:id', redirect: '/a' }],
      },
    ]
    expect(createModuleNavigation(modules).map((item) => item.path)).toEqual(['/a', '/b'])
    const routes = createModuleRoutes(modules)
    expect(routes[0].meta?.requiresAuth).toBe(true)
    expect(routes[1].redirect).toBe('/a')
  })

  it('falls back on a failed module import without affecting a healthy module', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const failed = await moduleView(() => Promise.reject(new Error('network offline')))()
      expect(failed.default).toBeTruthy()
      const healthy = { default: {} }
      expect(await moduleView(async () => healthy)()).toBe(healthy)
    } finally {
      log.mockRestore()
    }
  })
})
