// Preview policy, independent of the game's device frame rate.
export const DEFAULT_PLAY_FPS = 30

export function validatePlayFps(value) {
  if (value !== 30 && value !== 60) throw new Error('fps must be 30 or 60')
  return value
}
