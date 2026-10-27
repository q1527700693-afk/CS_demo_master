export const apiBase = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '')
export const mockModules = {
  auth: import.meta.env.VITE_MOCK_AUTH === 'true',
  profile: import.meta.env.VITE_MOCK_PROFILE === 'true',
  replay: import.meta.env.VITE_MOCK_REPLAY !== 'false',
}
export const hasMocks = Object.values(mockModules).some(Boolean)
export const TOKEN_KEY = 'csdm.token'

// Release switches are independent of mock switches. Auth and the overview
// remain available so users can always sign in and return to the workspace.
export const featureFlags = {
  replay: import.meta.env.VITE_FEATURE_REPLAY !== 'false',
  profile: import.meta.env.VITE_FEATURE_PROFILE !== 'false',
  lobby: import.meta.env.VITE_FEATURE_LOBBY !== 'false',
  training: import.meta.env.VITE_FEATURE_TRAINING !== 'false',
  social: import.meta.env.VITE_FEATURE_SOCIAL !== 'false',
}
