/**
 * Database base class and helpers shared by the server (Node SQLite) and the phone (expo-sqlite).
 * Nothing in this file may import Node-only modules.
 */

export type Row = Record<string, any>;

export const SCHEMA = `
create table if not exists tenant (
  id text primary key, name text not null, created_at text not null
);
create table if not exists app_user (
  id text primary key, tenant_id text not null references tenant,
  email text not null unique collate nocase, name text not null, password_hash text not null,
  role text not null, status text not null default 'active',
  failed_logins integer not null default 0, locked_until text, created_at text not null
);
create table if not exists auth_session (
  id text primary key, tenant_id text not null references tenant, user_id text not null references app_user,
  refresh_hash text not null, device_name text not null default '', expires_at text not null,
  revoked_at text, created_at text not null, last_used_at text not null
);
create table if not exists counter (
  tenant_id text not null references tenant, key text not null, value integer not null,
  primary key (tenant_id, key)
);
create table if not exists business (
  id text primary key, tenant_id text not null references tenant,
  legal_name text not null, trading_name text not null default '', owner_name text not null default '',
  logo text not null default '', registration_no text not null default '', ntn text not null default '',
  phone text not null default '', whatsapp text not null default '', email text not null default '',
  address text not null default '', website text not null default '', bank_details text not null default '',
  iban text not null default '', payment_instructions text not null default '',
  signature text not null default '', stamp text not null default '', invoice_footer text not null default '',
  currency text not null default 'PKR', currency_precision integer not null default 2,
  invoice_prefix text not null default 'INV-', tax_inclusive integer not null default 0,
  rounding text not null default 'none', status text not null default 'active', created_at text not null
);
create table if not exists client (
  id text primary key, tenant_id text not null references tenant,
  name text not null, contact_person text not null default '', phone text not null default '',
  whatsapp text not null default '', email text not null default '', cnic text not null default '',
  ntn text not null default '', address text not null default '', city text not null default '',
  province text not null default '', country text not null default '',
  extra_addresses text not null default '[]', extra_contacts text not null default '[]',
  category text not null default '', opening_balance integer not null default 0,
  notes text not null default '', status text not null default 'active', created_at text not null
);
create index if not exists client_tenant on client (tenant_id, name);
create table if not exists service (
  id text primary key, tenant_id text not null references tenant,
  name text not null, category text not null default '', description text not null default '',
  default_price integer not null default 0, unit text not null default '',
  tax_rate_bp integer not null default 0, default_discount_bp integer not null default 0,
  status text not null default 'active', created_at text not null
);
create index if not exists service_tenant on service (tenant_id, name);
create table if not exists invoice (
  id text primary key, tenant_id text not null references tenant,
  business_id text not null references business, client_id text not null references client,
  number text, status text not null check (status in ('draft','final','cancelled')),
  issue_date text not null, due_date text not null, reference text not null default '',
  billing_address text not null default '', lines text not null, charges text not null default '[]',
  overall_discount_type text not null default 'percent', overall_discount_value integer not null default 0,
  notes text not null default '', payment_terms text not null default '',
  currency text not null, currency_precision integer not null, tax_inclusive integer not null, rounding text not null,
  subtotal integer not null, item_discounts integer not null, overall_discount integer not null,
  taxable_amount integer not null, tax_amount integer not null, charges_total integer not null,
  rounding_adjustment integer not null, total integer not null,
  client_request_id text, created_by text not null, created_at text not null, updated_at text not null,
  finalized_at text, cancelled_at text, cancel_reason text,
  unique (tenant_id, client_request_id),
  unique (business_id, number)
);
create index if not exists invoice_tenant on invoice (tenant_id, issue_date);
create index if not exists invoice_client on invoice (tenant_id, client_id);
create table if not exists installment (
  id text primary key, tenant_id text not null references tenant, invoice_id text not null references invoice,
  seq integer not null, due_date text not null, amount integer not null check (amount > 0)
);
create index if not exists installment_invoice on installment (invoice_id, seq);
create table if not exists payment (
  id text primary key, tenant_id text not null references tenant,
  number text not null, client_id text not null references client, business_id text not null references business,
  amount integer not null check (amount > 0), date text not null, method text not null,
  reference text not null default '', notes text not null default '', proof text not null default '',
  received_by text not null, received_by_name text not null,
  verification_status text not null check (verification_status in ('pending','verified','rejected')),
  client_request_id text, created_at text not null,
  unique (tenant_id, number), unique (tenant_id, client_request_id)
);
create index if not exists payment_client on payment (tenant_id, client_id);
create table if not exists payment_allocation (
  id text primary key, tenant_id text not null references tenant,
  payment_id text not null references payment, invoice_id text not null references invoice,
  amount integer not null check (amount > 0), created_at text not null
);
create index if not exists alloc_invoice on payment_allocation (invoice_id);
create index if not exists alloc_payment on payment_allocation (payment_id);
create table if not exists finance_entry (
  id text primary key, tenant_id text not null references tenant, business_id text not null references business,
  type text not null check (type in ('income','expense')), category text not null,
  amount integer not null check (amount > 0), date text not null, method text not null default 'cash',
  party text not null default '', notes text not null default '', created_by text not null, created_at text not null
);
create index if not exists finance_tenant on finance_entry (tenant_id, date);
create table if not exists quotation (
  id text primary key, tenant_id text not null references tenant,
  business_id text not null references business, client_id text not null references client,
  number text not null, status text not null check (status in ('draft','sent','accepted','rejected')),
  issue_date text not null, valid_until text not null, reference text not null default '',
  billing_address text not null default '', lines text not null, charges text not null default '[]',
  overall_discount_type text not null default 'percent', overall_discount_value integer not null default 0,
  notes text not null default '', terms text not null default '',
  currency text not null, currency_precision integer not null, tax_inclusive integer not null, rounding text not null,
  subtotal integer not null, item_discounts integer not null, overall_discount integer not null,
  taxable_amount integer not null, tax_amount integer not null, charges_total integer not null,
  rounding_adjustment integer not null, total integer not null,
  converted_invoice_id text references invoice, client_request_id text,
  created_by text not null, created_at text not null, updated_at text not null,
  unique (tenant_id, client_request_id), unique (business_id, number)
);
create index if not exists quotation_tenant on quotation (tenant_id, issue_date);
create table if not exists recurring_invoice (
  id text primary key, tenant_id text not null references tenant, name text not null,
  business_id text not null references business, client_id text not null references client,
  reference text not null default '', billing_address text not null default '',
  lines text not null, charges text not null default '[]',
  overall_discount_type text not null default 'percent', overall_discount_value integer not null default 0,
  notes text not null default '', payment_terms text not null default '',
  frequency text not null check (frequency in ('weekly','monthly','yearly','custom')),
  interval_count integer not null default 1, start_date text not null, end_date text,
  due_days integer not null default 0, auto_issue integer not null default 0,
  status text not null default 'active' check (status in ('active','paused','ended')),
  generated_count integer not null default 0, last_generated_at text,
  created_by text not null, created_at text not null, updated_at text not null
);
create index if not exists recurring_tenant on recurring_invoice (tenant_id, status);
create table if not exists money_account (
  id text primary key, tenant_id text not null references tenant, business_id text not null references business,
  name text not null, type text not null check (type in ('cash','bank','wallet')),
  institution text not null default '', account_number text not null default '', currency text not null,
  opening_balance integer not null default 0, opening_date text not null, is_default integer not null default 0,
  status text not null default 'active' check (status in ('active','archived')), created_at text not null
);
create index if not exists account_business on money_account (tenant_id, business_id);
create table if not exists purchase (
  id text primary key, tenant_id text not null references tenant, business_id text not null references business,
  number text not null, supplier text not null, bill_no text not null default '', date text not null,
  lines text not null, total integer not null check (total > 0), category text not null default 'Purchases',
  method text not null default 'cash', account_id text, notes text not null default '', attachment text not null default '',
  client_request_id text, created_by text not null, created_at text not null, updated_at text not null,
  unique (tenant_id, number), unique (tenant_id, client_request_id)
);
create index if not exists purchase_tenant on purchase (tenant_id, date);
create table if not exists transfer (
  id text primary key, tenant_id text not null references tenant, business_id text not null references business,
  from_account_id text not null references money_account, to_account_id text not null references money_account,
  amount integer not null check (amount > 0), to_amount integer not null check (to_amount > 0), date text not null,
  reference text not null default '', notes text not null default '', client_request_id text,
  created_by text not null, created_at text not null, unique (tenant_id, client_request_id)
);
create table if not exists client_refund (
  id text primary key, tenant_id text not null references tenant, business_id text not null references business,
  client_id text not null references client, account_id text not null references money_account,
  amount integer not null check (amount > 0), date text not null, method text not null, notes text not null default '',
  created_by text not null, created_at text not null
);
create table if not exists exchange_rate (
  id text primary key, tenant_id text not null references tenant, currency text not null, base_currency text not null,
  rate integer not null check (rate > 0), date text not null, note text not null default '',
  created_by text not null, created_at text not null
);
create index if not exists rate_lookup on exchange_rate (tenant_id, currency, base_currency, date);
create table if not exists audit_log (
  id text primary key, tenant_id text not null references tenant, user_id text,
  action text not null, entity text not null, entity_id text, detail text not null default '{}', at text not null
);
create index if not exists audit_tenant on audit_log (tenant_id, at);
create table if not exists supplier (
  id text primary key, tenant_id text not null references tenant,
  name text not null, contact_person text not null default '', phone text not null default '', email text not null default '',
  address text not null default '', ntn text not null default '', opening_balance integer not null default 0,
  notes text not null default '', status text not null default 'active', custom text not null default '{}', created_at text not null
);
create index if not exists supplier_tenant on supplier (tenant_id, name);
create table if not exists stock_move (
  id text primary key, tenant_id text not null references tenant, item_id text not null references service,
  date text not null, qty integer not null, unit_cost integer not null default 0,
  kind text not null check (kind in ('opening','receipt','purchase','sale','adjust','return')),
  ref_type text not null default '', ref_id text, ref_number text not null default '', note text not null default '',
  created_by text not null, created_at text not null
);
create index if not exists stock_item on stock_move (tenant_id, item_id, date);
create index if not exists stock_ref on stock_move (tenant_id, ref_type, ref_id);
create table if not exists purchase_request (
  id text primary key, tenant_id text not null references tenant, business_id text not null references business,
  number text not null, date text not null, needed_by text not null default '', lines text not null, notes text not null default '',
  status text not null check (status in ('pending','approved','rejected','ordered')),
  requested_by text not null, requested_by_name text not null, decided_by_name text not null default '', decided_at text,
  decision_note text not null default '', order_id text, created_at text not null, updated_at text not null,
  unique (tenant_id, number)
);
create table if not exists purchase_order (
  id text primary key, tenant_id text not null references tenant, business_id text not null references business,
  number text not null, supplier_id text not null references supplier, request_id text, date text not null,
  expected_date text not null default '', lines text not null, total integer not null, notes text not null default '',
  terms text not null default '', status text not null check (status in ('draft','sent','partial','received','closed','cancelled')),
  created_by text not null, created_at text not null, updated_at text not null, unique (tenant_id, number)
);
create index if not exists order_tenant on purchase_order (tenant_id, date);
create table if not exists goods_receipt (
  id text primary key, tenant_id text not null references tenant, business_id text not null references business,
  number text not null, supplier_id text not null references supplier, order_id text, date text not null,
  lines text not null, total integer not null, notes text not null default '', purchase_id text,
  created_by text not null, created_at text not null, unique (tenant_id, number)
);
create index if not exists receipt_tenant on goods_receipt (tenant_id, date);
create table if not exists cheque (
  id text primary key, tenant_id text not null references tenant, business_id text not null references business,
  direction text not null check (direction in ('in','out')), number text not null, bank text not null default '',
  party text not null, client_id text, supplier_id text, amount integer not null check (amount > 0),
  cheque_date text not null, received_date text not null,
  status text not null check (status in ('pending','deposited','cleared','bounced','cancelled')), status_date text,
  account_id text, payment_id text, purchase_id text, notes text not null default '', created_by text not null, created_at text not null
);
create index if not exists cheque_tenant on cheque (tenant_id, cheque_date);
create table if not exists loan (
  id text primary key, tenant_id text not null references tenant, business_id text not null references business,
  direction text not null check (direction in ('borrowed','lent')), party text not null, principal integer not null,
  rate_bp integer not null default 0, start_date text not null, end_date text not null default '',
  installment_amount integer not null default 0, notes text not null default '',
  status text not null default 'active' check (status in ('active','closed')), created_by text not null, created_at text not null
);
create table if not exists loan_txn (
  id text primary key, tenant_id text not null references tenant, loan_id text not null references loan,
  kind text not null check (kind in ('disbursement','repayment','interest')), amount integer not null check (amount > 0),
  date text not null, account_id text not null references money_account, notes text not null default '',
  created_by text not null, created_at text not null
);
create index if not exists loan_txn_account on loan_txn (tenant_id, account_id, date);
create table if not exists budget (
  id text primary key, tenant_id text not null references tenant, business_id text not null references business,
  category text not null, month text not null, amount integer not null, created_at text not null
);
create index if not exists budget_lookup on budget (tenant_id, business_id, month);
create table if not exists day_close (
  id text primary key, tenant_id text not null references tenant, business_id text not null references business,
  account_id text not null references money_account, date text not null, expected integer not null, counted integer not null,
  difference integer not null, notes text not null default '', entry_id text, closed_by_name text not null, created_at text not null
);
create index if not exists day_close_business on day_close (tenant_id, business_id, date);
create table if not exists reminder (
  id text primary key, tenant_id text not null references tenant, client_id text not null references client, invoice_id text,
  channel text not null, note text not null default '', promise_date text not null default '', by_name text not null, created_at text not null
);
create index if not exists reminder_client on reminder (tenant_id, client_id, created_at);
create table if not exists credit_note (
  id text primary key, tenant_id text not null references tenant, business_id text not null references business,
  client_id text not null references client, invoice_id text not null references invoice, number text not null, date text not null,
  lines text not null, reason text not null default '', total integer not null check (total > 0), restock integer not null default 0,
  status text not null check (status in ('final','cancelled')), created_by text not null, created_at text not null
);
create index if not exists credit_note_invoice on credit_note (invoice_id);
create table if not exists employee (
  id text primary key, tenant_id text not null references tenant, business_id text not null references business,
  name text not null, phone text not null default '', cnic text not null default '', designation text not null default '',
  join_date text not null default '', pay_type text not null default 'monthly' check (pay_type in ('monthly','daily')),
  rate integer not null default 0, bank_account text not null default '', status text not null default 'active',
  notes text not null default '', created_at text not null
);
create table if not exists payroll_run (
  id text primary key, tenant_id text not null references tenant, business_id text not null references business, month text not null,
  status text not null check (status in ('draft','submitted','approved','paid')), created_by_name text not null,
  approved_by_name text not null default '', paid_date text, account_id text, created_at text not null,
  unique (tenant_id, business_id, month)
);
create table if not exists payslip (
  id text primary key, tenant_id text not null references tenant, run_id text not null references payroll_run, employee_id text not null references employee,
  employee_name text not null, designation text not null default '', pay_type text not null, rate integer not null,
  days real not null, days_in_month integer not null, earned integer not null, overtime integer not null default 0,
  allowances integer not null default 0, bonus integer not null default 0, deductions integer not null default 0,
  tax integer not null default 0, advance_recovery integer not null default 0, net integer not null, notes text not null default ''
);
create index if not exists payslip_run on payslip (run_id);
create table if not exists expense_claim (
  id text primary key, tenant_id text not null references tenant, business_id text not null references business, number text not null,
  date text not null, category text not null, amount integer not null check (amount > 0), description text not null default '',
  receipt text not null default '', status text not null check (status in ('pending','approved','rejected','paid')),
  claimed_by text not null, claimed_by_name text not null, decided_by_name text not null default '', decision_note text not null default '',
  finance_entry_id text, created_at text not null
);
create table if not exists ai_config (
  tenant_id text primary key references tenant, provider text not null, api_key text not null default '', model text not null default '', updated_at text not null
);
create table if not exists automation_rule (
  id text primary key, tenant_id text not null references tenant, kind text not null check (kind in ('categorize','alert')),
  name text not null default '', enabled integer not null default 1, config text not null, created_at text not null
);
create table if not exists ai_usage (
  tenant_id text not null references tenant, month text not null, count integer not null default 0, primary key (tenant_id, month)
);
create table if not exists plan_request (
  id text primary key, tenant_id text not null references tenant, plan text not null, note text not null default '', phone text not null default '',
  by_name text not null, status text not null default 'open', created_at text not null
);
create table if not exists platform_setting (
  key text primary key, value text not null, updated_at text not null
);
create table if not exists pos_shift (
  id text primary key, tenant_id text not null references tenant, business_id text not null references business, account_id text not null,
  opened_by text not null, opened_by_name text not null, opened_at text not null, opening_float integer not null default 0,
  status text not null check (status in ('open','closed')), closed_at text, closed_by_name text not null default '',
  counted integer, expected integer, difference integer, notes text not null default ''
);
create table if not exists pos_cash_move (
  id text primary key, tenant_id text not null references tenant, shift_id text not null references pos_shift,
  kind text not null check (kind in ('in','out')), amount integer not null, reason text not null, by_name text not null, at text not null
);
create table if not exists pos_held (
  id text primary key, tenant_id text not null references tenant, name text not null, client_id text, lines text not null,
  bill_discount integer not null default 0, by_name text not null, created_at text not null
);
create table if not exists auth_code (
  id text primary key, user_id text not null, purpose text not null, channel text not null, target text not null,
  code_hash text not null, attempts integer not null default 0, expires_at text not null, used_at text, created_at text not null
);
create index if not exists auth_code_user on auth_code (user_id, purpose);
create table if not exists site_lead (
  id text primary key, name text not null, business text not null default '', phone text not null default '', email text not null default '',
  plan text not null default '', message text not null default '', status text not null default 'new', ip text not null default '', created_at text not null
);
create table if not exists push_device (
  id text primary key, tenant_id text not null, user_id text not null, token text not null unique, platform text not null default 'android',
  created_at text not null, last_seen text not null
);
create table if not exists api_key (
  id text primary key, tenant_id text not null references tenant, name text not null, prefix text not null, hash text not null unique,
  role text not null, created_by text not null, created_at text not null, last_used_at text, revoked_at text
);
create table if not exists webhook (
  id text primary key, tenant_id text not null references tenant, url text not null, events text not null, secret text not null,
  active integer not null default 1, last_status text, last_at text, created_at text not null
);
create table if not exists attendance (
  id text primary key, tenant_id text not null references tenant, employee_id text not null, date text not null,
  status text not null default 'present', check_in text not null default '', check_out text not null default '', method text not null default 'manual',
  late integer not null default 0, note text not null default '', created_at text not null, unique (tenant_id, employee_id, date)
);
create table if not exists recon_match (
  id text primary key, tenant_id text not null references tenant, account_id text not null, ref_key text not null, statement_date text not null,
  description text not null default '', amount integer not null, created_by text not null, created_at text not null, unique (tenant_id, account_id, ref_key)
);
create table if not exists tenant_setting (
  tenant_id text not null references tenant, key text not null, value text not null, updated_at text not null, primary key (tenant_id, key)
);
create table if not exists promotion (
  id text primary key, tenant_id text not null references tenant, name text not null, active integer not null default 1, config text not null, created_at text not null
);
create table if not exists loyalty_txn (
  id text primary key, tenant_id text not null references tenant, client_id text not null, points integer not null, reason text not null default '', invoice_id text, created_at text not null
);
create index if not exists loyalty_client on loyalty_txn (tenant_id, client_id);
create table if not exists gift_card (
  id text primary key, tenant_id text not null references tenant, code text not null, initial integer not null, balance integer not null,
  client_name text not null default '', status text not null default 'active', created_at text not null, unique (tenant_id, code)
);
create table if not exists table_order (
  id text primary key, tenant_id text not null references tenant, number text not null, kind text not null, table_name text not null default '',
  guests integer not null default 0, customer text not null default '', phone text not null default '', address text not null default '',
  waiter text not null default '', lines text not null default '[]', status text not null default 'open', source text not null default 'pos',
  rider text not null default '', delivery_status text not null default '', invoice_ids text not null default '[]', created_at text not null, updated_at text not null
);
create index if not exists order_open on table_order (tenant_id, status);
create table if not exists kot (
  id text primary key, tenant_id text not null references tenant, number integer not null, order_id text not null, section text not null,
  items text not null, status text not null default 'new', created_at text not null
);
create table if not exists appointment (
  id text primary key, tenant_id text not null references tenant, client_id text, client_name text not null, phone text not null default '',
  service_id text, staff_id text, date text not null, time text not null default '', minutes integer not null default 30,
  status text not null default 'booked', notes text not null default '', walk_in integer not null default 0, held_id text, created_at text not null
);
create index if not exists appointment_day on appointment (tenant_id, date);
create table if not exists shop_link (
  token text primary key, tenant_id text not null
);
create table if not exists stock_alert_config (
  tenant_id text primary key references tenant, config text not null, updated_at text not null
);
create table if not exists label_template (
  id text primary key, tenant_id text not null references tenant, name text not null, config text not null, created_at text not null, updated_at text not null
);
create table if not exists alert_dismissal (
  tenant_id text not null references tenant, key text not null, dismissed_at text not null, primary key (tenant_id, key)
);
`;

