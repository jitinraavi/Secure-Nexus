export const PROJECT_TYPES = [
  "house",
  "commercial",
  "highway",
  "roadways",
  "airport",
  "ports",
  "dams",
  "spillways",
] as const;

export type ProjectType = (typeof PROJECT_TYPES)[number];

export const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  house: "House / Residential",
  commercial: "Commercial Building",
  highway: "Highway",
  roadways: "Roadways",
  airport: "Airport",
  ports: "Ports",
  dams: "Dams",
  spillways: "Spillways",
};

export interface User {
  id: string;
  email: string;
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

export interface Design {
  version: 1;
  room: RoomConfig;
  furniture: FurnitureItem[];
  curtains: CurtainConfig | null;
  infra?: Record<string, number>;
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