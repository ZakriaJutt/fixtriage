// Tenant addressing and opt-out (FD-7, MH-15). The latest STOP/START keyword from an address decides opt-out.
import { sql, type Tx } from '@fixtriage/db';
import type { Channel } from '@fixtriage/platform';

export async function smsOptedOut(tx: Tx, address: string, before?: Date): Promise<boolean> {
  const r = await tx.execute(sql`
    select keyword from inbound_messages
    where from_address = ${address} and keyword in ('stop', 'start') ${before ? sql`and received_at <= ${before}` : sql``}
    order by received_at desc, stored_at desc limit 1`);
  return (r.rows[0] as { keyword?: string } | undefined)?.keyword === 'stop';
}

export interface TenantContactRow {
  id: string;
  unit_id: string;
  email: string | null;
  mobile: string | null;
}

export async function findTenantContact(tx: Tx, kind: 'sms' | 'email', address: string): Promise<TenantContactRow | null> {
  const r = await tx.execute(
    kind === 'sms'
      ? sql`select id, unit_id, email, mobile from tenant_contacts where mobile = ${address} and deleted_at is null order by created_at limit 1`
      : sql`select id, unit_id, email, mobile from tenant_contacts where email = ${address}::citext and deleted_at is null order by created_at limit 1`,
  );
  return (r.rows[0] as TenantContactRow | undefined) ?? null;
}

/** Where a tenant message for this request goes: SMS unless opted out, then email if known, else nowhere (FD-7, HI-12). */
export async function tenantChannelFor(tx: Tx, requestId: string, _now: Date): Promise<{ channel: Channel; to: string } | null> {
  const r = await tx.execute(sql`
    select i.from_address, c.kind, tc.email from inbound_messages i
    join channels c on c.id = i.channel_id
    left join tenant_contacts tc on tc.id = i.tenant_contact_id and tc.deleted_at is null
    where i.request_id = ${requestId} order by i.received_at limit 1`);
  const row = r.rows[0] as { from_address: string; kind: string; email: string | null } | undefined;
  if (!row) return null;
  if (row.kind === 'email') return { channel: 'email', to: row.from_address };
  if (!(await smsOptedOut(tx, row.from_address))) return { channel: 'sms', to: row.from_address };
  return row.email ? { channel: 'email', to: row.email } : null;
}