/** Columns added after the first release, applied to older databases on start. */
export const MIGRATIONS: [table: string, column: string, definition: string][] = [
  [
    "business",
    "invoice_template",
    "text not null default 'amber'"
  ],
  [
    "business",
    "accent_color",
    "text not null default ''"
  ],
  [
    "invoice",
    "recurring_id",
    "text"
  ],
  [
    "business",
    "fy_start_month",
    "integer not null default 7"
  ],
  [
    "business",
    "number_reset",
    "text not null default 'never'"
  ],
  [
    "business",
    "dashboard_style",
    "text not null default 'classic'"
  ],
  [
    "business",
    "invoice_disclaimer",
    "text not null default ''"
  ],
  [
    "purchase",
    "reference",
    "text not null default ''"
  ],
  [
    "purchase",
    "installments",
    "text not null default '[]'"
  ],
  [
    "client",
    "credit_limit",
    "integer not null default 0"
  ],
  [
    "invoice",
    "fx_rate",
    "integer not null default 1000000"
  ],
  [
    "invoice",
    "fx_factor",
    "integer not null default 1000000"
  ],
  [
    "quotation",
    "fx_rate",
    "integer not null default 1000000"
  ],
  [
    "quotation",
    "fx_factor",
    "integer not null default 1000000"
  ],
  [
    "payment",
    "account_id",
    "text"
  ],
  [
    "payment",
    "account_amount",
    "integer"
  ],
  [
    "payment",
    "currency",
    "text"
  ],
  [
    "payment",
    "currency_precision",
    "integer"
  ],
  [
    "payment",
    "fx_factor",
    "integer not null default 1000000"
  ],
  [
    "finance_entry",
    "account_id",
    "text"
  ],
  [
    "finance_entry",
    "attachment",
    "text not null default ''"
  ],
  [
    "finance_entry",
    "client_request_id",
    "text"
  ],
  [
    "tenant",
    "reporting_currency",
    "text not null default ''"
  ],
  [
    "tenant",
    "sync_seq",
    "integer not null default 0"
  ],
  [
    "finance_entry",
    "purchase_id",
    "text"
  ],
  ['tenant', 'settings', "text not null default ''"],
  ['client', 'custom', "text not null default '{}'"],
  ['service', 'custom', "text not null default '{}'"],
  ['service', 'item_type', "text not null default ''"],
  ['invoice', 'custom', "text not null default '{}'"],
  ['quotation', 'custom', "text not null default '{}'"],
  ['service', 'track_stock', 'integer not null default 0'],
  ['service', 'sku', "text not null default ''"],
  ['service', 'barcode', "text not null default ''"],
  ['service', 'cost_price', 'integer not null default 0'],
  ['service', 'reorder_level', 'integer not null default 0'],
  ['service', 'name_ur', "text not null default ''"],
  ['service', 'mrp', 'integer not null default 0'],
  ['service', 'label_pending', 'integer not null default 0'],
  ['service', 'max_level', 'integer not null default 0'],
  ['service', 'pack_size', 'integer not null default 0'],
  ['service', 'preferred_supplier_id', 'text'],
  ['service', 'track_batches', 'integer not null default 0'],
  ['service', 'expiry_warn_days', 'integer not null default 0'],
  ['stock_move', 'batch_no', "text not null default ''"],
  ['stock_move', 'expiry', "text not null default ''"],
  ['service', 'modifiers', "text not null default '[]'"],
  ['purchase', 'tax_amount', 'integer not null default 0'],
  ['employee', 'user_id', 'text'],
  ['tenant', 'referral_code', 'text'],
  ['app_user', 'phone', "text not null default ''"],
  ['app_user', 'email_verified', 'integer not null default 0'],
  ['app_user', 'phone_verified', 'integer not null default 0'],
  ['tenant', 'referred_by', 'text'],
  ['employee', 'sales_target', 'integer not null default 0'],
  ['employee', 'commission_bp', 'integer not null default 0'],
  ['service', 'kitchen_section', "text not null default ''"],
  ['service', 'recipe', "text not null default '[]'"],
  ['purchase', 'supplier_id', 'text'],
  ['purchase', 'receipt_id', 'text'],
  ['purchase', 'custom', "text not null default '{}'"],
  ['client', 'portal_token', 'text'],
  ['invoice', 'doc_type', "text not null default 'invoice'"],
  ['business', 'qr_mode', "text not null default 'none'"],
  ['business', 'reminder_template', "text not null default ''"],
  ['business', 'doc_language', "text not null default 'en'"],
  ['loan', 'employee_id', 'text'],
  ['finance_entry', 'payroll_id', 'text'],
  ['finance_entry', 'claim_id', 'text'],
  ['tenant', 'plan', "text not null default 'legacy'"],
  ['tenant', 'trial_ends_at', 'text'],
  ['tenant', 'paid_until', 'text'],
  ['invoice', 'pos_shift_id', 'text'],
  ['payment', 'pos_shift_id', 'text'],
  ['credit_note', 'pos_shift_id', 'text'],
  ['client_refund', 'pos_shift_id', 'text'],
];

