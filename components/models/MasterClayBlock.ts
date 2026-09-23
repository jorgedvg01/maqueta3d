import * as THREE from "three"
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js"
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js"

import {
  STREETS,
  type Point2,
  type UrbanBlock,
  type UrbanBuilding,
} from "@/data/plasencia"

export const MASTER_CLAY_BLOCK_ID = "manzana-05"

const BASE_Y = 0.43
const WALL_PALETTE = [0xf2c98e, 0xd98e6f, 0x8dbcc4, 0xe8b57d, 0xb8c79b, 0xe5caa6, 0xce8068]
const ROOF_PALETTE = [0xc95835, 0xd66c3f, 0xb94731, 0xdf7a48, 0xc7653f]
const SHUTTER_PALETTE = [0x477d77, 0x416d80, 0x7f4d3e, 0x6d8b64, 0x865449]
const AWNING_PALETTE = [0x8eb7bf, 0xe6c05e, 0xb96b63, 0x78a889]

type Facade = {
  direction: THREE.Vector2
  length: number
  midpoint: THREE.Vector2
  outward: THREE.Vector2
}

type RoofFrame = {
  center: THREE.Vector2
  halfLength: number
  halfWidth: number
  u: THREE.Vector2
  v: THREE.Vector2
}

type TileInstance = {
  color: THREE.Color
  matrix: THREE.Matrix4
}

const STREET_SEGMENTS = STREETS.flatMap((street) =>
  street.points.slice(1).map((point, index) => ({
    a: street.points[index],
    b: point,
    width: street.width,
  })),
)

function clayMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0xffffff,
    metalness: 0,
    roughness: 0.92,
    side: THREE.DoubleSide,
    vertexColors: true,
  })
}

function tileMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0xffffff,
    metalness: 0,
    roughness: 0.96,
  })
}

function hashString(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function polygonArea(points: readonly Point2[]) {
  let area = 0
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length]
    area += points[index][0] * next[1] - next[0] * points[index][1]
  }
  return area / 2
}

function polygonCentroid(points: readonly Point2[]) {
  const signedArea = polygonArea(points)
  if (Math.abs(signedArea) < 0.00001) {
    return new THREE.Vector2(
      points.reduce((sum, point) => sum + point[0], 0) / points.length,
      points.reduce((sum, point) => sum + point[1], 0) / points.length,
    )
  }
  let x = 0
  let z = 0
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length]
    const factor = points[index][0] * next[1] - next[0] * points[index][1]
    x += (points[index][0] + next[0]) * factor
    z += (points[index][1] + next[1]) * factor
  }
  return new THREE.Vector2(x / (6 * signedArea), z / (6 * signedArea))
}

function pointToSegmentDistance(point: THREE.Vector2, a: Point2, b: Point2) {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const lengthSquared = dx * dx + dz * dz
  const t = lengthSquared
    ? THREE.MathUtils.clamp(((point.x - a[0]) * dx + (point.y - a[1]) * dz) / lengthSquared, 0, 1)
    : 0
  return Math.hypot(point.x - (a[0] + dx * t), point.y - (a[1] + dz * t))
}

function nearestStreetDistance(point: THREE.Vector2) {
  let distance = Number.POSITIVE_INFINITY
  for (const segment of STREET_SEGMENTS) {
    distance = Math.min(distance, pointToSegmentDistance(point, segment.a, segment.b) - segment.width / 2)
  }
  return distance
}

function streetFacade(points: readonly Point2[]): Facade | null {
  const centroid = polygonCentroid(points)
  let best: Facade | null = null
  let bestScore = Number.POSITIVE_INFINITY
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]
    const b = points[(index + 1) % points.length]
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    const length = Math.hypot(dx, dz)
    if (length < 0.18) continue
    let direction = new THREE.Vector2(dx / length, dz / length)
    const midpoint = new THREE.Vector2((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    let outward = new THREE.Vector2(-direction.y, direction.x)
    if (outward.dot(midpoint.clone().sub(centroid)) < 0) {
      direction = direction.multiplyScalar(-1)
      outward = new THREE.Vector2(-direction.y, direction.x)
    }
    const score = nearestStreetDistance(midpoint) - Math.min(length, 1.4) * 0.045
    if (score < bestScore) {
      bestScore = score
      best = { direction, length, midpoint, outward }
    }
  }
  return best
}

