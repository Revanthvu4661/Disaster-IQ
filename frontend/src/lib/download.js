/** CSV and PNG export helpers used by the chart cards and tables. */

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

const escapeCell = (value) => {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** Serialise an array of objects to CSV text. */
export function toCsv(rows, columns) {
  if (!rows?.length) return ''
  const keys = columns ?? Object.keys(rows[0])
  const header = keys.join(',')
  const body = rows.map((row) => keys.map((key) => escapeCell(row[key])).join(','))
  return [header, ...body].join('\n')
}

export function downloadCsv(rows, filename, columns) {
  const csv = toCsv(rows, columns)
  if (!csv) return false
  saveBlob(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), filename)
  return true
}

/**
 * Rasterise the first SVG inside `element` and save it as a PNG.
 *
 * Recharts renders to SVG, so the chart is serialised, drawn onto a canvas at
 * 2x for a crisp export, and filled with the current page background first.
 */
export async function downloadChartPng(element, filename) {
  const svg = element?.querySelector('svg')
  if (!svg) return false

  const clone = svg.cloneNode(true)
  const { width, height } = svg.getBoundingClientRect()
  clone.setAttribute('width', width)
  clone.setAttribute('height', height)
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')

  const styles = getComputedStyle(document.documentElement)
  // Inline the token values: an exported file has no access to the stylesheet.
  const serialised = new XMLSerializer()
    .serializeToString(clone)
    .replace(/var\((--[a-z0-9-]+)\)/gi, (match, name) =>
      styles.getPropertyValue(name).trim() || match,
    )

  const image = new Image()
  const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialised)}`

  await new Promise((resolve, reject) => {
    image.onload = resolve
    image.onerror = reject
    image.src = svgUrl
  })

  const scale = 2
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(width, 1) * scale
  canvas.height = Math.max(height, 1) * scale
  const context = canvas.getContext('2d')
  context.scale(scale, scale)
  context.fillStyle = styles.getPropertyValue('--surface').trim() || '#ffffff'
  context.fillRect(0, 0, width, height)
  context.drawImage(image, 0, 0, width, height)

  await new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (blob) saveBlob(blob, filename)
      resolve()
    }, 'image/png')
  })
  return true
}
