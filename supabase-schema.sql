create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    name text,
    avatar text default '',
    settings jsonb not null default '{"currency":"IDR","dateFormat":"DD/MM/YYYY","darkMode":false,"notifications":true}'::jsonb,
    categories jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create table if not exists public.transactions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    type text not null check (type in ('income', 'expense')),
    category text,
    amount numeric not null default 0,
    date date not null default current_date,
    note text default '',
    recurring boolean not null default false,
    created_at timestamptz not null default now()
);

create table if not exists public.budgets (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    category text not null,
    amount numeric not null default 0,
    period text not null default 'monthly',
    created_at timestamptz not null default now(),
    unique (user_id, category)
);

create index if not exists transactions_user_id_idx on public.transactions(user_id);
create index if not exists transactions_date_idx on public.transactions(date);
create index if not exists budgets_user_id_idx on public.budgets(user_id);

alter table public.profiles enable row level security;
alter table public.transactions enable row level security;
alter table public.budgets enable row level security;

drop policy if exists "profiles_self" on public.profiles;
create policy "profiles_self" on public.profiles
    for all
    using (auth.uid() = id)
    with check (auth.uid() = id);

drop policy if exists "transactions_self" on public.transactions;
create policy "transactions_self" on public.transactions
    for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

drop policy if exists "budgets_self" on public.budgets;
create policy "budgets_self" on public.budgets
    for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
