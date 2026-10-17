import { sep } from 'node:path'

// Runtime fonts are supplied by the operator, never copied into a product.
export function distributable(path) {
  const parts = path.split(sep)
  return !parts.includes('.local-fonts') && !/\.(?:ttf|otf|ttc|woff2?)$/i.test(path)
}
