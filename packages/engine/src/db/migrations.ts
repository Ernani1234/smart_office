// Esquema do banco: log de eventos, livro-caixa, missões, aprovações, wiki com
// busca semântica (pgvector), recados para agentes e configurações.
// Idempotente: roda a cada boot.

export const EMBEDDING_DIM = 256;

export const MIGRATIONS: string[] = [
  `create extension if not exists vector`,

  `create table if not exists events (
    id bigserial primary key,
    ts timestamptz not null default now(),
    type text not null,
    mission_id text,
    task_id text,
    agent_id text,
    data jsonb not null
  )`,
  `create index if not exists events_mission_idx on events (mission_id, id)`,
  `create index if not exists events_ts_idx on events (ts)`,
  `create index if not exists events_type_idx on events (type, mission_id)`,

  `create table if not exists missions (
    id text primary key,
    title text not null,
    brief text not null,
    goal_micros bigint not null,
    cap_micros bigint not null,
    deadline timestamptz not null,
    revenue_source text not null,
    status text not null,
    workflow_id text,
    created_at timestamptz not null default now(),
    ended_at timestamptz,
    end_reason text,
    launched_at timestamptz,
    product jsonb
  )`,

  // amount_micros: negativo = custo, positivo = receita
  `create table if not exists ledger (
    id bigserial primary key,
    ts timestamptz not null default now(),
    mission_id text,
    kind text not null,
    amount_micros bigint not null,
    agent_id text,
    role text,
    team text,
    model text,
    task_id text,
    external_id text,
    note text,
    detail jsonb
  )`,
  `create unique index if not exists ledger_external_idx on ledger (kind, external_id) where external_id is not null`,
  `create index if not exists ledger_mission_idx on ledger (mission_id)`,

  `create table if not exists approvals (
    id text primary key,
    mission_id text,
    task_id text,
    kind text not null,
    title text not null,
    detail text not null,
    amount_micros bigint,
    requested_by text not null,
    status text not null default 'pending',
    note text,
    workflow_id text,
    created_at timestamptz not null default now(),
    decided_at timestamptz
  )`,

  `create table if not exists wiki_pages (
    slug text primary key,
    title text not null,
    body text not null,
    tags text[] not null default '{}',
    kind text not null,
    mission_id text,
    embedding vector(${EMBEDDING_DIM}),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`,

  `create table if not exists agent_messages (
    id bigserial primary key,
    agent_id text not null,
    task_id text,
    body text not null,
    consumed_at timestamptz,
    created_at timestamptz not null default now()
  )`,

  `create table if not exists settings (
    key text primary key,
    value jsonb not null
  )`,

  // "API" do mercado simulado: o Financeiro lê daqui por código, como leria a do MoR.
  `create table if not exists sim_orders (
    id text primary key,
    mission_id text not null,
    created_at timestamptz not null default now(),
    gross_cents integer not null,
    fee_cents integer not null,
    status text not null default 'paid'
  )`,
];
