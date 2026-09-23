import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

const projectRoot = resolve(import.meta.dirname, "..")
const sourcePath = resolve(projectRoot, "data/intramuros.generated.json")
const outputPath = resolve(projectRoot, "data/urban-blocks.generated.json")
const source = JSON.parse(await readFile(sourcePath, "utf8"))

const CELL_SIZE = 0.14
const STREET_PADDING = 0.08
const STYLES = [
  "stepped",
  "courtyard",
  "arcaded",
  "towered",
  "terraced",
  "bridged",
  "garden",
  "lookout",
  "cloister",
  "gabled",
]
const DISTRICTS = [
  { name: "Catedral", point: source.locations.cathedral },
  { name: "Plaza Mayor", point: source.locations.plazaMayor },
  { name: "San Nicolás", point: source.locations.mirabel },
  { name: "Santo Domingo", point: source.locations.santoDomingo },
  { name: "La Magdalena", point: source.locations.magdalena },
  { name: "Santa Ana", point: source.locations.santaAna },
  { name: "Torre Lucía", point: source.locations.torreLucia },
]

function pointInPolygon([x, z], polygon) {
  let inside = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const [xi, zi] = polygon[index]
    const [xj, zj] = polygon[previous]
    const intersects = zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi
    if (intersects) inside = !inside
  }
  return inside
}

function pointToSegmentDistance([px, pz], [ax, az], [bx, bz]) {
  const dx = bx - ax
  const dz = bz - az
  const lengthSquared = dx * dx + dz * dz
  const t = lengthSquared
    ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lengthSquared))
    : 0
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz))
}

function centroid(points) {
  let twiceArea = 0
  let x = 0
  let z = 0
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length]
    const factor = points[index][0] * next[1] - next[0] * points[index][1]
    twiceArea += factor
    x += (points[index][0] + next[0]) * factor
    z += (points[index][1] + next[1]) * factor
  }
  if (Math.abs(twiceArea) < 0.00001) {
    return [
      points.reduce((sum, point) => sum + point[0], 0) / points.length,
      points.reduce((sum, point) => sum + point[1], 0) / points.length,
    ]
  }
  return [x / (3 * twiceArea), z / (3 * twiceArea)]
}

function polygonArea(points) {
  let area = 0
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length]
    area += points[index][0] * next[1] - next[0] * points[index][1]
  }
  return Math.abs(area / 2)
}

function hashString(value) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

const streetSegments = source.streets.flatMap((street) =>
  street.points.slice(1).map((point, index) => ({
    a: street.points[index],
    b: point,
    width: street.width,
  })),
)
const boundaryXs = source.boundary.map((point) => point[0])
const boundaryZs = source.boundary.map((point) => point[1])
const minX = Math.min(...boundaryXs) - 0.5
const maxX = Math.max(...boundaryXs) + 0.5
const minZ = Math.min(...boundaryZs) - 0.5
const maxZ = Math.max(...boundaryZs) + 0.5
const columns = Math.ceil((maxX - minX) / CELL_SIZE)
const rows = Math.ceil((maxZ - minZ) / CELL_SIZE)
const cells = new Int32Array(columns * rows).fill(-3)

for (let row = 0; row < rows; row += 1) {
  for (let column = 0; column < columns; column += 1) {
    const point = [minX + (column + 0.5) * CELL_SIZE, minZ + (row + 0.5) * CELL_SIZE]
    if (!pointInPolygon(point, source.boundary)) continue
    const isStreet = streetSegments.some(
      (segment) => pointToSegmentDistance(point, segment.a, segment.b) < segment.width / 2 + STREET_PADDING,
    )
    cells[row * columns + column] = isStreet ? -3 : -1
  }
}

let regionCount = 0
const queueColumns = new Int32Array(columns * rows)
const queueRows = new Int32Array(columns * rows)
for (let row = 0; row < rows; row += 1) {
  for (let column = 0; column < columns; column += 1) {
    if (cells[row * columns + column] !== -1) continue
    let head = 0
    let tail = 0
    queueColumns[tail] = column
    queueRows[tail] = row
    tail += 1
    cells[row * columns + column] = regionCount
    while (head < tail) {
      const currentColumn = queueColumns[head]
      const currentRow = queueRows[head]
      head += 1
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nextColumn = currentColumn + dx
        const nextRow = currentRow + dz
        if (
          nextColumn < 0 ||
          nextColumn >= columns ||
          nextRow < 0 ||
          nextRow >= rows ||
          cells[nextRow * columns + nextColumn] !== -1
        ) continue
        cells[nextRow * columns + nextColumn] = regionCount
        queueColumns[tail] = nextColumn
        queueRows[tail] = nextRow
        tail += 1
      }
    }
    regionCount += 1
  }
}

