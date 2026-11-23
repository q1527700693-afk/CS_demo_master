export const MAX_PACKAGE_SIZE = 50 * 1024 * 1024
export function validatePackage(file: Pick<File, 'name' | 'size'>): string | null {
  if (!file.name.toLowerCase().endsWith('.zip'))
    return '此入口只接受本地解析工具生成的 .zip 分析包，不能直接选择 .dem。原始 Demo 应使用“从本地 Demo 开始”。'
  if (file.size === 0) return '文件为空，请重新导出数据包。'
  if (file.size > MAX_PACKAGE_SIZE) return '当前前端限制为 50 MB，请减少位置采样后重新导出。'
  return null
}
export const terminalStatus = (status: string) => ['completed', 'partial', 'failed'].includes(status)
