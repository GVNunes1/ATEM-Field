export interface ReadinessCheck {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
}

export interface AppointmentReadiness {
  appointment_id: number;
  state: 'ready' | 'attention' | 'planning';
  checks: ReadinessCheck[];
  missing: string[];
}

export interface OperationalAlert {
  id: string;
  appointment_id: number;
  severity: 'warning' | 'critical';
  kind: string;
  message: string;
}

export interface OperationalInsights {
  available?: boolean;
  readiness: AppointmentReadiness[];
  alerts: OperationalAlert[];
}
