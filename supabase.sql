-- Global ranking for Eye of the Beholder. The server inserts the real score; phones never write here.
create table if not exists public.beholder_scores (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  name text not null check (char_length(name) <= 12),
  char text,
  points int not null default 0,
  round int not null default 1,
  level text
);
create index if not exists beholder_scores_points on public.beholder_scores (points desc, round desc);
alter table public.beholder_scores enable row level security;
create policy "read scores" on public.beholder_scores for select using (true);
create policy "insert scores" on public.beholder_scores for insert with check (char_length(name) <= 12 and points between 0 and 100000);
