-- S-01: extends F-01's minimal categories table with the remaining product
-- fields. F-01's RLS policies are untouched — none of these columns change
-- ownership semantics, so no policy needs to change.

alter table public.categories add column is_recurring boolean not null default false;

-- Fixed 12-value palette (raw hex, not Tailwind class names — see plan's
-- Critical Implementation Details on why dynamic Tailwind classes don't work).
-- '#64748b' (slate) is the default swatch for a newly created category.
alter table public.categories add column color text not null default '#64748b' check (
  color in (
    '#ef4444', '#f97316', '#f59e0b', '#eab308',
    '#84cc16', '#22c55e', '#14b8a6', '#06b6d4',
    '#3b82f6', '#8b5cf6', '#ec4899', '#64748b'
  )
);

-- Soft delete: a deleted category is filtered out by the service layer
-- (deleted_at is null), not by RLS.
alter table public.categories add column deleted_at timestamptz;

-- Case-insensitive per-user uniqueness, scoped to non-deleted rows so a
-- soft-deleted category's old name can be reused.
create unique index categories_user_id_name_lower_idx on public.categories (user_id, lower(name)) where deleted_at is null;