function principalRoofFrame(points: readonly Point2[]): RoofFrame {
  const centroid = polygonCentroid(points)
  let xx = 0
  let xz = 0
  let zz = 0
  points.forEach(([x, z]) => {
    const dx = x - centroid.x
    const dz = z - centroid.y
    xx += dx * dx
    xz += dx * dz
    zz += dz * dz
  })
  let angle = 0.5 * Math.atan2(2 * xz, xx - zz)
  let u = new THREE.Vector2(Math.cos(angle), Math.sin(angle))
  let v = new THREE.Vector2(-u.y, u.x)
  const project = (axis: THREE.Vector2) => points.map(([x, z]) => x * axis.x + z * axis.y)
  let alongU = project(u)
  let alongV = project(v)
  if (Math.max(...alongV) - Math.min(...alongV) > Math.max(...alongU) - Math.min(...alongU)) {
    angle += Math.PI / 2
    u = new THREE.Vector2(Math.cos(angle), Math.sin(angle))
    v = new THREE.Vector2(-u.y, u.x)
    alongU = project(u)
    alongV = project(v)
  }
  const minU = Math.min(...alongU)
  const maxU = Math.max(...alongU)
  const minV = Math.min(...alongV)
  const maxV = Math.max(...alongV)
  return {
    center: u.clone().multiplyScalar((minU + maxU) / 2).add(v.clone().multiplyScalar((minV + maxV) / 2)),
    halfLength: Math.max(0.11, (maxU - minU) * 0.46),
    halfWidth: Math.max(0.09, (maxV - minV) * 0.46),
    u,
    v,
  }
}

function coloredGeometry(
  source: THREE.BufferGeometry,
  color: THREE.Color,
  matrix?: THREE.Matrix4,
) {
  const transformed = source.clone()
  source.dispose()
  if (matrix) transformed.applyMatrix4(matrix)
  const geometry = transformed.index ? transformed.toNonIndexed() : transformed
  if (geometry !== transformed) transformed.dispose()
  for (const attribute of Object.keys(geometry.attributes)) {
    if (attribute !== "position") geometry.deleteAttribute(attribute)
  }
  const colors = new Float32Array(geometry.getAttribute("position").count * 3)
  for (let index = 0; index < colors.length; index += 3) {
    colors[index] = color.r
    colors[index + 1] = color.g
    colors[index + 2] = color.b
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3))
  return geometry
}

function facadeMatrix(facade: Facade, x: number, y: number, z: number) {
  return new THREE.Matrix4().set(
    facade.direction.x, 0, facade.outward.x, facade.midpoint.x + facade.direction.x * x + facade.outward.x * z,
    0, 1, 0, y,
    facade.direction.y, 0, facade.outward.y, facade.midpoint.y + facade.direction.y * x + facade.outward.y * z,
    0, 0, 0, 1,
  )
}

function addRoundedBox(
  geometries: THREE.BufferGeometry[],
  color: THREE.Color,
  size: readonly [number, number, number],
  position: readonly [number, number, number],
  rotationY = 0,
  radius = 0.018,
) {
  const safeRadius = Math.min(radius, Math.min(...size) * 0.22)
  const geometry = Math.min(...size) < 0.026
    ? new THREE.BoxGeometry(size[0], size[1], size[2])
    : new RoundedBoxGeometry(size[0], size[1], size[2], 2, safeRadius)
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotationY),
    new THREE.Vector3(1, 1, 1),
  )
  geometries.push(coloredGeometry(geometry, color, matrix))
}

function addFacadeBox(
  geometries: THREE.BufferGeometry[],
  facade: Facade,
  color: THREE.Color,
  size: readonly [number, number, number],
  localPosition: readonly [number, number, number],
  radius = 0.012,
) {
  const safeRadius = Math.min(radius, Math.min(...size) * 0.22)
  const geometry = Math.min(...size) < 0.026
    ? new THREE.BoxGeometry(size[0], size[1], size[2])
    : new RoundedBoxGeometry(size[0], size[1], size[2], 2, safeRadius)
  geometries.push(coloredGeometry(
    geometry,
    color,
    facadeMatrix(facade, localPosition[0], localPosition[1], localPosition[2]),
  ))
}

