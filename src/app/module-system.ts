import type { Component } from 'vue'
import type { RouteRecordRaw } from 'vue-router'
import ModuleLoadError from '@/features/ModuleLoadError.vue'

export interface ModuleNavigation {
  path: string
  label: string
  icon: string
  order: number
  badge?: string
}

export interface FeatureModule {
  id: string
  title: string
  enabled: boolean
  navigation?: ModuleNavigation
  routes: RouteRecordRaw[]
}

type PageModule = { default: Component }
type PageLoader = () => Promise<PageModule>

// Route imports may fail after a deployment or on a dropped connection. Keep
// the app shell usable and offer an explicit reload instead of a blank page.
export function moduleView(load: PageLoader): PageLoader {
  return async () => {
    try {
      return await load()
    } catch (error) {
      console.error('Feature page failed to load:', error)
      return { default: ModuleLoadError }
    }
  }
}

export function createModuleNavigation(modules: FeatureModule[]): ModuleNavigation[] {
  return modules
    .filter((module) => module.enabled && module.navigation)
    .map((module) => module.navigation!)
    .sort((a, b) => a.order - b.order)
}

export function createModuleRoutes(modules: FeatureModule[]): RouteRecordRaw[] {
  return modules.flatMap((module) =>
    module.routes.map((route): RouteRecordRaw => {
      if (!module.enabled) {
        // Keep existing links meaningful, but don't load the disabled module's
        // real page, redirects or auth guards.
        return {
          path: route.path,
          name: route.name,
          component: () => import('@/features/ModuleUnavailable.vue'),
          meta: { title: route.meta?.title || module.title, featureId: module.id },
        }
      }
      return { ...route, meta: { ...route.meta, featureId: module.id } }
    }),
  )
}
