// One projection for every appointment response, including delegated portals.
export function publicCalendarAppointment(appointment: any) {
  const { google_event, google_etag, google_sync_conflict, ...result } = appointment;
  if (google_sync_conflict) {
    const { summary, location, start, end, status } = google_sync_conflict;
    result.google_sync_conflict = { summary, location, start, end, status };
  } else result.google_sync_conflict = null;
  return result;
}

export function credentialFreeProfile(profile: any) {
  const { pin, auth_version, ...result } = profile;
  return { ...result, has_pin: Boolean(pin) };
}

export function portalProfile(profile: any) {
  const { id, name, role, status, avatar_url } = profile;
  return { id, name, role, status, avatar_url };
}

export function publicReservation(reservation: any) {
  const { id, analyzer_id, status, reserved_date } = reservation;
  return { id, analyzer_id, status, reserved_date };
}

export function publicAnalyzer(analyzer: any) {
  const { id, name, category_id, type, brand_model, serial_number, asset_tag, status, calibration_date, calibration_expiry, calibration_due } = analyzer;
  return { id, name, category_id, type, brand_model, serial_number, asset_tag, status, calibration_date, calibration_expiry, calibration_due };
}