function addCylinder(
  geometries: THREE.BufferGeometry[],
  color: THREE.Color,
  radiusTop: number,
  radiusBottom: number,
  height: number,
  position: THREE.Vector3,
  radialSegments = 16,
) {
  const matrix = new THREE.Matrix4().makeTranslation(position.x, position.y, position.z)
  geometries.push(coloredGeometry(
    new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radialSegments, 1),
    color,
    matrix,
  ))
}

function addSphere(
  geometries: THREE.BufferGeometry[],
  color: THREE.Color,
  radius: number,
  position: THREE.Vector3,
) {
  const matrix = new THREE.Matrix4().makeTranslation(position.x, position.y, position.z)
  geometries.push(coloredGeometry(new THREE.SphereGeometry(radius, 14, 10), color, matrix))
}

function footprintGeometry(points: readonly Point2[], height: number, color: THREE.Color) {
  const shape = new THREE.Shape()
  shape.moveTo(points[0][0], -points[0][1])
  points.slice(1).forEach(([x, z]) => shape.lineTo(x, -z))
  shape.closePath()
  const shortestEdge = points.reduce((minimum, point, index) => {
    const next = points[(index + 1) % points.length]
    return Math.min(minimum, Math.hypot(next[0] - point[0], next[1] - point[1]))
  }, Number.POSITIVE_INFINITY)
  const bevel = THREE.MathUtils.clamp(shortestEdge * 0.045, 0.012, 0.035)
  const geometry = new THREE.ExtrudeGeometry(shape, {
    bevelEnabled: true,
    bevelSegments: 4,
    bevelSize: bevel,
    bevelThickness: Math.min(0.028, bevel * 0.82),
    curveSegments: 12,
    depth: height,
    steps: 1,
  })
  geometry.rotateX(-Math.PI / 2)
  geometry.translate(0, BASE_Y, 0)
  return coloredGeometry(geometry, color)
}

function addTriangleSurface(
  geometries: THREE.BufferGeometry[],
  color: THREE.Color,
  vertices: readonly (readonly [number, number, number])[],
) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices.flat(), 3))
  geometries.push(coloredGeometry(geometry, color))
}

function roofPoint(frame: RoofFrame, along: number, across: number, y: number) {
  return [
    frame.center.x + frame.u.x * along + frame.v.x * across,
    y,
    frame.center.y + frame.u.y * along + frame.v.y * across,
  ] as const
}

function tileMatrix(start: THREE.Vector3, end: THREE.Vector3, baseLength: number) {
  const direction = end.clone().sub(start)
  const length = direction.length()
  const center = start.clone().lerp(end, 0.5)
  const quaternion = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.normalize(),
  )
  return new THREE.Matrix4().compose(
    center,
    quaternion,
    new THREE.Vector3(1, length / baseLength, 1),
  )
}

function addPitchedRoof(
  geometries: THREE.BufferGeometry[],
  tiles: TileInstance[],
  frame: RoofFrame,
  topY: number,
  roofColor: THREE.Color,
  hash: number,
) {
  const halfLength = frame.halfLength + 0.035
  const halfWidth = frame.halfWidth + 0.04
  const eaveY = topY + 0.055
  const rise = THREE.MathUtils.clamp(halfWidth * 0.62, 0.12, 0.34)
  const ridgeY = eaveY + rise
  const a = roofPoint(frame, -halfLength, -halfWidth, eaveY)
  const b = roofPoint(frame, halfLength, -halfWidth, eaveY)
  const c = roofPoint(frame, halfLength, halfWidth, eaveY)
  const d = roofPoint(frame, -halfLength, halfWidth, eaveY)
  const r1 = roofPoint(frame, -halfLength, 0, ridgeY)
  const r2 = roofPoint(frame, halfLength, 0, ridgeY)
  addTriangleSurface(geometries, roofColor, [a, b, r2, a, r2, r1, r1, r2, c, r1, c, d])

  const gableColor = roofColor.clone().lerp(new THREE.Color(0xf1cf9b), 0.42)
  addTriangleSurface(geometries, gableColor, [a, r1, d, b, c, r2])

  const columnSpacing = THREE.MathUtils.clamp(0.095 + (hash % 3) * 0.008, 0.09, 0.112)
  const columns = THREE.MathUtils.clamp(Math.floor((halfLength * 2) / columnSpacing), 2, 16)
  const courses = THREE.MathUtils.clamp(Math.ceil(halfWidth / 0.15), 1, 6)
  const baseLength = 0.12
  for (let column = 0; column <= columns; column += 1) {
    const along = -halfLength + (column / columns) * halfLength * 2
    for (const side of [-1, 1] as const) {
      for (let course = 0; course < courses; course += 1) {
        const t0 = course / courses
        const t1 = Math.min(1, (course + 1.08) / courses)
        const start = new THREE.Vector3(...roofPoint(
          frame,
          along,
          side * halfWidth * t0,
          ridgeY + (eaveY - ridgeY) * t0 + 0.023,
        ))
        const end = new THREE.Vector3(...roofPoint(
          frame,
          along,
          side * halfWidth * t1,
          ridgeY + (eaveY - ridgeY) * t1 + 0.023,
        ))
        const tint = roofColor.clone().offsetHSL(0, 0, ((column + course + hash) % 5 - 2) * 0.018)
        tiles.push({ matrix: tileMatrix(start, end, baseLength), color: tint })
      }
    }
  }
  const ridgeSegments = THREE.MathUtils.clamp(Math.ceil((halfLength * 2) / 0.15), 2, 18)
  for (let segment = 0; segment < ridgeSegments; segment += 1) {
    const startAlong = -halfLength + (segment / ridgeSegments) * halfLength * 2
    const endAlong = -halfLength + ((segment + 1.08) / ridgeSegments) * halfLength * 2
    const start = new THREE.Vector3(...roofPoint(frame, startAlong, 0, ridgeY + 0.035))
    const end = new THREE.Vector3(...roofPoint(frame, Math.min(halfLength, endAlong), 0, ridgeY + 0.035))
    tiles.push({
      matrix: tileMatrix(start, end, baseLength),
      color: roofColor.clone().offsetHSL(0, 0, segment % 2 ? -0.02 : 0.025),
    })
  }

  return ridgeY
}

