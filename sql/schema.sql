create extension if not exists pgcrypto;

create table if not exists images (
  id uuid primary key default gen_random_uuid(),
  email text,
  prompt text not null,
  image_b64 text not null,
  preview_b64 text,
  is_unlocked boolean not null default false,
  is_public boolean not null default false,
  hd_export_paid boolean not null default false,
  print_ready_paid boolean not null default false,
  stripe_session_id text,
  created_at timestamptz not null default now()
);

create index if not exists images_email_idx on images(email);
create index if not exists images_public_idx on images(is_public);

create table if not exists subscribers (
  email text primary key,
  stripe_customer_id text,
  stripe_subscription_id text,
  status text not null default 'inactive',
  generations_used integer not null default 0,
  generations_limit integer not null default 150,
  period_start timestamptz,
  period_end timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists checkout_sessions (
  id uuid primary key default gen_random_uuid(),
  stripe_session_id text unique not null,
  email text,
  image_id uuid references images(id) on delete set null,
  mode text not null,
  completed boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists merch_requests (
  id uuid primary key default gen_random_uuid(),
  image_id uuid references images(id) on delete cascade,
  email text not null,
  product_type text not null,
  created_at timestamptz not null default now()
);