export abstract class BaseDb {
  private depth = 0;

  abstract exec(sql: string): void;
  abstract all(sql: string, ...params: any[]): Row[];
  abstract get(sql: string, ...params: any[]): Row | undefined;
  abstract run(sql: string, ...params: any[]): { changes: number | bigint };

  /** Create tables and apply additive migrations. Call once from the subclass constructor. */
  protected init() {
    this.exec(SCHEMA);
    for (const [table, column, definition] of MIGRATIONS) {
      const cols = this.all(`pragma table_info(${table})`);
      if (!cols.some((c) => c.name === column)) this.exec(`alter table ${table} add column ${column} ${definition}`);
    }
    this.exec('create table if not exists sync_op (id text primary key, tenant_id text not null, method text not null, path text not null, status integer not null, response text not null, created_at text not null)');
  }

  /** Run fn atomically; nested calls join the outer transaction. */
  tx<T>(fn: () => T): T {
    if (this.depth > 0) return fn();
    this.exec('begin immediate');
    this.depth++;
    try {
      const out = fn();
      this.exec('commit');
      return out;
    } catch (e) {
      this.exec('rollback');
      throw e;
    } finally {
      this.depth--;
    }
  }

  /** Next value of a per-tenant sequence. Call inside a transaction. */
  nextCounter(tenantId: string, key: string): number {
    this.run(
      'insert into counter (tenant_id, key, value) values (?, ?, 1) on conflict (tenant_id, key) do update set value = value + 1',
      tenantId,
      key,
    );
    return this.get('select value from counter where tenant_id = ? and key = ?', tenantId, key)!.value;
  }

