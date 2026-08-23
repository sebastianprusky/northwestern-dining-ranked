create table if not exists public.schools (
  id text primary key,
  name text not null
);

create table if not exists public.vendors (
  id text primary key,
  school_id text not null references public.schools(id),
  name text not null,
  photo_url text,
  menu_items jsonb not null default '[]'::jsonb
);

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  school_id text not null references public.schools(id),
  token_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, token_hash)
);

comment on table public.sessions is 'Anonymous production visitors. Versioned token hashes distinguish current visitor tracking from legacy test sessions.';

create table if not exists public.session_rankings (
  session_id uuid not null references public.sessions(id) on delete cascade,
  school_id text not null references public.schools(id),
  vendor_id text not null references public.vendors(id),
  bucket text not null check (bucket in ('liked', 'fine', 'disliked')),
  within_bucket_rank integer not null,
  computed_score numeric(3,1) not null check (computed_score between 0 and 10),
  primary key (session_id, vendor_id)
);

create table if not exists public.session_favorite_dishes (
  session_id uuid not null references public.sessions(id) on delete cascade,
  school_id text not null references public.schools(id),
  vendor_id text not null references public.vendors(id),
  dish_name text not null,
  primary key (session_id, vendor_id)
);

create index if not exists session_rankings_school_vendor_idx on public.session_rankings (school_id, vendor_id);
create index if not exists session_favorite_school_vendor_idx on public.session_favorite_dishes (school_id, vendor_id);

alter table public.schools enable row level security;
alter table public.vendors enable row level security;
alter table public.sessions enable row level security;
alter table public.session_rankings enable row level security;
alter table public.session_favorite_dishes enable row level security;

grant usage on schema public to service_role;
grant select, insert, update, delete on table public.schools to service_role;
grant select, insert, update, delete on table public.vendors to service_role;
grant select, insert, update, delete on table public.sessions to service_role;
grant select, insert, update, delete on table public.session_rankings to service_role;
grant select, insert, update, delete on table public.session_favorite_dishes to service_role;

insert into public.schools (id, name) values ('northwestern', 'Northwestern University')
on conflict (id) do update set name = excluded.name;

insert into public.vendors (id, school_id, name, menu_items) values
  ('forno-pizza-co', 'northwestern', 'Forno Pizza Co.', '[]'),
  ('buen-dia', 'northwestern', 'Buen Dia', '["Two chicken tacos with chips & salsa", "Two calabasitas tacos with chips & salsa", "Chicken quesadilla", "Cheese quesadilla"]'),
  ('wildcat-deli', 'northwestern', 'Wildcat Deli', '["Build Your Own Sandwich"]'),
  ('847-burger', 'northwestern', '847 Burger', '["Sheridan Road Burger", "Greenwood Street Garden Burger", "Central Street Chicken Sandwich"]'),
  ('shake-smart', 'northwestern', 'Shake Smart', '["Regular-size shake", "Scooped bowl", "Blended bowl"]'),
  ('frans-cafe', 'northwestern', 'Fran''s Cafe', '["Chicken Tenders", "Quesadilla", "Mozzarella Sticks", "Mac & Cheese", "Fries"]'),
  ('lisas-cafe', 'northwestern', 'Lisa''s Cafe', '["Breakfast Sandwich", "Bagel & Cream Cheese", "Chicken Tenders", "Grilled Cheese", "Iced Coffee"]'),
  ('starbucks', 'northwestern', 'Starbucks', '["Caramel Macchiato", "Pink Drink", "Cold Brew", "Bacon Gouda Sandwich", "Cake Pop"]'),
  ('tech-express', 'northwestern', 'Tech Express', '[]'),
  ('chicken-and-boba', 'northwestern', 'Chicken & Boba', '[]'),
  ('lunas-pub-and-grill', 'northwestern', 'Luna''s Pub & Grill', '[]')
on conflict (id) do update set name = excluded.name, menu_items = excluded.menu_items;
