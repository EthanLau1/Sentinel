export interface ProjectStats {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  lastRunTime: string;
  stats: ProjectStats;
  status: 'fresh' | 'possibly_stale' | 'stale' | 'ready' | 'uninitialized';
  provider: string;
}

export interface FixOption {
  id: string;
  title: string;
  description: string;
  effort: 'low' | 'medium' | 'high';
  risk: 'low' | 'medium' | 'high';
  runtimeCost: 'none' | 'low' | 'medium' | 'high';
  regressionRisk: 'low' | 'medium' | 'high';
  maintenanceCost: 'low' | 'medium' | 'high';
  stageFit: 'Idea' | 'MVP' | 'Launch' | 'Scale';
  tier: 0 | 1 | 2 | 3;
  confidence: number;
  score: number;
  sources: { url?: string; authority?: string; recency?: string; type?: string }[];
  whyRecommended: string;
  patch?: string;
  verificationCommand?: string;
}

export interface Bug {
  id: string;
  severity: 'P0' | 'P1' | 'P2' | 'P3';
  title: string;
  source: string;
  affectedFeature: string;
  symptom: string;
  reproSteps: string[];
  evidence: unknown[];
  rootCauseStatus: 'confirmed' | 'hypothesis' | 'insufficient evidence';
  rootCause?: string;
  counterEvidence: unknown[];
  confidence: number;
  verificationCommand?: string;
  fixOptions: FixOption[];
  recommendedFixId?: string;
}

export interface Report {
  projectId: string;
  timestamp: string;
  stats: ProjectStats;
  cost: number;
  durationSeconds: number;
  provider: string;
  freshness: 'fresh' | 'possibly_stale' | 'stale' | 'unknown';
}

/** Shape of the actual sentinel-latest.json file */
export interface ReportJson {
  generated_at: string;
  summary: {
    total: number;
    by_severity: Record<string, number>;
    by_root_cause_status: Record<string, number>;
    cost_usd?: number;
    duration_seconds?: number;
  };
  bugs: Bug[];
}

export interface RunEvent {
  step: number;
  message: string;
  status?: 'running' | 'completed' | 'failed';
}

export interface ProviderConfig {
  baseUrl: string;
  apiKey?: string;
  model: string;
}

export interface GlobalProviders {
  ollama: ProviderConfig;
  lmStudio: ProviderConfig;
  customApi: ProviderConfig;
}
