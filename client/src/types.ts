export const PROJECT_TYPES = [
  "house",
  "residential",
  "commercial",
  "highway",
  "airport",
  "ports",
  "dams",
] as const;

export type ProjectType = (typeof PROJECT_TYPES)[number];

export const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  house: "House & Interiors",
  residential: "Residential Building",
  commercial: "Commercial Building",
  highway: "Highway & Roadways",
  airport: "Airport",
  ports: "Ports & Harbours",
  dams: "Dams & Spillways",
};

export interface User {
  id: string;
  email: string;
  username?: string | null;
  emailVerified?: boolean;
  totpEnabled: boolean;
  createdAt: number;
  lastLoginAt: number | null;
  passwordChangedAt: number;
  plan: string;
  planExpiresAt: number | null;
  country: string;
  phone: string | null;
  accountType: "individual" | "business";
  gstin: string | null;
}

export interface Project {
  id: string;
  name: string;
  projectType: ProjectType;
  widthMm: number;
  depthMm: number;
  createdAt: number;
  updatedAt: number;
  hasPhoto: boolean;
}

export interface ProjectDetail extends Project {
  design: Design | null;
}

export interface AuditEvent {
  id: number;
  action: string;
  detail: string | null;
  ip: string | null;
  user_agent: string | null;
  created_at: number;
}

export interface AuditStats {
  activeSessions: number;
  secretsCount: number;
  projectsCount: number;
  failedLogins24h: number;
  logins24h: number;
  signupsEver: number;
  enabled2fa: boolean;
  lastLogin: number | null;
}

export interface SessionInfo {
  id: string;
  user_agent: string | null;
  ip: string | null;
  created_at: number;
  last_seen_at: number;
  expires_at: number;
  current: boolean;
}

export interface PaymentRecord {
  id: string;
  provider: string;
  method: string;
  plan: string;
  amount: number;
  currency: string;
  status: string;
  provider_order_id: string | null;
  completed_at: number | null;
  created_at: number;
}

export interface Plan {
  id: string;
  name: string;
  price: number;
  currency: string;
  symbol: string;
  digits: number;
  periodDays: number;
  tagline: string;
}

export interface PaymentMethodInfo {
  method: "upi" | "card" | "paypal";
  label: string;
  provider: string;
}

/* --------------------------------- Design -------------------------------- */

export interface RoomConfig {
  widthMm: number;
  depthMm: number;
  wallHeightMm: number;
  wallColor: string;
  floorColor: string;
}

export interface FurnitureItem {
  id: string;
  type: string;
  name: string;
  x: number;
  z: number;
  rotationDeg: number;
  scale: number;
  color: string;
}

export interface CurtainConfig {
  enabled: boolean;
  style: "sheer" | "blackout" | "roman" | "panel";
  color: string;
  wall: "north" | "south" | "east" | "west";
  heightPercent: number;
  widthPercentPerPanel: number;
}

/* ------------------------- Community / building wizard ------------------------- */

export type UnitSystem = "m" | "yd" | "ft";
export type BuildingBranch = "residential" | "commercial";
export type ParkingMode = "none" | "surface" | "underground";
export type DoorFacing = "north" | "east" | "south" | "west";

export interface LandSite {
  unit: UnitSystem;
  width: number;
  depth: number;
}

export interface UndergroundParking {
  levels: number;
  floorHeight: number;
  foundationDepth: number;
  rampWidth: number;
  rampLength: number;
  rampSlope: number;
  pillarSpacingX: number;
  pillarSpacingZ: number;
  bayWidth: number;
  bayLength: number;
  bayCols: number;
  bayRows: number;
  liftLobby: boolean;
  stairLobby: boolean;
}

export interface Parking {
  mode: ParkingMode;
  surfaceBays: number;
  underground?: UndergroundParking;
}

export interface AmenityData {
  id: string;
  kind: string;
  x: number;
  z: number;
  rotY: number;
  w: number;
  d: number;
  h: number;
  /** Optional overrides for generated objects (offline intent → object). */
  label?: string;
  color?: string;
  shape?: string;
}