function addFlatTerrace(
  geometries: THREE.BufferGeometry[],
  points: readonly Point2[],
  topY: number,
  wallColor: THREE.Color,
  hash: number,
) {
  const vectors = points.map(([x, z]) => new THREE.Vector2(x, z))
  const faces = THREE.ShapeUtils.triangulateShape(vectors, [])
  const terraceY = topY + 0.045
  const floorColor = wallColor.clone().lerp(new THREE.Color(0xf4d8a5), 0.58)
  for (const face of faces) {
    const vertices = face.map((index) => [points[index][0], terraceY, points[index][1]] as const)
    addTriangleSurface(geometries, floorColor, [vertices[0], vertices[1], vertices[2]])
  }
  for (let index = 0; index < points.length; index += 1) {
    const first = points[index]
    const second = points[(index + 1) % points.length]
    const dx = second[0] - first[0]
    const dz = second[1] - first[1]
    const length = Math.hypot(dx, dz)
    if (length < 0.11) continue
    addRoundedBox(
      geometries,
      floorColor.clone().multiplyScalar(0.94),
      [length, 0.17, 0.06],
      [(first[0] + second[0]) / 2, terraceY + 0.082, (first[1] + second[1]) / 2],
      -Math.atan2(dz, dx),
      0.012,
    )
  }
  const center = polygonCentroid(points)
  if (hash % 2 === 0) {
    const potColor = new THREE.Color(0xb95d3b)
    addCylinder(geometries, potColor, 0.045, 0.055, 0.08, new THREE.Vector3(center.x, terraceY + 0.04, center.y), 14)
    addSphere(geometries, new THREE.Color(0x6f9b57), 0.07, new THREE.Vector3(center.x, terraceY + 0.13, center.y))
  }
  return terraceY
}

function addWindow(
  geometries: THREE.BufferGeometry[],
  facade: Facade,
  x: number,
  y: number,
  width: number,
  height: number,
  wallColor: THREE.Color,
  shutterColor: THREE.Color,
  withShutters: boolean,
) {
  const trim = wallColor.clone().lerp(new THREE.Color(0xffe7b9), 0.63)
  const glass = new THREE.Color(0x365d65)
  addFacadeBox(geometries, facade, trim, [width + 0.06, height + 0.06, 0.045], [x, y, 0.033], 0.012)
  addFacadeBox(geometries, facade, glass, [width, height, 0.04], [x, y, 0.057], 0.009)
  addFacadeBox(geometries, facade, trim.clone().multiplyScalar(0.86), [0.018, height, 0.022], [x, y, 0.083], 0.004)
  addFacadeBox(geometries, facade, trim.clone().multiplyScalar(0.86), [width, 0.016, 0.022], [x, y, 0.083], 0.004)
  if (withShutters) {
    for (const side of [-1, 1]) {
      const shutterX = x + side * (width * 0.72)
      addFacadeBox(geometries, facade, shutterColor, [width * 0.34, height + 0.02, 0.032], [shutterX, y, 0.074], 0.008)
      for (let slat = -1; slat <= 1; slat += 1) {
        addFacadeBox(
          geometries,
          facade,
          shutterColor.clone().multiplyScalar(0.78),
          [width * 0.26, 0.012, 0.012],
          [shutterX, y + slat * height * 0.22, 0.095],
          0.003,
        )
      }
    }
  }
}

