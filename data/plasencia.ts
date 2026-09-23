import intramuros from "@/data/intramuros.generated.json"
import urbanBlocks from "@/data/urban-blocks.generated.json"

export type Point2 = readonly [x: number, z: number]

export type Street = {
  id: string
  highway: string
  name: string
  points: readonly Point2[]
  width: number
}

export type UrbanBuilding = {
  id: string
  height: number
  palette: number
  points: readonly Point2[]
  roof: number
}

export type UrbanPlaza = {
  id: string
  name: string
  points: readonly Point2[]
}

export type UrbanBlockStyle =
  | "stepped"
  | "courtyard"
  | "arcaded"
  | "towered"
  | "terraced"
  | "bridged"
  | "garden"
  | "lookout"
  | "cloister"
  | "gabled"

export type UrbanBlock = {
  id: string
  name: string
  district: string
  style: UrbanBlockStyle
  palette: number
  accent: number
  rhythm: number
  heightBias: number
  roofBias: number
  center: Point2
  bounds: readonly [minX: number, minZ: number, maxX: number, maxZ: number]
  landmarkId: string
  buildingIds: readonly string[]
}

export type PoiKind =
  | "cathedral"
  | "townhall"
  | "aqueduct"
  | "church"
  | "palace"
  | "tower"
  | "wall"

export type Poi = {
  id: string
  number: number
  name: string
  kicker: string
  summary: string
  position: Point2
  kind: PoiKind
  focusHeight?: number
}

export const CITY_POLYGON = intramuros.boundary as unknown as readonly Point2[]
export const WALL_PATH = CITY_POLYGON
export const WALL_SEGMENTS = intramuros.walls as unknown as readonly (readonly Point2[])[]
export const STREETS = intramuros.streets as unknown as readonly Street[]
export const STREET_LABELS = intramuros.labels as unknown as readonly { name: string; position: Point2 }[]
export const URBAN_BUILDINGS = intramuros.buildings as unknown as readonly UrbanBuilding[]
export const URBAN_PLAZAS = intramuros.plazas as unknown as readonly UrbanPlaza[]
export const URBAN_STATS = intramuros.stats
export const URBAN_BLOCKS = urbanBlocks.blocks as unknown as readonly UrbanBlock[]
export const URBAN_BLOCK_STATS = urbanBlocks.stats
export const MAP_ATTRIBUTION = intramuros.attribution

const LOCATIONS = intramuros.locations as unknown as Record<string, Point2>

export const RIVER_PATH: readonly Point2[] = [
  [-43, 29],
  [-40, 21],
  [-39, 12],
  [-39, 3],
  [-38, -7],
  [-33, -18],
  [-24, -27],
  [-11, -32],
  [3, -34],
  [18, -35],
]

export const POIS: readonly Poi[] = [
  {
    id: "catedral",
    number: 1,
    name: "Catedral Nueva y Vieja",
    kicker: "Corazón monumental",
    summary: "Dos catedrales enlazadas forman el gran hito del perfil histórico de Plasencia.",
    position: LOCATIONS.cathedral,
    kind: "cathedral",
    focusHeight: 6,
  },
  {
    id: "mirabel",
    number: 2,
    name: "Palacio del Marqués de Mirabel",
    kicker: "Arquitectura civil",
    summary: "Un volumen palaciego junto a San Nicolás, modelado como pieza singular dentro de la trama.",
    position: LOCATIONS.mirabel,
    kind: "palace",
  },
  {
    id: "episcopal",
    number: 3,
    name: "Palacio Episcopal",
    kicker: "Conjunto catedralicio",
    summary: "La pieza que completa la plaza de la Catedral y refuerza su escala urbana.",
    position: LOCATIONS.episcopal,
    kind: "palace",
  },
  {
    id: "acueducto",
    number: 4,
    name: "Acueducto de San Antón",
    kicker: "Infraestructura histórica",
    summary: "Una secuencia de arcos fuera de la muralla que sirve como gran referencia espacial del este.",
    position: LOCATIONS.aqueduct,
    kind: "aqueduct",
    focusHeight: 4,
  },
  {
    id: "santa-ana",
    number: 5,
    name: "Iglesia de Santa Ana",
    kicker: "Patrimonio religioso",
    summary: "Una iglesia compacta integrada en la red de calles del sector oriental.",
    position: LOCATIONS.santaAna,
    kind: "church",
  },
  {
    id: "monroy",
    number: 6,
    name: "Casa palacio de los Monroy",
    kicker: "Las Dos Torres",
    summary: "Residencia histórica reconocible por su silueta fortificada y sus dos cuerpos verticales.",
    position: LOCATIONS.monroy,
    kind: "palace",
  },
  {
    id: "dean",
    number: 7,
    name: "Casa del Deán",
    kicker: "Arquitectura civil",
    summary: "Una casa señorial situada entre el conjunto catedralicio y la Plaza Mayor.",
    position: LOCATIONS.dean,
    kind: "palace",
  },
  {
    id: "argollas",
    number: 8,
    name: "Casa de las Argollas",
    kicker: "Arquitectura civil",
    summary: "Hito doméstico del eje oriental, destacado con una fachada propia dentro de la maqueta.",
    position: LOCATIONS.argollas,
    kind: "palace",
  },
  {
    id: "museo-textil",
    number: 9,
    name: "Museo Etnográfico Textil Pérez Enciso",
    kicker: "Memoria y oficios",
    summary: "Una parada cultural próxima a la muralla occidental y al acceso de Trujillo.",
    position: LOCATIONS.museo,
    kind: "palace",
  },
  {
    id: "torre-lucia",
    number: 10,
    name: "Torre Lucía",
    kicker: "Defensa urbana",
    summary: "Torre de la cerca medieval que domina el extremo oriental del recinto.",
    position: LOCATIONS.torreLucia,
    kind: "tower",
    focusHeight: 4,
  },
  {
    id: "muralla",
    number: 11,
    name: "Murallas y puertas",
    kicker: "Recinto medieval",
    summary: "La línea roja del plano se convierte aquí en una cerca continua con torres y accesos reconocibles.",
    position: [11.5, -7.8],
    kind: "wall",
  },
  {
    id: "plaza-mayor",
    number: 12,
    name: "Plaza Mayor y Palacio Municipal",
    kicker: "Centro cívico",
    summary: "La plaza abierta organiza la maqueta y el palacio municipal marca su borde con la torre del reloj.",
    position: LOCATIONS.plazaMayor,
    kind: "townhall",
    focusHeight: 5,
  },
  {
    id: "santo-domingo",
    number: 13,
    name: "Iglesia de Santo Domingo",
    kicker: "Patrimonio religioso",
    summary: "Una pieza conventual de mayor escala en el sector norte del casco histórico.",
    position: LOCATIONS.santoDomingo,
    kind: "church",
  },
  {
    id: "magdalena",
    number: 14,
    name: "Iglesia de la Magdalena",
    kicker: "Borde histórico",
    summary: "El hito septentrional, junto a la Puerta de Coria y la ribera.",
    position: LOCATIONS.magdalena,
    kind: "church",
  },
]

export const GATES = intramuros.gates as unknown as readonly { name: string; position: Point2 }[]
