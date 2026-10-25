import { ApiError, errorMessage } from '@/api/http'
export function communityError(error: unknown) {
  if (!(error instanceof ApiError)) return errorMessage(error)
  if (error.status === 401) return '登录已失效，请重新登录。'
  if (error.status === 404) return '记录已被处理、删除或到期，请刷新后重试。'
  if (error.status === 409) return '状态已变化或操作重复，请刷新后重试。'
  if (error.status === 403)
    return error.message.includes('removed from this lobby')
      ? '你已被队长移出领码名单，无法再次领取该车队组队码。'
      : '当前账号没有权限执行此操作。'
  if (error.status === 400) return '填写内容不符合要求，请检查字段和人数范围。'
  return errorMessage(error)
}
