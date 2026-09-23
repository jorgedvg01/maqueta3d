import * as THREE from "three"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"

type GeometryBatch = {
  geometries: THREE.BufferGeometry[]
  material: THREE.Material
  type: "lines" | "mesh"
}

function geometrySignature(geometry: THREE.BufferGeometry) {
  return Object.keys(geometry.attributes).sort().join(",")
}

export function mergeClayModel(source: THREE.Group, name: string) {
  source.updateMatrixWorld(true)
  const batches = new Map<string, GeometryBatch>()

  source.traverse((child) => {
    const isMesh = child instanceof THREE.Mesh
    const isLines = child instanceof THREE.LineSegments
    if ((!isMesh && !isLines) || Array.isArray(child.material)) return

    const clone = child.geometry.clone()
    clone.applyMatrix4(child.matrixWorld)
    const geometry = clone
    const type = isLines ? "lines" : "mesh"
    const key = `${type}:${child.material.uuid}:${geometry.index ? "indexed" : "plain"}:${geometrySignature(geometry)}`
    const batch: GeometryBatch = batches.get(key) ?? {
      geometries: [] as THREE.BufferGeometry[],
      material: child.material,
      type,
    }
    batch.geometries.push(geometry)
    batches.set(key, batch)
  })

  const result = new THREE.Group()
  result.name = name
  batches.forEach((batch) => {
    const geometry = mergeGeometries(batch.geometries)
    batch.geometries.forEach((item) => item.dispose())
    if (!geometry) return
    if (batch.type === "lines") {
      const lines = new THREE.LineSegments(geometry, batch.material)
      lines.renderOrder = 3
      result.add(lines)
      return
    }
    const object = new THREE.Mesh(geometry, batch.material)
    object.castShadow = true
    object.receiveShadow = true
    result.add(object)
  })

  source.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) child.geometry.dispose()
  })
  return result
}
