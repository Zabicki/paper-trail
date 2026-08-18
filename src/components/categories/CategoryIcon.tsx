import type { CSSProperties } from "react";
import { Tag } from "lucide-react";
import { ICON_COMPONENTS } from "./icon-catalogue";

interface CategoryIconProps {
  // Deliberately `string`, not CategoryIconName. This is the one place a stored
  // value crosses into a component, and the column carries no CHECK constraint
  // (see 20260818090000_add_category_icon.sql) — so an unrecognised or stale
  // name is a state the database is entitled to be in. Typing it narrowly here
  // would only move the lie upstream; falling back to `tag` is what keeps a bad
  // row from blanking or crashing a render.
  name: string;
  className?: string;
  style?: CSSProperties;
}

export default function CategoryIcon({ name, className, style }: CategoryIconProps) {
  const Icon = Object.hasOwn(ICON_COMPONENTS, name) ? ICON_COMPONENTS[name as keyof typeof ICON_COMPONENTS] : Tag;

  // Always decorative. Every call site already announces the category by name
  // in adjacent text or in its own aria-label, so a label here would make a
  // screen reader read the category twice.
  return <Icon className={className} style={style} aria-hidden="true" />;
}
