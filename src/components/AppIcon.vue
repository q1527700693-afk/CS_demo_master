<script setup lang="ts">
withDefaults(defineProps<{ name: string; size?: number }>(), { size: 20 })
const paths: Record<string, string[]> = {
  crosshair: ['M12 2v4m0 12v4M2 12h4m12 0h4', 'M18 12a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z'],
  overview: ['M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z'],
  replay: ['M5 3h10l4 4v14H5z', 'M14 3v5h5M9 12l6 3-6 3z'],
  users: [
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87',
    'M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM17 3a4 4 0 0 1 0 8',
  ],
  user: ['M20 21v-2a7 7 0 0 0-14 0v2', 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z'],
  arrow: ['M4 12h16m-6-6 6 6-6 6'],
  up: ['M7 17 17 7M7 7h10v10'],
  plus: ['M12 5v14M5 12h14'],
  upload: ['M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5'],
  check: ['m5 12 4 4L19 6'],
  clock: ['M12 8v5l3 2', 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z'],
  shield: ['m12 3 8 4v6c0 5-8 9-8 9S4 18 4 13V7z', 'm8 12 3 3 5-5'],
  menu: ['M3 6h18M3 12h18M3 18h18'],
  close: ['m6 6 12 12M6 18 18 6'],
  logout: ['M9 4H4v16h5m5-13 5 5-5 5M9 12h10'],
  bolt: ['m13 2-9 12h7l-1 8 10-12h-7z'],
  map: ['m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15'],
  target: [
    'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
    'M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0ZM12 12h.01',
  ],
  download: ['M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4'],
  search: ['M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0Zm-1 5 6 6'],
  copy: ['M9 9h12v12H9z', 'M5 15H3V3h12v2'],
  link: ['m10 13 4-4', 'M8 16H6a4 4 0 0 1 0-8h4M14 8h4a4 4 0 0 1 0 8h-4'],
}
</script>
<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.65"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path v-for="(path, index) in paths[name] || paths.crosshair" :key="index" :d="path" />
  </svg>
</template>