function addBalcony(
  geometries: THREE.BufferGeometry[],
  facade: Facade,
  x: number,
  y: number,
  width: number,
  wallColor: THREE.Color,
  withFlowers: boolean,
) {
  const stone = wallColor.clone().lerp(new THREE.Color(0xf3d6a3), 0.62)
  const iron = new THREE.Color(0x3f4541)
  const projection = 0.14
  addFacadeBox(geometries, facade, stone, [width, 0.055, projection], [x, y, projection / 2 + 0.06], 0.012)
  addFacadeBox(geometries, facade, iron, [width, 0.022, 0.022], [x, y + 0.23, projection + 0.06], 0.004)
  for (let rail = -3; rail <= 3; rail += 1) {
    addFacadeBox(geometries, facade, iron, [0.014, 0.4, 0.014], [x + rail * width / 7, y + 0.205, projection + 0.06], 0.003)
  }
  for (const side of [-1, 1]) {
    addFacadeBox(geometries, facade, iron, [0.014, 0.4, projection], [x + side * width / 2, y + 0.205, projection / 2 + 0.06], 0.003)
  }
  if (withFlowers) {
    addFacadeBox(geometries, facade, new THREE.Color(0xa95535), [width * 0.56, 0.075, 0.07], [x, y + 0.08, projection + 0.09], 0.008)
    for (let flower = -2; flower <= 2; flower += 1) {
      const local = facade.midpoint.clone()
        .addScaledVector(facade.direction, x + flower * width * 0.1)
        .addScaledVector(facade.outward, projection + 0.105)
      addSphere(
        geometries,
        new THREE.Color(flower % 2 ? 0xe8c65b : 0xc96368),
        0.025,
        new THREE.Vector3(local.x, y + 0.145 + Math.abs(flower) * 0.004, local.y),
      )
    }
  }
}

function archFaceGeometry(width: number, height: number) {
  const radius = width / 2
  const springY = height - radius
  const vertices: number[] = []
  const center: [number, number, number] = [0, springY, 0]
  const left: [number, number, number] = [-radius, 0, 0]
  const right: [number, number, number] = [radius, 0, 0]
  const rightSpring: [number, number, number] = [radius, springY, 0]
  const leftSpring: [number, number, number] = [-radius, springY, 0]
  vertices.push(...left, ...right, ...rightSpring, ...left, ...rightSpring, ...leftSpring)
  for (let index = 0; index < 18; index += 1) {
    const first = (index / 18) * Math.PI
    const second = ((index + 1) / 18) * Math.PI
    vertices.push(
      ...center,
      Math.cos(first) * radius, springY + Math.sin(first) * radius, 0,
      Math.cos(second) * radius, springY + Math.sin(second) * radius, 0,
    )
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3))
  return geometry
}