  /** set on the server to send webhooks for recorded actions */
  onAudit?: (auditId: string, tenantId: string, action: string, entity: string, entityId: string | null, detail: unknown) => void;

  audit(tenantId: string, userId: string | null, action: string, entity: string, entityId: string | null, detail: unknown = {}) {
    const auditId = randomId();
    this.onAudit?.(auditId, tenantId, action, entity, entityId, detail);
    this.run(
      'insert into audit_log (id, tenant_id, user_id, action, entity, entity_id, detail, at) values (?,?,?,?,?,?,?,?)',
      auditId,
      tenantId,
      userId,
      action,
      entity,
      entityId,
      JSON.stringify(detail),
      new Date().toISOString(),
    );
  }
}
export type Db = BaseDb;

export const now = () => new Date().toISOString();
export const today = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------- ids

let makeRandomId: () => string = () => {
  const c = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return deterministicId(String(Math.random()) + Date.now(), 0);
};
/** The phone supplies its own secure random UUID function. */
export function setRandomId(fn: () => string) {
  makeRandomId = fn;
}
export const randomId = () => makeRandomId();

let seed: { base: string; n: number; out?: string[] } | null = null;

/**
 * Run `fn` so that every id it creates is derived from `base` (an operation id).
 * The phone and the server run the same queued operation with the same base, so both
 * create rows with identical ids and a later sync matches them up instead of duplicating.
 */
export function withIdSeed<T>(base: string, fn: () => T, collect?: string[]): T {
  const outer = seed;
  seed = { base, n: 0, out: collect };
  try {
    return fn();
  } finally {
    seed = outer;
  }
}

export function uid(): string {
  if (!seed) return makeRandomId();
  const id = deterministicId(seed.base, seed.n++);
  seed.out?.push(id);
  return id;
}

/** 53-bit string hash (cyrb53). */
function hash53(str: string, s: number): number {
  let h1 = 0xdeadbeef ^ s;
  let h2 = 0x41c6ce57 ^ s;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** UUID-shaped id (version 8) derived from a base string and a counter. */
export function deterministicId(base: string, n: number): string {
  const key = `${base}#${n}`;
  const hex = [1, 2, 3].map((s) => hash53(key, s).toString(16).padStart(14, '0')).join('').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${((parseInt(hex[16], 16) & 3) | 8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