function nearestRegion(point) {
  const originColumn = Math.max(0, Math.min(columns - 1, Math.floor((point[0] - minX) / CELL_SIZE)))
  const originRow = Math.max(0, Math.min(rows - 1, Math.floor((point[1] - minZ) / CELL_SIZE)))
  const direct = cells[originRow * columns + originColumn]
  if (direct >= 0) return direct
  for (let radius = 1; radius <= 18; radius += 1) {
    let best = null
    let bestDistance = Number.POSITIVE_INFINITY
    for (let dz = -radius; dz <= radius; dz += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (Math.abs(dx) !== radius && Math.abs(dz) !== radius) continue
        const column = originColumn + dx
        const row = originRow + dz
        if (column < 0 || column >= columns || row < 0 || row >= rows) continue
        const region = cells[row * columns + column]
        if (region < 0) continue
        const distance = dx * dx + dz * dz
        if (distance < bestDistance) {
          best = region
          bestDistance = distance
        }
      }
    }
    if (best !== null) return best
  }
  return -1
}

const buildingsByRegion = new Map()
for (const building of source.buildings) {
  const center = centroid(building.points)
  const region = nearestRegion(center)
  const key = region >= 0 ? region : `isolated-${building.id}`
  if (!buildingsByRegion.has(key)) buildingsByRegion.set(key, [])
  buildingsByRegion.get(key).push({ ...building, center, area: polygonArea(building.points) })
}

const rawBlocks = [...buildingsByRegion.values()].map((buildings) => {
  const points = buildings.flatMap((building) => building.points)
  const xs = points.map((point) => point[0])
  const zs = points.map((point) => point[1])
  const center = [
    buildings.reduce((sum, building) => sum + building.center[0] * building.area, 0) /
      buildings.reduce((sum, building) => sum + building.area, 0),
    buildings.reduce((sum, building) => sum + building.center[1] * building.area, 0) /
      buildings.reduce((sum, building) => sum + building.area, 0),
  ]
  return {
    buildings,
    bounds: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)],
    center,
  }
})

rawBlocks.sort((left, right) => left.center[1] - right.center[1] || left.center[0] - right.center[0])

const blocks = rawBlocks.map((block, index) => {
  const district = DISTRICTS.reduce((best, candidate) => {
    const distance = Math.hypot(block.center[0] - candidate.point[0], block.center[1] - candidate.point[1])
    return distance < best.distance ? { ...candidate, distance } : best
  }, { ...DISTRICTS[0], distance: Number.POSITIVE_INFINITY })
  const id = `manzana-${String(index + 1).padStart(2, "0")}`
  const hash = hashString(`${id}-${district.name}-${block.buildings.map((building) => building.id).join("-")}`)
  const landmark = [...block.buildings].sort((left, right) => right.area - left.area)[0]
  return {
    id,
    name: `Manzana ${String(index + 1).padStart(2, "0")}`,
    district: district.name,
    style: STYLES[index % STYLES.length],
    palette: index % 8,
    accent: Math.floor(index / 8) % 5,
    rhythm: hash % 7,
    heightBias: Number((((hash >>> 3) % 17) / 100 - 0.08).toFixed(3)),
    roofBias: Number((((hash >>> 7) % 9) / 100).toFixed(3)),
    center: block.center.map((value) => Number(value.toFixed(3))),
    bounds: block.bounds.map((value) => Number(value.toFixed(3))),
    landmarkId: landmark.id,
    buildingIds: block.buildings.map((building) => building.id),
  }
})

const output = {
  generatedAt: new Date().toISOString(),
  method: "Street-raster polygonization; every street ribbon is treated as an immutable block boundary.",
  stats: {
    blocks: blocks.length,
    districts: DISTRICTS.length,
    sourceBuildings: source.buildings.length,
    streetRegions: regionCount,
  },
  blocks,
}

await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`)
console.log(`Generated ${blocks.length} unique urban blocks across ${DISTRICTS.length} districts.`)
