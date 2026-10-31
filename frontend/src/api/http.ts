import { apiBase, TOKEN_KEY } from '@/app/config'
import type { ApiResponse } from '@/types'

export class ApiError extends Error {
  constructor(
    message: string,
    public code = 50000,
    public status = 500,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}
function unwrap<T>(response: ApiResponse<T>, status: number): T {
  if (status < 200 || status >= 300 || response.code !== 0) {
    if (status === 401 && response.code === 40002) {
      localStorage.removeItem(TOKEN_KEY)
      window.dispatchEvent(new Event('auth:expired'))
    }
    throw new ApiError(response.message || '请求失败，请稍后重试', response.code, status)
  }
  return response.data
}
export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (options.body && !(options.body instanceof FormData))
    headers.set('Content-Type', 'application/json')
  let response: Response
  try {
    response = await fetch(`${apiBase}${path}`, {
      ...options,
      headers,
      signal: options.signal ?? AbortSignal.timeout(20_000),
    })
  } catch (error) {
    if (error instanceof DOMException && ['TimeoutError', 'AbortError'].includes(error.name))
      throw new ApiError('请求超时或已取消，请稍后重试', 50000, 504)
    throw new ApiError('无法连接服务，请检查网络或后端地址')
  }
  let body: ApiResponse<T>
  try {
    body = (await response.json()) as ApiResponse<T>
  } catch {
    throw new ApiError('服务返回格式不正确，请检查接口配置', 50000, response.status)
  }
  return unwrap(body, response.status)
}
export function upload<T>(
  path: string,
  file: File,
  onProgress: (value: number | null) => void,
  signal?: AbortSignal,
  fields: Record<string, string> = {},
  timeoutMs = 180_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const abort = () => xhr.abort()
    const cleanup = () => signal?.removeEventListener('abort', abort)
    signal?.addEventListener('abort', abort, { once: true })
    xhr.onloadend = cleanup
    xhr.onabort = () => reject(new DOMException('上传已取消', 'AbortError'))
    xhr.open('POST', `${apiBase}${path}`)
    // Import validation can wait in the backend queue for up to 150 seconds.
    xhr.timeout = timeoutMs
    const token = localStorage.getItem(TOKEN_KEY)
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.upload.onprogress = (event) => {
      onProgress(
        event.lengthComputable && event.total > 0
          ? Math.round((event.loaded / event.total) * 100)
          : null,
      )
    }
    xhr.onload = () => {
      try {
        resolve(unwrap<T>(JSON.parse(xhr.responseText) as ApiResponse<T>, xhr.status))
      } catch (error) {
        reject(error instanceof Error ? error : new ApiError('上传响应无法读取'))
      }
    }
    xhr.onerror = () => reject(new ApiError('上传连接失败，请稍后重试'))
    xhr.ontimeout = () => reject(new ApiError('上传超时，请检查网络后重试'))
    const form = new FormData()
    form.append('file', file)
    for (const [key, value] of Object.entries(fields)) form.append(key, value)
    if (signal?.aborted) {
      cleanup()
      reject(new DOMException('上传已取消', 'AbortError'))
      return
    }
    xhr.send(form)
  })
}
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : '发生未知错误，请重试'
