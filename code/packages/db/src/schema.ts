// Drizzle schema (schema.md sections 2-5). Tables needed by B1; constraints, indexes and RLS policies are
// declared here and generated into migrations/0000_*.sql. Objects Drizzle cannot express (FORCE RLS, the
// on-call exclusion constraint, the tier-lowering triggers, resolver functions, poll views, grants) are in
// migrations/0001_*.sql and listed in CUSTOM_OBJECTS so the ORM-diff check (IT-14) covers them too.
import { sql, type SQL } from 'drizzle-orm';
import {
  bigint,
  boolean,
  customType,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgPolicy,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  check,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });
const citext = customType<{ data: string }>({ dataType: () => 'citext' });

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const pk = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => ts('created_at').notNull().defaultNow();
const updatedAt = () => ts('updated_at').notNull().defaultNow();
const version = () => integer('version').notNull().default(1);

const list = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));
const oneOf = (name: string, col: AnyPgColumn, values: readonly string[]) => check(name, sql`${col} in (${list(values)})`);
const e164 = (name: string, col: AnyPgColumn) => check(name, sql`${col} ~ '^\\+[1-9][0-9]{6,14}$'`);

const ACCOUNT_SETTING: SQL = sql`nullif(current_setting('app.account_id', true), '')::uuid`;
const isolation = (table: string) =>
  pgPolicy(`${table}_account_isolation`, { as: 'permissive', for: 'all', to: 'public', using: sql`account_id = ${ACCOUNT_SETTING}`, withCheck: sql`account_id = ${ACCOUNT_SETTING}` });

export const TIER_VALUES = ['life_safety', 'urgent', 'uncertain', 'routine'] as const;
export const TRADE_VALUES = ['plumbing', 'heating', 'electrical', 'locksmith', 'appliance', 'restoration', 'general', 'other'] as const;

// ---------- 3.1 Account, people, places ----------