function addArcade(
  geometries: THREE.BufferGeometry[],
  facade: Facade,
  wallColor: THREE.Color,
) {
  const trim = wallColor.clone().lerp(new THREE.Color(0xffe1ae), 0.57)
  const opening = new THREE.Color(0x453a33)
  const count = THREE.MathUtils.clamp(Math.floor(facade.length / 0.25), 1, 4)
  const spacing = facade.length / count
  const archWidth = Math.min(0.24, spacing * 0.74)
  const archHeight = 0.43
  for (let index = 0; index < count; index += 1) {
    const x = -facade.length / 2 + (index + 0.5) * spacing
    geometries.push(coloredGeometry(
      archFaceGeometry(archWidth, archHeight),
      opening,
      facadeMatrix(facade, x, BASE_Y + 0.015, 0.063),
    ))
    const springY = BASE_Y + archHeight - archWidth / 2
    addFacadeBox(geometries, facade, trim, [0.04, archHeight - archWidth / 2 + 0.02, 0.09], [x - archWidth / 2 - 0.015, BASE_Y + (archHeight - archWidth / 2) / 2, 0.066], 0.009)
    addFacadeBox(geometries, facade, trim, [0.04, archHeight - archWidth / 2 + 0.02, 0.09], [x + archWidth / 2 + 0.015, BASE_Y + (archHeight - archWidth / 2) / 2, 0.066], 0.009)
    const torus = new THREE.TorusGeometry(archWidth / 2 + 0.017, 0.022, 8, 28, Math.PI)
    geometries.push(coloredGeometry(torus, trim, facadeMatrix(facade, x, springY, 0.069)))
  }
  addFacadeBox(geometries, facade, trim.clone().multiplyScalar(0.92), [facade.length * 0.96, 0.075, 0.13], [0, BASE_Y + 0.45, 0.065], 0.015)
}

function addDoor(
  geometries: THREE.BufferGeometry[],
  facade: Facade,
  x: number,
  wallColor: THREE.Color,
  hash: number,
) {
  const trim = wallColor.clone().lerp(new THREE.Color(0xffe8ba), 0.58)
  const wood = new THREE.Color(hash % 2 ? 0x75462f : 0x5e4636)
  addFacadeBox(geometries, facade, trim, [0.2, 0.4, 0.052], [x, BASE_Y + 0.2, 0.03], 0.015)
  addFacadeBox(geometries, facade, wood, [0.15, 0.35, 0.045], [x, BASE_Y + 0.18, 0.059], 0.012)
  addFacadeBox(geometries, facade, wood.clone().multiplyScalar(0.76), [0.014, 0.33, 0.015], [x, BASE_Y + 0.18, 0.086], 0.003)
  addFacadeBox(geometries, facade, wood.clone().multiplyScalar(0.76), [0.13, 0.014, 0.015], [x, BASE_Y + 0.18, 0.086], 0.003)
  const knob = facade.midpoint.clone().addScaledVector(facade.direction, x + 0.045).addScaledVector(facade.outward, 0.088)
  addSphere(geometries, new THREE.Color(0xb69350), 0.014, new THREE.Vector3(knob.x, BASE_Y + 0.19, knob.y))
}

function addAwning(
  geometries: THREE.BufferGeometry[],
  facade: Facade,
  x: number,
  y: number,
  width: number,
  color: THREE.Color,
) {
  addFacadeBox(geometries, facade, color, [width, 0.055, 0.24], [x, y, 0.145], 0.012)
  for (const side of [-1, 1]) {
    addFacadeBox(geometries, facade, new THREE.Color(0x684b39), [0.018, 0.34, 0.018], [x + side * width * 0.43, y - 0.18, 0.245], 0.004)
  }
}

function addFacadeDetails(
  geometries: THREE.BufferGeometry[],
  facade: Facade,
  wallColor: THREE.Color,
  buildingHeight: number,
  topY: number,
  index: number,
  hash: number,
) {
  const shutterColor = new THREE.Color(SHUTTER_PALETTE[(index + hash) % SHUTTER_PALETTE.length])
  const floors = buildingHeight > 1.82 ? 3 : 2
  const slots = THREE.MathUtils.clamp(Math.floor(facade.length / 0.25), 1, 3)
  const spacing = facade.length / (slots + 1)
  const windowWidth = THREE.MathUtils.clamp(spacing * 0.5, 0.085, 0.15)
  const windowHeight = floors === 3 ? 0.19 : 0.22
  const arcaded = index % 7 === 0 || (index < 8 && index % 3 === 1)

  addFacadeBox(
    geometries,
    facade,
    wallColor.clone().lerp(new THREE.Color(0xffe5b8), 0.5),
    [facade.length * 0.95, 0.055, 0.055],
    [0, topY - 0.07, 0.035],
    0.01,
  )
  addFacadeBox(
    geometries,
    facade,
    wallColor.clone().multiplyScalar(0.78),
    [facade.length * 0.96, 0.09, 0.04],
    [0, BASE_Y + 0.045, 0.025],
    0.008,
  )

  if (arcaded && facade.length > 0.3) addArcade(geometries, facade, wallColor)
  else addDoor(geometries, facade, (hash % slots - (slots - 1) / 2) * spacing, wallColor, hash)

  for (let floor = 0; floor < floors; floor += 1) {
    const y = BASE_Y + 0.57 + floor * ((buildingHeight - 0.46) / floors)
    if (y + windowHeight / 2 > topY - 0.11) continue
    for (let slot = 0; slot < slots; slot += 1) {
      if (!arcaded && floor === 0 && slot === hash % slots) continue
      const x = (slot - (slots - 1) / 2) * spacing
      addWindow(
        geometries,
        facade,
        x,
        y,
        windowWidth,
        windowHeight,
        wallColor,
        shutterColor,
        (hash + floor + slot) % 3 !== 0,
      )
    }
  }

  if (floors >= 2 && facade.length > 0.48 && index % 3 !== 1) {
    const balconyY = BASE_Y + 0.57 + ((buildingHeight - 0.46) / floors) - windowHeight / 2 - 0.03
    addBalcony(geometries, facade, 0, balconyY, Math.min(0.52, facade.length * 0.64), wallColor, index % 2 === 0)
  }
  if (index % 9 === 2 && facade.length > 0.42) {
    addAwning(
      geometries,
      facade,
      0,
      BASE_Y + 0.48,
      Math.min(0.46, facade.length * 0.68),
      new THREE.Color(AWNING_PALETTE[index % AWNING_PALETTE.length]),
    )
  }
}

