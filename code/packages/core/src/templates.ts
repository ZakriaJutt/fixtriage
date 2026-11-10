// Fixed, versioned message templates (MH-02, EP-2, EP-6, EP-7, EP-10, MH-15). Pure; no model is involved.
// The selector for tenant-facing text is the clock (afterHours), sender history and rule hits only (EP-10).
// No tenant template calls the SMS number an emergency line or promises "next business day" handling.

export interface Rendered {
  templateId: string;
  templateVersion: number;
  body: string;
}

export interface SafetyReplyParams {
  afterHours: boolean;
  /** Landlord's emergency contact number (property override, else account); may be missing before go-live. */
  emergencyContactPhone: string | null;
  /** Gas utility emergency line (property override, else account default FortisBC, SRC-13). */
  gasEmergencyPhone: string;
}

function ec(phone: string | null): string {
  return phone ? `your landlord's emergency contact number, ${phone}` : `your landlord's emergency contact number`;
}

/** MH-02 safety reply. After hours (by the clock) the EP-10 variant is used. */
export function renderSafetyReply(p: SafetyReplyParams): Rendered {
  const core =
    `We received your message. If there is fire, smoke or anyone is in danger, call 911 now. ` +
    `If you smell gas, go outside first, then call the gas emergency line ${p.gasEmergencyPhone} or 911. ` +
    `For an emergency repair, call ${ec(p.emergencyContactPhone)}.`;
  if (p.afterHours) {
    return {
      templateId: 'safety_reply.after_hours',
      templateVersion: 1,
      body: `${core} The office is closed now. If this cannot wait, reply URGENT or call ${ec(p.emergencyContactPhone)}.`,
    };
  }
  return { templateId: 'safety_reply.standard', templateVersion: 1, body: core };
}

/** MH-15 purpose notice; the second message of the first exchange, carrying the opt-out line. */
export function renderPurposeNotice(p: { accountName: string; privacyUrl: string }): Rendered {
  return {
    templateId: 'notice.purpose',
    templateVersion: 1,
    body: `${p.accountName} uses FixTriage to receive and arrange repairs. Your messages and photos are used for that purpose: ${p.privacyUrl} Reply STOP to stop texts, HELP for help.`,
  };
}

/** EP-6 tenant notice at 15 minutes without acknowledgement. */
export function renderStillTrying(p: { emergencyContactPhone: string | null }): Rendered {
  return {
    templateId: 'tenant.still_trying',
    templateVersion: 1,
    body: `We are still trying to reach the manager about your report. If anyone is in danger, call 911. You can also call ${ec(p.emergencyContactPhone)}.`,
  };
}

/** Sent to the tenant when a person of the account acknowledges (TRD 6.2). */
export function renderAcknowledged(): Rendered {
  return { templateId: 'tenant.acknowledged', templateVersion: 1, body: 'A manager has your report and will contact you.' };
}

export interface PageParams {
  tier: string;
  hazardClass: string;
  address: string | null;
  units: string[];
  reportCount: number;
  ackUrl: string | null;
  /** FD-3: a failed emergency dispatch; the next vendor in preferred order is pre-drafted for review. */
  failedDispatch?: { nextVendorName: string | null } | undefined;
  cannotText?: boolean | undefined;
}

function where(p: PageParams): string {
  const units = p.units.length ? ` (${p.units.join(', ')})` : '';
  return `${p.address ?? 'address unknown, unknown sender'}${units}`;
}

/** EP-2 page, SMS half: minimal data, no tenant name, number or message text (TRD 8.1). */
export function renderPageSms(p: PageParams): Rendered {
  const parts = [`FixTriage ${p.tier.toUpperCase()}: ${p.hazardClass.replace(/_/g, ' ')} at ${where(p)}; ${p.reportCount} report${p.reportCount === 1 ? '' : 's'}.`];
  if (p.failedDispatch) parts.push(`Emergency dispatch failed. Review next vendor: ${p.failedDispatch.nextVendorName ?? 'no vendor on file'}.`);
  if (p.cannotText) parts.push('Tenant cannot be texted: phone the tenant.');
  if (p.ackUrl) parts.push(`Acknowledge: ${p.ackUrl}`);
  return { templateId: 'page.sms', templateVersion: 1, body: parts.join(' ') };
}

/** EP-2 page, voice half: spoken summary and "press 1 to acknowledge". */
export function renderPageVoice(p: PageParams): Rendered {
  return {
    templateId: 'page.voice',
    templateVersion: 1,
    body: `FixTriage ${p.tier.replace(/_/g, ' ')} report: ${p.hazardClass.replace(/_/g, ' ')} at ${where(p)}. ${p.reportCount} report${p.reportCount === 1 ? '' : 's'}. Press 1 to acknowledge.`,
  };
}

/** EP-7 outcome reminder to the acknowledger. */
export function renderOutcomeReminder(p: { address: string | null; hazardClass: string; incidentUrl: string }): Rendered {
  return {
    templateId: 'staff.outcome_reminder',
    templateVersion: 1,
    body: `Reminder: record the outcome for ${p.hazardClass.replace(/_/g, ' ')} at ${p.address ?? 'address unknown'}: ${p.incidentUrl}`,
  };
}

export const ALL_TENANT_TEMPLATE_SAMPLES = (): Rendered[] => [
  renderSafetyReply({ afterHours: false, emergencyContactPhone: '+16045550100', gasEmergencyPhone: '+18006639911' }),
  renderSafetyReply({ afterHours: true, emergencyContactPhone: '+16045550100', gasEmergencyPhone: '+18006639911' }),
  renderSafetyReply({ afterHours: true, emergencyContactPhone: null, gasEmergencyPhone: '+18006639911' }),
  renderPurposeNotice({ accountName: 'Example Realty', privacyUrl: 'https://example.test/privacy' }),
  renderStillTrying({ emergencyContactPhone: '+16045550100' }),
  renderAcknowledged(),
];

/** Property override first, then the account (schema properties.emergency_contact_phone, gas_emergency_phone). */
export function pickContacts(account: { emergencyContactPhone: string | null; gasEmergencyPhone: string }, property: { emergencyContactPhone: string | null; gasEmergencyPhone: string | null } | null): { emergencyContactPhone: string | null; gasEmergencyPhone: string } {
  return {
    emergencyContactPhone: property?.emergencyContactPhone ?? account.emergencyContactPhone,
    gasEmergencyPhone: property?.gasEmergencyPhone ?? account.gasEmergencyPhone,
  };
}