export const accounts = pgTable(
  'accounts',
  {
    id: pk(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
    name: text('name').notNull(),
    licenceNumber: text('licence_number'),
    timezone: text('timezone').notNull().default('America/Vancouver'),
    businessHours: jsonb('business_hours').notNull(),
    holidays: date('holidays', { mode: 'string' }).array().notNull().default(sql`'{}'::date[]`),
    emergencyContactName: text('emergency_contact_name'),
    emergencyContactPhone: text('emergency_contact_phone'),
    gasEmergencyPhone: text('gas_emergency_phone').notNull().default('+18006639911'),
    ackTimeoutSeconds: integer('ack_timeout_seconds').notNull().default(300),
    status: text('status').notNull().default('onboarding'),
    plan: text('plan').notNull(),
    doorCount: integer('door_count'),
    retentionMonths: integer('retention_months').notNull().default(24),
  },
  (t) => [
    check('accounts_ack_timeout_range', sql`${t.ackTimeoutSeconds} between 180 and 600`),
    check('accounts_retention_range', sql`${t.retentionMonths} between 12 and 36`),
    oneOf('accounts_status_values', t.status, ['onboarding', 'live', 'paused', 'closed']),
    oneOf('accounts_plan_values', t.plan, ['pilot', 'starter', 'pro', 'business']),
    e164('accounts_emergency_phone_e164', t.emergencyContactPhone),
    e164('accounts_gas_phone_e164', t.gasEmergencyPhone),
    // Accounts are isolated by their own id.
    pgPolicy('accounts_account_isolation', { as: 'permissive', for: 'all', to: 'public', using: sql`id = ${ACCOUNT_SETTING}`, withCheck: sql`id = ${ACCOUNT_SETTING}` }),
  ],
);

export const users = pgTable(
  'users',
  {
    id: pk(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
    accountId: uuid('account_id').notNull().references(() => accounts.id),
    email: citext('email').notNull(),
    displayName: text('display_name').notNull(),
    mobile: text('mobile'),
    role: text('role').notNull(),
    isReviewer: boolean('is_reviewer').notNull().default(false),
    passwordHash: text('password_hash').notNull(),
    totpSecretEnc: bytea('totp_secret_enc'),
    totpConfirmedAt: ts('totp_confirmed_at'),
    totpLastStep: bigint('totp_last_step', { mode: 'number' }),
    disabledAt: ts('disabled_at'),
  },
  (t) => [
    unique('users_account_id_id_uq').on(t.accountId, t.id),
    uniqueIndex('users_email_uq').on(t.email),
    uniqueIndex('users_one_reviewer_uq').on(t.accountId).where(sql`is_reviewer`),
    oneOf('users_role_values', t.role, ['owner', 'manager']),
    e164('users_mobile_e164', t.mobile),
    isolation('users'),
  ],
);

export const operators = pgTable(
  'operators',
  {
    id: pk(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
    email: citext('email').notNull().unique('operators_email_uq'),
    displayName: text('display_name').notNull(),
    mobile: text('mobile').notNull(),
    level4Rank: smallint('level4_rank').notNull(),
    passwordHash: text('password_hash').notNull(),
    totpSecretEnc: bytea('totp_secret_enc'),
    totpLastStep: bigint('totp_last_step', { mode: 'number' }),
    disabledAt: ts('disabled_at'),
  },
  (t) => [
    check('operators_rank_values', sql`${t.level4Rank} in (1, 2)`),
    uniqueIndex('operators_active_rank_uq').on(t.level4Rank).where(sql`disabled_at is null`),
    e164('operators_mobile_e164', t.mobile),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: pk(),
    createdAt: createdAt(),
    userId: uuid('user_id').references(() => users.id),
    operatorId: uuid('operator_id').references(() => operators.id),
    csrfTokenHash: bytea('csrf_token_hash').notNull(),
    tokenHash: bytea('token_hash').notNull().unique('sessions_token_hash_uq'),
    lastSeenAt: ts('last_seen_at').notNull(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
  },
  (t) => [check('sessions_one_principal', sql`num_nonnulls(${t.userId}, ${t.operatorId}) = 1`)],
);

export const properties = pgTable(
  'properties',
  {
    id: pk(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
    accountId: uuid('account_id').notNull().references(() => accounts.id),
    label: text('label').notNull(),
    streetAddress: text('street_address').notNull(),
    city: text('city').notNull(),
    emergencyContactPhone: text('emergency_contact_phone'),
    gasEmergencyPhone: text('gas_emergency_phone'),
  },
  (t) => [
    unique('properties_account_id_id_uq').on(t.accountId, t.id),
    unique('properties_account_street_uq').on(t.accountId, t.streetAddress),
    e164('properties_emergency_phone_e164', t.emergencyContactPhone),
    e164('properties_gas_phone_e164', t.gasEmergencyPhone),
    isolation('properties'),
  ],
);

export const units = pgTable(
  'units',
  {
    id: pk(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
    accountId: uuid('account_id').notNull().references(() => accounts.id),
    propertyId: uuid('property_id').notNull(),
    label: text('label').notNull(),
  },
  (t) => [
    unique('units_account_id_id_uq').on(t.accountId, t.id),
    unique('units_account_property_label_uq').on(t.accountId, t.propertyId, t.label),
    foreignKey({ name: 'units_property_fk', columns: [t.accountId, t.propertyId], foreignColumns: [properties.accountId, properties.id] }),
    isolation('units'),
  ],
);

export const tenantContacts = pgTable(
  'tenant_contacts',
  {
    id: pk(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
    accountId: uuid('account_id').notNull().references(() => accounts.id),
    unitId: uuid('unit_id').notNull(),
    name: text('name'),
    mobile: text('mobile'),
    email: citext('email'),
    smsOptedOutAt: ts('sms_opted_out_at'),
    deletedAt: ts('deleted_at'),
  },
  (t) => [
    unique('tenant_contacts_account_id_id_uq').on(t.accountId, t.id),
    foreignKey({ name: 'tenant_contacts_unit_fk', columns: [t.accountId, t.unitId], foreignColumns: [units.accountId, units.id] }),
    check('tenant_contacts_reachable', sql`${t.mobile} is not null or ${t.email} is not null`),
    e164('tenant_contacts_mobile_e164', t.mobile),
    index('tenant_contacts_account_mobile_idx').on(t.accountId, t.mobile),
    index('tenant_contacts_account_email_idx').on(t.accountId, t.email),
    isolation('tenant_contacts'),
  ],
);

export const vendors = pgTable(
  'vendors',
  {
    id: pk(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
    accountId: uuid('account_id').notNull().references(() => accounts.id),
    name: text('name').notNull(),
    mobile: text('mobile'),
    email: citext('email'),
    afterHours: boolean('after_hours').notNull().default(false),
    active: boolean('active').notNull().default(true),
  },
  (t) => [
    unique('vendors_account_id_id_uq').on(t.accountId, t.id),
    uniqueIndex('vendors_account_mobile_uq').on(t.accountId, t.mobile).where(sql`mobile is not null`),
    e164('vendors_mobile_e164', t.mobile),
    isolation('vendors'),
  ],
);

export const vendorTrades = pgTable(
  'vendor_trades',
  {
    id: pk(),
    createdAt: createdAt(),
    accountId: uuid('account_id').notNull().references(() => accounts.id),
    vendorId: uuid('vendor_id').notNull(),
    trade: text('trade').notNull(),
    rank: integer('rank').notNull(),
  },
  (t) => [
    unique('vendor_trades_account_trade_rank_uq').on(t.accountId, t.trade, t.rank),
    unique('vendor_trades_vendor_trade_uq').on(t.vendorId, t.trade),
    foreignKey({ name: 'vendor_trades_vendor_fk', columns: [t.accountId, t.vendorId], foreignColumns: [vendors.accountId, vendors.id] }),
    oneOf('vendor_trades_trade_values', t.trade, TRADE_VALUES),
    isolation('vendor_trades'),
  ],
);

export const oncallShifts = pgTable(
  'oncall_shifts',
  {
    id: pk(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
    accountId: uuid('account_id').notNull().references(() => accounts.id),
    userId: uuid('user_id').notNull(),
    level: smallint('level').notNull(),
    startsAt: ts('starts_at').notNull(),
    endsAt: ts('ends_at').notNull(),
    recurrence: text('recurrence'),
    lastTestPageAt: ts('last_test_page_at'),
    lastTestPageOk: boolean('last_test_page_ok'),
  },
  (t) => [
    foreignKey({ name: 'oncall_shifts_user_fk', columns: [t.accountId, t.userId], foreignColumns: [users.accountId, users.id] }),
    check('oncall_shifts_level_values', sql`${t.level} in (1, 2, 3)`),
    check('oncall_shifts_range', sql`${t.endsAt} > ${t.startsAt}`),
    index('oncall_shifts_lookup_idx').on(t.accountId, t.level, t.startsAt, t.endsAt),
    // Exclusion constraint oncall_shifts_no_overlap: migrations/0001 (CUSTOM_OBJECTS).
    isolation('oncall_shifts'),
  ],
);

export const channels = pgTable(
  'channels',
  {
    id: pk(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
    accountId: uuid('account_id').notNull().references(() => accounts.id),
    kind: text('kind').notNull(),
    address: text('address').notNull(),
    provider: text('provider').notNull(),
    status: text('status').notNull().default('pending'),
    lastInboundAt: ts('last_inbound_at'),
  },
  (t) => [
    unique('channels_account_id_id_uq').on(t.accountId, t.id),
    // B1-004: one address resolves to one account, compared case-insensitively (email local parts and domains).
    uniqueIndex('channels_address_lower_uq').on(sql`lower(${t.address})`),
    oneOf('channels_kind_values', t.kind, ['sms', 'email']),
    isolation('channels'),
  ],
);

// ---------- 3.2 Intake and decision ----------

export const ruleSets = pgTable('rule_sets', {
  id: pk(),
  createdAt: createdAt(),
  version: integer('version').notNull().unique('rule_sets_version_uq'),
  definition: jsonb('definition').notNull(),
  activatedAt: ts('activated_at'),
  checksum: text('checksum').notNull(),
});

export const incidents = pgTable(
  'incidents',
  {
    id: pk(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
    accountId: uuid('account_id').notNull().references(() => accounts.id),
    propertyId: uuid('property_id'),
    hazardClass: text('hazard_class').notNull(),
    tier: text('tier').notNull(),
    state: text('state').notNull().default('open'),
    buildingWide: boolean('building_wide').notNull().default(false),
    buildingWideSetBy: uuid('building_wide_set_by'),
    outcome: text('outcome'),
    outcomeBy: uuid('outcome_by'),
    outcomeAt: ts('outcome_at'),
    downgradeReason: text('downgrade_reason'),
  },
  (t) => [
    unique('incidents_account_id_id_uq').on(t.accountId, t.id),
    foreignKey({ name: 'incidents_property_fk', columns: [t.accountId, t.propertyId], foreignColumns: [properties.accountId, properties.id] }),
    foreignKey({ name: 'incidents_building_wide_by_fk', columns: [t.accountId, t.buildingWideSetBy], foreignColumns: [users.accountId, users.id] }),
    foreignKey({ name: 'incidents_outcome_by_fk', columns: [t.accountId, t.outcomeBy], foreignColumns: [users.accountId, users.id] }),
    oneOf('incidents_tier_values', t.tier, TIER_VALUES),
    oneOf('incidents_state_values', t.state, ['open', 'acknowledged', 'outcome_recorded', 'downgraded', 'closed']),
    oneOf('incidents_outcome_values', t.outcome, ['vendor_dispatched', 'handled_by_phone', 'attending', 'downgraded']),
    check('incidents_building_wide_by', sql`not ${t.buildingWide} or ${t.buildingWideSetBy} is not null`),
    check('incidents_downgrade_reason', sql`${t.state} <> 'downgraded' or ${t.downgradeReason} is not null`),
    index('incidents_duplicate_lookup_idx').on(t.accountId, t.propertyId, t.hazardClass, t.createdAt.desc()).where(sql`state in ('open', 'acknowledged')`),
    isolation('incidents'),
  ],
);

export const requests = pgTable(
  'requests',
  {
    id: pk(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
    accountId: uuid('account_id').notNull().references(() => accounts.id),
    unitId: uuid('unit_id'),
    incidentId: uuid('incident_id'),
    incidentLinkState: text('incident_link_state'),
    cannotText: boolean('cannot_text').notNull().default(false),
    trade: text('trade'),
    tier: text('tier').notNull().default('uncertain'),
    tierSource: text('tier_source').notNull(),
    afterHours: boolean('after_hours').notNull(),
    state: text('state').notNull().default('open'),
    openedAt: ts('opened_at').notNull(),
    closedAt: ts('closed_at'),
  },
  (t) => [
    unique('requests_account_id_id_uq').on(t.accountId, t.id),
    foreignKey({ name: 'requests_unit_fk', columns: [t.accountId, t.unitId], foreignColumns: [units.accountId, units.id] }),
    foreignKey({ name: 'requests_incident_fk', columns: [t.accountId, t.incidentId], foreignColumns: [incidents.accountId, incidents.id] }),
    oneOf('requests_link_state_values', t.incidentLinkState, ['own', 'suggested', 'confirmed', 'rejected']),
    check('requests_link_state_pair', sql`(${t.incidentId} is null) = (${t.incidentLinkState} is null)`),
    oneOf('requests_trade_values', t.trade, TRADE_VALUES),
    oneOf('requests_tier_values', t.tier, TIER_VALUES),
    // `pending` = no decision yet (no rule hit, classifier not finished); shown as `uncertain` (B1 addition, schema.md 3.2).
    oneOf('requests_tier_source_values', t.tierSource, ['pending', 'rule', 'model', 'uncertainty', 'human']),
    check('requests_pending_is_uncertain', sql`${t.tierSource} <> 'pending' or ${t.tier} = 'uncertain'`),
    oneOf('requests_state_values', t.state, ['open', 'awaiting_tenant', 'awaiting_approval', 'dispatched', 'closed']),
    index('requests_inbox_idx').on(t.accountId, t.state, t.tier, t.openedAt.desc()),
    index('requests_incident_idx').on(t.accountId, t.incidentId, t.incidentLinkState),
    index('requests_after_hours_idx').on(t.accountId, t.afterHours, t.openedAt),
    isolation('requests'),
  ],
);

export const outboundMessages = pgTable(
  'outbound_messages',
  {
    id: pk(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
    accountId: uuid('account_id').notNull().references(() => accounts.id),
    purpose: text('purpose').notNull(),
    toAddress: text('to_address').notNull(),
    channel: text('channel').notNull(),
    templateId: text('template_id'),
    templateVersion: integer('template_version'),
    body: text('body').notNull(),
    bodySha256: bytea('body_sha256').notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    status: text('status').notNull().default('pending'),
    statusRank: smallint('status_rank').notNull().default(0),
    providerMessageId: text('provider_message_id'),
    attempts: smallint('attempts').notNull().default(0),
    nextAttemptAt: ts('next_attempt_at'),
    escalationStepId: uuid('escalation_step_id'),
    dispatchId: uuid('dispatch_id'),
    requestId: uuid('request_id'),
    correlationId: uuid('correlation_id').notNull(),
    approvedBy: uuid('approved_by'),
  },
  (t) => [
    unique('outbound_messages_account_id_id_uq').on(t.accountId, t.id),
    unique('outbound_messages_account_dedupe_uq').on(t.accountId, t.dedupeKey),
    foreignKey({ name: 'outbound_messages_approved_by_fk', columns: [t.accountId, t.approvedBy], foreignColumns: [users.accountId, users.id] }),
    oneOf('outbound_messages_purpose_values', t.purpose, ['safety_reply', 'notice', 'tenant_update', 'follow_up', 'page_sms', 'page_voice', 'dispatch', 'digest', 'test_page', 'probe']),
    oneOf('outbound_messages_channel_values', t.channel, ['sms', 'voice', 'email']),
    oneOf('outbound_messages_status_values', t.status, ['pending', 'sending', 'sent', 'delivered', 'undelivered', 'failed', 'unknown']),
    check('outbound_messages_dispatch_approved', sql`${t.purpose} <> 'dispatch' or ${t.approvedBy} is not null`),
    index('outbound_messages_poll_idx').on(t.status, t.createdAt).where(sql`status in ('pending', 'unknown')`),
    index('outbound_messages_provider_id_idx').on(t.providerMessageId),
    index('outbound_messages_to_purpose_idx').on(t.accountId, t.toAddress, t.purpose, t.createdAt),
    isolation('outbound_messages'),
  ],
);

export const inboundMessages = pgTable(
  'inbound_messages',
  {
    id: pk(),
    createdAt: createdAt(),
    accountId: uuid('account_id').notNull().references(() => accounts.id),
    channelId: uuid('channel_id').notNull(),
    provider: text('provider').notNull(),
    providerMessageId: text('provider_message_id').notNull(),
    fromAddress: text('from_address').notNull(),
    body: text('body'),
    mediaCount: smallint('media_count').notNull().default(0),
    /** Carrier keyword (STOP/START/HELP) the message consisted of; the latest STOP/START decides opt-out (FD-7). */
    keyword: text('keyword'),
    receivedAt: ts('received_at').notNull(),
    storedAt: ts('stored_at').notNull().defaultNow(),
    requestId: uuid('request_id'),
    tenantContactId: uuid('tenant_contact_id'),
    correlationId: uuid('correlation_id').notNull(),
    rawPayload: jsonb('raw_payload'),
    safetyReplyId: uuid('safety_reply_id'),
  },
  (t) => [
    unique('inbound_messages_account_id_id_uq').on(t.accountId, t.id),
    uniqueIndex('inbound_messages_provider_id_uq').on(t.provider, t.providerMessageId),
    foreignKey({ name: 'inbound_messages_channel_fk', columns: [t.accountId, t.channelId], foreignColumns: [channels.accountId, channels.id] }),
    foreignKey({ name: 'inbound_messages_request_fk', columns: [t.accountId, t.requestId], foreignColumns: [requests.accountId, requests.id] }),
    foreignKey({ name: 'inbound_messages_tenant_contact_fk', columns: [t.accountId, t.tenantContactId], foreignColumns: [tenantContacts.accountId, tenantContacts.id] }),
    foreignKey({ name: 'inbound_messages_safety_reply_fk', columns: [t.accountId, t.safetyReplyId], foreignColumns: [outboundMessages.accountId, outboundMessages.id] }),
    index('inbound_messages_sender_idx').on(t.accountId, t.fromAddress, t.receivedAt.desc()),
    oneOf('inbound_messages_keyword_values', t.keyword, ['stop', 'start', 'help']),
    isolation('inbound_messages'),
  ],
);

export const attachments = pgTable(
  'attachments',
  {
    id: pk(),
    createdAt: createdAt(),
    accountId: uuid('account_id').notNull().references(() => accounts.id),
    inboundMessageId: uuid('inbound_message_id').notNull(),
    idx: smallint('idx').notNull(),
    storageKey: text('storage_key'),
    contentType: text('content_type'),
    bytes: integer('bytes'),
    status: text('status').notNull().default('pending'),
    descriptionAi: text('description_ai'),
  },
  (t) => [
    unique('attachments_message_idx_uq').on(t.inboundMessageId, t.idx),
    foreignKey({ name: 'attachments_inbound_fk', columns: [t.accountId, t.inboundMessageId], foreignColumns: [inboundMessages.accountId, inboundMessages.id] }),
    oneOf('attachments_status_values', t.status, ['pending', 'stored', 'unavailable', 'rejected']),
    isolation('attachments'),
  ],
);

export const classifications = pgTable(
  'classifications',
  {
    id: pk(),
    createdAt: createdAt(),
    accountId: uuid('account_id').notNull().references(() => accounts.id),
    requestId: uuid('request_id').notNull(),
    inboundMessageId: uuid('inbound_message_id'),
    kind: text('kind').notNull(),
    ruleSetVersion: integer('rule_set_version').references(() => ruleSets.version),
    matchedRule: text('matched_rule'),
    provider: text('provider'),
    model: text('model'),
    promptVersion: text('prompt_version'),
    proposedTier: text('proposed_tier'),
    proposedTrade: text('proposed_trade'),
    proposedUnitId: uuid('proposed_unit_id'),
    confidence: numeric('confidence', { precision: 4, scale: 3 }),
    missingFields: text('missing_fields').array(),
    status: text('status').notNull(),
    actorUserId: uuid('actor_user_id'),
    reason: text('reason'),
  },
  (t) => [
    foreignKey({ name: 'classifications_request_fk', columns: [t.accountId, t.requestId], foreignColumns: [requests.accountId, requests.id] }),
    foreignKey({ name: 'classifications_actor_fk', columns: [t.accountId, t.actorUserId], foreignColumns: [users.accountId, users.id] }),
    oneOf('classifications_kind_values', t.kind, ['rule', 'model', 'human']),
    oneOf('classifications_status_values', t.status, ['ok', 'failed', 'timeout', 'late']),
    oneOf('classifications_tier_values', t.proposedTier, TIER_VALUES),
    check('classifications_human_actor', sql`${t.kind} <> 'human' or ${t.actorUserId} is not null`),
    // Idempotency of the classify job: one model row per (inbound message, model) (TRD 6.3).
    uniqueIndex('classifications_model_once_uq').on(t.inboundMessageId, t.model).where(sql`kind = 'model'`),
    index('classifications_request_idx').on(t.accountId, t.requestId, t.createdAt),
    isolation('classifications'),
  ],
);

// ---------- 3.3 Incident, escalation, dispatch ----------

export const workOrders = pgTable(
  'work_orders',
  {
    id: pk(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
    accountId: uuid('account_id').notNull().references(() => accounts.id),
    requestId: uuid('request_id'),
    incidentId: uuid('incident_id'),
    unitId: uuid('unit_id'),
    trade: text('trade').notNull(),
    tier: text('tier').notNull(),
    summary: text('summary').notNull(),
    accessNotes: text('access_notes'),
    state: text('state').notNull().default('draft'),
  },
  (t) => [
    unique('work_orders_account_id_id_uq').on(t.accountId, t.id),
    foreignKey({ name: 'work_orders_request_fk', columns: [t.accountId, t.requestId], foreignColumns: [requests.accountId, requests.id] }),
    foreignKey({ name: 'work_orders_incident_fk', columns: [t.accountId, t.incidentId], foreignColumns: [incidents.accountId, incidents.id] }),
    foreignKey({ name: 'work_orders_unit_fk', columns: [t.accountId, t.unitId], foreignColumns: [units.accountId, units.id] }),
    oneOf('work_orders_trade_values', t.trade, TRADE_VALUES),
    oneOf('work_orders_tier_values', t.tier, TIER_VALUES),
    oneOf('work_orders_state_values', t.state, ['draft', 'approved', 'sent', 'confirmed', 'no_response', 'closed']),
    check('work_orders_has_parent', sql`${t.requestId} is not null or ${t.incidentId} is not null`),
    uniqueIndex('work_orders_incident_uq').on(t.incidentId).where(sql`incident_id is not null`),
    isolation('work_orders'),
  ],
);

export const dispatches = pgTable(
  'dispatches',
  {
    id: pk(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
    accountId: uuid('account_id').notNull().references(() => accounts.id),
    workOrderId: uuid('work_order_id').notNull(),
    vendorId: uuid('vendor_id'),
    freeTextRecipient: text('free_text_recipient'),
    seq: smallint('seq').notNull(),
    emergency: boolean('emergency').notNull(),
    approvedBy: uuid('approved_by').notNull(),
    approvedAt: ts('approved_at').notNull(),
    confirmDueAt: ts('confirm_due_at').notNull(),
    result: text('result'),
    resultAt: ts('result_at'),
  },
  (t) => [
    unique('dispatches_account_id_id_uq').on(t.accountId, t.id),
    unique('dispatches_work_order_seq_uq').on(t.workOrderId, t.seq),
    foreignKey({ name: 'dispatches_work_order_fk', columns: [t.accountId, t.workOrderId], foreignColumns: [workOrders.accountId, workOrders.id] }),
    foreignKey({ name: 'dispatches_vendor_fk', columns: [t.accountId, t.vendorId], foreignColumns: [vendors.accountId, vendors.id] }),
    foreignKey({ name: 'dispatches_approved_by_fk', columns: [t.accountId, t.approvedBy], foreignColumns: [users.accountId, users.id] }),
    oneOf('dispatches_result_values', t.result, ['confirmed', 'declined', 'timeout', 'undelivered', 'phoned']),
    index('dispatches_due_idx').on(t.confirmDueAt).where(sql`result is null`),
    isolation('dispatches'),
  ],
);

export const escalations = pgTable(
  'escalations',
  {
    id: pk(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
    accountId: uuid('account_id').notNull().references(() => accounts.id),
    incidentId: uuid('incident_id').notNull(),
    trigger: text('trigger').notNull(),
    dispatchId: uuid('dispatch_id'),
    requestId: uuid('request_id'),
    state: text('state').notNull().default('paging'),
    startedAt: ts('started_at').notNull(),
    currentLevel: smallint('current_level').notNull().default(1),
    cycle: integer('cycle').notNull().default(1),
    nextDueAt: ts('next_due_at'),
    companions: jsonb('companions').notNull().default(sql`'[]'::jsonb`),
    operatorEngagedBy: uuid('operator_engaged_by').references(() => operators.id),
    operatorEngagedAt: ts('operator_engaged_at'),
    acknowledgedBy: uuid('acknowledged_by'),
    acknowledgedVia: text('acknowledged_via'),
    relayedByOperatorId: uuid('relayed_by_operator_id').references(() => operators.id),
    acknowledgedAt: ts('acknowledged_at'),
    tenantNoticeSentAt: ts('tenant_notice_sent_at'),
    outcomeReminderSentAt: ts('outcome_reminder_sent_at'),
    policyVersion: integer('policy_version').notNull(),
  },
  (t) => [
    unique('escalations_account_id_id_uq').on(t.accountId, t.id),
    foreignKey({ name: 'escalations_incident_fk', columns: [t.accountId, t.incidentId], foreignColumns: [incidents.accountId, incidents.id] }),
    foreignKey({ name: 'escalations_dispatch_fk', columns: [t.accountId, t.dispatchId], foreignColumns: [dispatches.accountId, dispatches.id] }),
    foreignKey({ name: 'escalations_request_fk', columns: [t.accountId, t.requestId], foreignColumns: [requests.accountId, requests.id] }),
    foreignKey({ name: 'escalations_acknowledged_by_fk', columns: [t.accountId, t.acknowledgedBy], foreignColumns: [users.accountId, users.id] }),
    oneOf('escalations_trigger_values', t.trigger, ['new_incident', 'uncertain_timeout', 'no_outcome', 'dispatch_failed', 'new_unit_report']),
    check('escalations_dispatch_trigger', sql`${t.trigger} <> 'dispatch_failed' or ${t.dispatchId} is not null`),
    uniqueIndex('escalations_dispatch_uq').on(t.dispatchId).where(sql`dispatch_id is not null`),
    oneOf('escalations_state_values', t.state, ['paging', 'acknowledged']),
    oneOf('escalations_ack_via_values', t.acknowledgedVia, ['voice', 'link', 'app', 'operator_relay']),
    check('escalations_relay_pair', sql`(${t.acknowledgedVia} = 'operator_relay') = (${t.relayedByOperatorId} is not null)`),
    check('escalations_ack_person', sql`${t.state} <> 'acknowledged' or ${t.acknowledgedBy} is not null`),
    uniqueIndex('escalations_one_paging_uq').on(t.incidentId).where(sql`state = 'paging'`),
    // B1: the acknowledged escalation keeps next_due_at for the EP-7 reminder and EP-11a reopen (schema.md 5 updated).
    index('escalations_due_idx').on(t.nextDueAt).where(sql`next_due_at is not null`),
    isolation('escalations'),
  ],
);

export const escalationSteps = pgTable(
  'escalation_steps',
  {
    id: pk(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
    accountId: uuid('account_id').notNull().references(() => accounts.id),
    escalationId: uuid('escalation_id').notNull(),
    cycle: integer('cycle').notNull(),
    level: smallint('level').notNull(),
    attempt: smallint('attempt').notNull(),
    targetRole: text('target_role').notNull(),
    targetUserId: uuid('target_user_id'),
    targetOperatorId: uuid('target_operator_id').references(() => operators.id),
    dueAt: ts('due_at').notNull(),
    startedAt: ts('started_at'),
    result: text('result'),
  },
  (t) => [
    unique('escalation_steps_account_id_id_uq').on(t.accountId, t.id),
    foreignKey({ name: 'escalation_steps_escalation_fk', columns: [t.accountId, t.escalationId], foreignColumns: [escalations.accountId, escalations.id] }),
    foreignKey({ name: 'escalation_steps_user_fk', columns: [t.accountId, t.targetUserId], foreignColumns: [users.accountId, users.id] }),
    check('escalation_steps_level_values', sql`${t.level} in (1, 2, 3, 4)`),
    oneOf('escalation_steps_role_values', t.targetRole, ['oncall', 'previous_acknowledger', 'approver', 'operator_primary', 'operator_backup']),
    check('escalation_steps_level4_operator', sql`(${t.level} = 4) = (${t.targetOperatorId} is not null or ${t.targetRole} in ('operator_primary', 'operator_backup'))`),
    oneOf('escalation_steps_result_values', t.result, ['acknowledged', 'operator_engaged', 'timeout', 'delivery_failed', 'superseded', 'no_target']),
    unique('escalation_steps_key_uq').on(t.escalationId, t.cycle, t.level, t.attempt, t.targetRole),
    isolation('escalation_steps'),
  ],
);

export const capabilityTokens = pgTable(
  'capability_tokens',
  {
    id: pk(),
    createdAt: createdAt(),
    accountId: uuid('account_id').notNull().references(() => accounts.id),
    purpose: text('purpose').notNull(),
    tokenHash: bytea('token_hash').notNull().unique('capability_tokens_hash_uq'),
    escalationStepId: uuid('escalation_step_id'),
    userId: uuid('user_id'),
    dispatchId: uuid('dispatch_id'),
    expiresAt: ts('expires_at').notNull(),
    usedAt: ts('used_at'),
  },
  (t) => [
    foreignKey({ name: 'capability_tokens_step_fk', columns: [t.accountId, t.escalationStepId], foreignColumns: [escalationSteps.accountId, escalationSteps.id] }),
    foreignKey({ name: 'capability_tokens_user_fk', columns: [t.accountId, t.userId], foreignColumns: [users.accountId, users.id] }),
    foreignKey({ name: 'capability_tokens_dispatch_fk', columns: [t.accountId, t.dispatchId], foreignColumns: [dispatches.accountId, dispatches.id] }),
    oneOf('capability_tokens_purpose_values', t.purpose, ['ack', 'vendor']),
    check('capability_tokens_ack_targets', sql`${t.purpose} <> 'ack' or (${t.escalationStepId} is not null and ${t.userId} is not null)`),
    check('capability_tokens_vendor_target', sql`${t.purpose} <> 'vendor' or ${t.dispatchId} is not null`),
    isolation('capability_tokens'),
  ],
);

// ---------- 3.4 Operations ----------

export const auditEvents = pgTable(
  'audit_events',
  {
    id: pk(),
    createdAt: createdAt(),
    accountId: uuid('account_id').notNull().references(() => accounts.id),
    actorKind: text('actor_kind').notNull(),
    actorId: uuid('actor_id'),
    action: text('action').notNull(),
    objectType: text('object_type').notNull(),
    objectId: uuid('object_id').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    reason: text('reason'),
    correlationId: uuid('correlation_id').notNull(),
  },
  (t) => [
    oneOf('audit_events_actor_values', t.actorKind, ['user', 'operator', 'system', 'tenant', 'vendor', 'provider']),
    index('audit_events_object_idx').on(t.accountId, t.objectType, t.objectId, t.createdAt),
    isolation('audit_events'),
  ],
);

/** B1 addition (replaces pg-boss, AD-02 note): account-scoped job rows, polled through view `due_jobs`. */
export const jobs = pgTable(
  'jobs',
  {
    id: pk(),
    createdAt: createdAt(),
    accountId: uuid('account_id').notNull().references(() => accounts.id),
    kind: text('kind').notNull(),
    payload: jsonb('payload').notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    runAt: ts('run_at').notNull(),
    state: text('state').notNull().default('queued'),
    attempts: smallint('attempts').notNull().default(0),
    lastError: text('last_error'),
    correlationId: uuid('correlation_id').notNull(),
    finishedAt: ts('finished_at'),
  },
  (t) => [
    unique('jobs_account_dedupe_uq').on(t.accountId, t.dedupeKey),
    oneOf('jobs_kind_values', t.kind, ['intake.process', 'classify', 'triage.timeout']),
    // `dismissed`: an operator cleared a dead job (fix round 2); the decision sweep still covers its request (B1-001).
    oneOf('jobs_state_values', t.state, ['queued', 'done', 'dead', 'dismissed']),
    index('jobs_due_idx').on(t.runAt).where(sql`state = 'queued'`),
    isolation('jobs'),
  ],
);

/** B1 addition: stored responses for `Idempotency-Key` on mutations (TRD 5.1). */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: pk(),
    createdAt: createdAt(),
    accountId: uuid('account_id').notNull().references(() => accounts.id),
    key: text('key').notNull(),
    route: text('route').notNull(),
    responseStatus: smallint('response_status').notNull(),
    responseBody: jsonb('response_body').notNull(),
  },
  (t) => [unique('idempotency_keys_account_key_uq').on(t.accountId, t.key, t.route), isolation('idempotency_keys')],
);

export const probeRuns = pgTable(
  'probe_runs',
  {
    id: pk(),
    createdAt: createdAt(),
    kind: text('kind').notNull(),
    sentAt: ts('sent_at').notNull(),
    receivedAt: ts('received_at'),
    ok: boolean('ok'),
  },
  (t) => [oneOf('probe_runs_kind_values', t.kind, ['sms_round_trip', 'email_inbound'])],
);

/** B1 addition: delivery-status events whose provider ID is not yet known (IT-09). Global, no personal data. */
export const pendingStatusEvents = pgTable(
  'pending_status_events',
  {
    id: pk(),
    createdAt: createdAt(),
    provider: text('provider').notNull(),
    providerMessageId: text('provider_message_id').notNull(),
    status: text('status').notNull(),
    receivedAt: ts('received_at').notNull(),
    attempts: integer('attempts').notNull().default(0),
  },
  (t) => [
    oneOf('pending_status_events_status_values', t.status, ['sent', 'delivered', 'undelivered', 'failed']),
    index('pending_status_events_provider_id_idx').on(t.providerMessageId),
  ],
);

/**
 * B1-004: a message whose destination resolves to no channel. Global (no account is known), metadata only: no
 * sender, no text (the provider keeps the message; the operator fetches it by ID). An uncleared row fails /readyz,
 * so the external monitor alerts both operators.
 */
export const unroutedInbound = pgTable(
  'unrouted_inbound',
  {
    id: pk(),
    createdAt: createdAt(),
    provider: text('provider').notNull(),
    kind: text('kind').notNull(),
    providerMessageId: text('provider_message_id').notNull(),
    toAddress: text('to_address').notNull(),
    receivedAt: ts('received_at').notNull(),
    clearedAt: ts('cleared_at'),
    clearedByOperatorId: uuid('cleared_by_operator_id').references(() => operators.id),
  },
  (t) => [
    uniqueIndex('unrouted_inbound_provider_id_uq').on(t.provider, t.providerMessageId),
    oneOf('unrouted_inbound_kind_values', t.kind, ['sms', 'email']),
    index('unrouted_inbound_open_idx').on(t.receivedAt).where(sql`cleared_at is null`),
  ],
);

/** Account-owned tables: each has account_id, RLS enabled and forced, and a case in IT-10. */
export const ACCOUNT_TABLES = [
  'accounts', 'users', 'properties', 'units', 'tenant_contacts', 'vendors', 'vendor_trades', 'oncall_shifts', 'channels',
  'incidents', 'requests', 'outbound_messages', 'inbound_messages', 'attachments', 'classifications', 'work_orders', 'dispatches',
  'escalations', 'escalation_steps', 'capability_tokens', 'audit_events', 'jobs', 'idempotency_keys',
] as const;

export const GLOBAL_TABLES = ['operators', 'sessions', 'rule_sets', 'probe_runs', 'pending_status_events', 'unrouted_inbound'] as const;

/** Objects created by migrations/0001 that Drizzle cannot express; checked by the ORM-diff test (IT-14). */
export const CUSTOM_OBJECTS = {
  constraints: ['oncall_shifts_no_overlap'],
  triggers: ['requests_tier_guard', 'incidents_tier_guard', 'audit_events_no_change', 'accounts_validate'],
  functions: ['resolve_channel', 'resolve_session', 'resolve_login', 'resolve_capability', 'resolve_outbound'],
  views: ['due_escalations', 'pending_outbox', 'due_dispatches', 'sweep_accounts', 'due_jobs', 'due_undecided', 'job_health', 'dead_jobs'],
} as const;