function addChimney(
  geometries: THREE.BufferGeometry[],
  frame: RoofFrame,
  roofY: number,
  wallColor: THREE.Color,
  roofColor: THREE.Color,
  hash: number,
) {
  const along = ((hash % 7) / 6 - 0.5) * frame.halfLength * 1.1
  const across = hash % 2 ? frame.halfWidth * 0.24 : -frame.halfWidth * 0.24
  const point = roofPoint(frame, along, across, roofY + 0.12)
  addRoundedBox(geometries, wallColor.clone().lerp(new THREE.Color(0xf4ddb5), 0.55), [0.11, 0.32, 0.11], point, 0, 0.014)
  addRoundedBox(geometries, roofColor.clone().multiplyScalar(0.76), [0.145, 0.055, 0.145], [point[0], point[1] + 0.18, point[2]], 0, 0.01)
}

function addStreetProps(
  geometries: THREE.BufferGeometry[],
  facade: Facade,
  index: number,
  hash: number,
) {
  if (index % 4 === 0) {
    const side = index % 8 === 0 ? -1 : 1
    const localX = side * Math.min(0.2, facade.length * 0.28)
    const point = facade.midpoint.clone().addScaledVector(facade.direction, localX).addScaledVector(facade.outward, 0.15)
    addCylinder(geometries, new THREE.Color(0xb75f3e), 0.045, 0.06, 0.1, new THREE.Vector3(point.x, BASE_Y + 0.05, point.y), 14)
    addSphere(geometries, new THREE.Color(hash % 2 ? 0x6f9952 : 0x83a75a), 0.075, new THREE.Vector3(point.x, BASE_Y + 0.16, point.y))
  }
  if (index % 11 === 3) {
    const point = facade.midpoint.clone().addScaledVector(facade.outward, 0.17)
    addCylinder(geometries, new THREE.Color(0x8a5b38), 0.075, 0.075, 0.17, new THREE.Vector3(point.x, BASE_Y + 0.085, point.y), 16)
    addCylinder(geometries, new THREE.Color(0x3d4543), 0.078, 0.078, 0.018, new THREE.Vector3(point.x, BASE_Y + 0.035, point.y), 16)
    addCylinder(geometries, new THREE.Color(0x3d4543), 0.078, 0.078, 0.018, new THREE.Vector3(point.x, BASE_Y + 0.135, point.y), 16)
  }
  if (index % 13 === 5) {
    const point = facade.midpoint.clone().addScaledVector(facade.outward, 0.19)
    const iron = new THREE.Color(0x414641)
    addCylinder(geometries, iron, 0.016, 0.02, 0.52, new THREE.Vector3(point.x, BASE_Y + 0.26, point.y), 12)
    addSphere(geometries, new THREE.Color(0xf1c66e), 0.055, new THREE.Vector3(point.x, BASE_Y + 0.57, point.y))
    addRoundedBox(geometries, iron, [0.1, 0.03, 0.1], [point.x, BASE_Y + 0.52, point.y], 0, 0.006)
  }
}

