import { defineStore } from 'pinia'
import { ref } from 'vue'
export const useToastStore = defineStore('toast', () => {
  const messages = ref<{ id: number; text: string; kind: 'success' | 'error' }[]>([])
  let sequence = 0
  function show(text: string, kind: 'success' | 'error' = 'success') {
    const id = ++sequence
    messages.value.push({ id, text, kind })
    window.setTimeout(() => {
      messages.value = messages.value.filter((item) => item.id !== id)
    }, 4500)
  }
  return { messages, show }
})