export interface TowerData {
  id: string;
  label: string;
  x: number;
  z: number;
  floors: number;
  unitsPerFloor: number;
  unitWidth: number;
  unitDepth: number;
  floorHeight: number;
  commonAreaPerFloor: number;
  openAreaPerFloor: number;
  doorFacing: DoorFacing;
  facadeMaterial: string;
  facadeColor: string;
}

export interface ExteriorPanel {
  id: string;
  towerId: string;
  face: "front" | "back" | "left" | "right";
  x: number;
  y: number;
  w: number;
  h: number;
  material: string;
  color: string;
}

export interface InteriorRoom {
  id: string;
  towerId: string;
  floor: number;
  name: string;
  type: string;
  x: number;
  z: number;
  w: number;
  d: number;
  doorFacing: DoorFacing;
  furniture?: FurnitureItem[];
}

export interface SiteLocation {
  lat: number;
  lng: number;
  address?: string;
  zoom?: number;
  /** Plot boundary vertices in declaration order (WGS84). */
  boundary?: { lat: number; lng: number }[];
  /** Best-fit boundary width, metres. */
  boundaryWidthM?: number;
  /** Best-fit boundary depth, metres. */
  boundaryDepthM?: number;
  /** Best-fit boundary rotation from north, degrees. */
  boundaryRotationDeg?: number;
  /** Traced route centreline (WGS84), used by linear works such as highways. */
  route?: { lat: number; lng: number }[];
  /** Measured route length, metres. */
  routeLengthM?: number;
  /** Compass bearing of the route's first segment, degrees from north. */
  routeBearingDeg?: number;
}

/* ------------------------- Infrastructure designs ------------------------- */

export type InfraKind = "highway" | "airport" | "ports" | "dams";

export interface HighwayDesign {
  lanes: number;
  laneWidthM: number;
  medianM: number;
  shoulderM: number;
  designSpeedKph: number;
  surface: "bituminous" | "concrete";
  pavementThicknessMm: number;
  crossSlopePct: number;
  embankmentHeightM: number;
  culverts: number;
  interchanges: number;
  terrainRoughnessM: number;
}

export interface AirportDesign {
  runways: number;
  runwayLengthM: number;
  runwayWidthM: number;
  runwayHeadingDeg: number;
  taxiways: number;
  apronDepthM: number;
  terminalAreaM2: number;
  stands: number;
  aerodromeCode: "4F" | "4E" | "4C" | "3C";
  elevationM: number;
  fuelFarm: boolean;
}

export interface PortDesign {
  berths: number;
  berthLengthM: number;
  draftM: number;
  quayWidthM: number;
  breakwaterLengthM: number;
  containerYardM2: number;
  cranes: number;
  warehouses: number;
  channelDepthM: number;
  quayType: "solid" | "open-piled";
}

export interface DamDesign {
  damType: "gravity" | "earthen" | "rockfill" | "arch";
  heightM: number;
  crestLengthM: number;
  crestWidthM: number;
  upstreamSlope: number;
  downstreamSlope: number;
  freeboardM: number;
  reservoirAreaM2: number;
  spillwayType: "ogee" | "chute" | "siphon" | "morning-glory";
  spillwayCapacityCumec: number;
  spillwayGates: number;
  gateWidthM: number;
  gateHeightM: number;
  stillingBasin: boolean;
  groutCurtainDepthM: number;
}

export interface InfraDesign {
  version: 1;
  kind: InfraKind;
  location?: SiteLocation;
  highway?: HighwayDesign;
  airport?: AirportDesign;
  ports?: PortDesign;
  dams?: DamDesign;
}

export interface CommunityDesign {
  version: 1;
  branch: BuildingBranch;
  land: LandSite;
  location?: SiteLocation;
  parking: Parking;
  amenities: AmenityData[];
  towers: TowerData[];
  exteriors: ExteriorPanel[];
  interiors: InteriorRoom[];
}

export interface Design {
  version: 1;
  room: RoomConfig;
  furniture: FurnitureItem[];
  curtains: CurtainConfig | null;
  community?: CommunityDesign;
  infra?: InfraDesign;
}

export function defaultDesign(): Design {
  return {
    version: 1,
    room: {
      widthMm: 6000,
      depthMm: 4000,
      wallHeightMm: 2700,
      wallColor: "#e8e2d0",
      floorColor: "#b59a7f",
    },
    furniture: [],
    curtains: null,
  };
}