function addToyFigure(
  geometries: THREE.BufferGeometry[],
  position: THREE.Vector3,
  coatColor: number,
) {
  addCylinder(geometries, new THREE.Color(coatColor), 0.055, 0.075, 0.2, position.clone().add(new THREE.Vector3(0, 0.1, 0)), 14)
  addSphere(geometries, new THREE.Color(0xe6b887), 0.065, position.clone().add(new THREE.Vector3(0, 0.25, 0)))
  addCylinder(geometries, new THREE.Color(0x654938), 0.07, 0.075, 0.035, position.clone().add(new THREE.Vector3(0, 0.31, 0)), 14)
}

function buildingHeight(building: UrbanBuilding, index: number) {
  return THREE.MathUtils.clamp(building.height * 0.76 + 0.44 + (index % 4) * 0.035, 1.32, 2.16)
}

function mergeClayGeometry(geometries: THREE.BufferGeometry[]) {
  const merged = mergeGeometries(geometries, false)
  geometries.forEach((geometry) => geometry.dispose())
  if (!merged) return null
  const welded = mergeVertices(merged, 0.00001)
  merged.dispose()
  welded.computeVertexNormals()
  return welded
}

export function buildMasterClayBlock(block: UrbanBlock, buildings: readonly UrbanBuilding[]) {
  const group = new THREE.Group()
  group.name = "Manzana 05 · pieza maestra artesanal de la Plaza Mayor"
  group.userData = {
    blockId: block.id,
    district: block.district,
    quality: "master-clay",
    sourceBuildings: buildings.length,
    style: "hybrid-roof-courtyard",
  }

  const geometries: THREE.BufferGeometry[] = []
  const tiles: TileInstance[] = []
  const material = clayMaterial()

  buildings.forEach((building, index) => {
    const hash = hashString(`${block.id}-${building.id}-master`)
    const wallColor = new THREE.Color(WALL_PALETTE[(index * 3 + block.palette) % WALL_PALETTE.length])
      .offsetHSL(((hash % 5) - 2) * 0.004, 0, ((hash >>> 3) % 5 - 2) * 0.012)
    const roofColor = new THREE.Color(ROOF_PALETTE[(index + block.accent) % ROOF_PALETTE.length])
      .offsetHSL(0, 0, ((hash >>> 5) % 5 - 2) * 0.012)
    const height = buildingHeight(building, index)
    const topY = BASE_Y + height
    const frame = principalRoofFrame(building.points)
    const facade = streetFacade(building.points)

    geometries.push(footprintGeometry(building.points, height, wallColor))

    const useTerrace = index % 6 === 0 || frame.halfWidth < 0.115
    const roofY = useTerrace
      ? addFlatTerrace(geometries, building.points, topY, wallColor, hash)
      : addPitchedRoof(geometries, tiles, frame, topY, roofColor, hash)

    if (facade) {
      addFacadeDetails(geometries, facade, wallColor, height, topY, index, hash)
      addStreetProps(geometries, facade, index, hash)
    }
    if (index % 3 === 0 && frame.halfLength > 0.16) {
      addChimney(geometries, frame, roofY, wallColor, roofColor, hash)
    }
  })

  addToyFigure(
    geometries,
    new THREE.Vector3(block.bounds[0] + 0.22, BASE_Y, block.center[1] + 0.28),
    0x6e8a9a,
  )

  const clayGeometry = mergeClayGeometry(geometries)
  if (clayGeometry) {
    const mesh = new THREE.Mesh(clayGeometry, material)
    mesh.name = "Casas modeladas una a una · arcilla, soportales, balcones y terrazas"
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
  }

  if (tiles.length) {
    const baseLength = 0.12
    const tileGeometry = new THREE.CapsuleGeometry(0.022, baseLength - 0.044, 3, 8)
    const tileMesh = new THREE.InstancedMesh(tileGeometry, tileMaterial(), tiles.length)
    tiles.forEach((tile, index) => {
      tileMesh.setMatrixAt(index, tile.matrix)
      tileMesh.setColorAt(index, tile.color)
    })
    tileMesh.instanceMatrix.needsUpdate = true
    if (tileMesh.instanceColor) tileMesh.instanceColor.needsUpdate = true
    tileMesh.name = `${tiles.length} tejas de arcilla colocadas individualmente`
    tileMesh.castShadow = true
    tileMesh.receiveShadow = true
    group.add(tileMesh)
  }

  return group
}
