// The public release marker is independent of the product version, so a fix can
// stay on v1.3.1 while an already open tab can still detect the new deployment.
export async function hasWebUpdate(currentBuild: string, request: typeof fetch = fetch) {
  if (!currentBuild) return false
  try {
    const response = await request(`/version.json?_check=${Date.now()}`, {
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) return false
    const release = await response.json()
    return (
      typeof release?.version === 'string' &&
      typeof release?.revision === 'string' &&
      release.revision.length > 0 &&
      release.revision !== currentBuild
    )
  } catch {
    // A transient network failure or an older server is not a new release.
    return false
  }
}
