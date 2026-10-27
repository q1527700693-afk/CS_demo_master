// The same projection and sphere geometry are used by rendering, input and scoring.
export const EYE_HEIGHT = 2.7;
export const WORLD_SCALE = 0.012;
export const DEGREES_PER_COUNT = 0.022;
export const radians = degrees => degrees * Math.PI / 180;
export function targetWorld(target) {
  return { x: (target.x - 500) * WORLD_SCALE,
    y: EYE_HEIGHT + (281.25 - target.y) * WORLD_SCALE,
    z: -(10 + ((target.id || 1) % 3) * 2), radius: target.radius * WORLD_SCALE };
}
export function lookRay(look) {
  return { x: -Math.sin(look.yaw) * Math.cos(look.pitch), y: Math.sin(look.pitch), z: -Math.cos(look.yaw) * Math.cos(look.pitch) };
}
export function rayHitsSphere(ray, target) {
  const center = targetWorld(target), y = center.y - EYE_HEIGHT;
  const along = center.x * ray.x + y * ray.y + center.z * ray.z;
  return along > 0 && center.x ** 2 + y ** 2 + center.z ** 2 - along ** 2 <= center.radius ** 2 + 1e-8;
}
export function projectTarget(target, aspect = 16 / 9, fov = 64) {
  const p = targetWorld(target), tangent = Math.tan(radians(fov) / 2);
  return { x: (p.x / -p.z / tangent / aspect + 1) * 500,
    y: (1 - (p.y - EYE_HEIGHT) / -p.z / tangent) * 281.25 };
}
