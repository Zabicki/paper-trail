import {
  Activity,
  Apple,
  Baby,
  Banknote,
  Bath,
  BedDouble,
  Beef,
  Beer,
  Bike,
  BookOpen,
  Bookmark,
  Box,
  Brain,
  Briefcase,
  Building2,
  Bus,
  Cake,
  Calendar,
  Camera,
  Car,
  CarFront,
  CarTaxiFront,
  Carrot,
  Circle,
  CircleHelp,
  Clapperboard,
  Clock,
  Coffee,
  Coins,
  ConciergeBell,
  CreditCard,
  Croissant,
  CupSoda,
  Droplet,
  Dumbbell,
  Fish,
  Flag,
  Flame,
  Flower2,
  Footprints,
  Fuel,
  Gamepad2,
  Gift,
  Glasses,
  GraduationCap,
  Guitar,
  Hammer,
  HandCoins,
  Headphones,
  Heart,
  HeartPulse,
  House,
  IceCreamCone,
  Key,
  Lamp,
  Landmark,
  Laptop,
  Mail,
  Milk,
  Monitor,
  MoreHorizontal,
  Mountain,
  Music,
  Newspaper,
  Package,
  Paintbrush,
  Palette,
  ParkingCircle,
  PartyPopper,
  PawPrint,
  Pencil,
  Percent,
  Phone,
  PiggyBank,
  Pill,
  Pizza,
  Plane,
  Popcorn,
  Printer,
  Puzzle,
  ReceiptText,
  Scissors,
  ShieldCheck,
  Ship,
  Shirt,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  Smile,
  Snowflake,
  Sofa,
  Sparkles,
  SprayCan,
  Star,
  Stethoscope,
  Store,
  Sun,
  Syringe,
  Tag,
  Tent,
  Theater,
  Ticket,
  TrainFront,
  TramFront,
  Trash2,
  TrendingDown,
  TrendingUp,
  Tv,
  Utensils,
  UtensilsCrossed,
  WashingMachine,
  Wallet,
  Wifi,
  Wine,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { CATEGORY_ICON_NAMES, type CategoryIconName } from "@/types";

// The UI-side half of the icon set. Its counterpart, src/types.ts, holds only
// the NAMES — it is reachable from the service layer and from API routes, so it
// must never import from lucide-react. This module is client-island-only and is
// where the components live.
//
// Named imports, never a dynamic `lucide-react/dynamicIconImports` lookup: a
// dynamic import defeats tree-shaking and would pull the entire ~1500-icon set
// into the bundle instead of the ~116 referenced here.

const GROUP_LABELS = {
  food: "Jedzenie i napoje",
  transport: "Transport",
  home: "Dom i rachunki",
  health: "Zdrowie i uroda",
  leisure: "Rozrywka i czas wolny",
  shopping: "Zakupy i usługi",
  finance: "Finanse i praca",
  other: "Inne",
} as const;

type GroupKey = keyof typeof GROUP_LABELS;

// Presentation order in the picker, coarsely by how often a household spends
// in each. `other` last because it is the fallback bucket.
const GROUP_ORDER: GroupKey[] = ["food", "transport", "home", "health", "leisure", "shopping", "finance", "other"];

interface IconEntry {
  component: LucideIcon;
  group: GroupKey;
  // Polish search terms. lucide's own names are English, which is useless to a
  // Polish-speaking user hunting for "śmieci" — so every icon carries the words
  // someone would actually type. The picker also matches the lucide name
  // itself, so "coffee" still finds `coffee`. Matching is case- and
  // diacritic-insensitive, so "smieci" and "śmieci" both hit.
  keywords: string[];
}

// ⚠ EXHAUSTIVE BY TYPE. Because this is a `Record<CategoryIconName, …>`, a name
// added to CATEGORY_ICON_NAMES in src/types.ts without an entry here fails
// type-check — rather than silently vanishing from the picker. And because each
// entry names exactly one `group`, "every name in exactly one group" is
// structural rather than an assertion that could drift.
const ICON_CATALOGUE: Record<CategoryIconName, IconEntry> = {
  // --- Jedzenie i napoje ---
  utensils: { component: Utensils, group: "food", keywords: ["jedzenie", "obiad", "posiłek", "sztućce"] },
  "utensils-crossed": {
    component: UtensilsCrossed,
    group: "food",
    keywords: ["restauracje", "restauracja", "obiad na mieście", "lokal"],
  },
  coffee: { component: Coffee, group: "food", keywords: ["kawa", "kawiarnia", "herbata", "napój"] },
  pizza: { component: Pizza, group: "food", keywords: ["pizza", "fast food", "na wynos"] },
  beef: { component: Beef, group: "food", keywords: ["mięso", "wędliny", "rzeźnik", "stek"] },
  fish: { component: Fish, group: "food", keywords: ["ryby", "rybne", "owoce morza"] },
  apple: { component: Apple, group: "food", keywords: ["owoce", "jabłko", "zdrowe"] },
  carrot: { component: Carrot, group: "food", keywords: ["warzywa", "marchewka", "jarzyny"] },
  croissant: {
    component: Croissant,
    group: "food",
    keywords: ["piekarnia", "pieczywo", "chleb", "śniadanie", "rogalik"],
  },
  cake: { component: Cake, group: "food", keywords: ["ciasto", "tort", "deser", "słodycze", "urodziny"] },
  "ice-cream-cone": { component: IceCreamCone, group: "food", keywords: ["lody", "deser", "słodycze"] },
  wine: { component: Wine, group: "food", keywords: ["wino", "alkohol", "trunki"] },
  beer: { component: Beer, group: "food", keywords: ["piwo", "alkohol", "browar"] },
  "cup-soda": { component: CupSoda, group: "food", keywords: ["napoje", "sok", "woda", "lemoniada"] },
  milk: { component: Milk, group: "food", keywords: ["mleko", "nabiał", "jogurt", "ser"] },

  // --- Transport ---
  car: { component: Car, group: "transport", keywords: ["transport", "samochód", "auto", "jazda", "przejazd"] },
  "car-front": {
    component: CarFront,
    group: "transport",
    keywords: ["rata samochodu", "samochód", "auto", "leasing", "kredyt"],
  },
  fuel: { component: Fuel, group: "transport", keywords: ["paliwo", "benzyna", "tankowanie", "diesel", "stacja"] },
  "parking-circle": {
    component: ParkingCircle,
    group: "transport",
    keywords: ["parking", "postój", "opłata parkingowa"],
  },
  bus: { component: Bus, group: "transport", keywords: ["autobus", "komunikacja", "bilet", "miejski"] },
  "train-front": { component: TrainFront, group: "transport", keywords: ["pociąg", "kolej", "pkp", "bilet"] },
  "tram-front": { component: TramFront, group: "transport", keywords: ["tramwaj", "komunikacja", "miejski"] },
  bike: { component: Bike, group: "transport", keywords: ["rower", "kolarstwo", "serwis rowerowy"] },
  plane: { component: Plane, group: "transport", keywords: ["podróże", "samolot", "lot", "wakacje", "lotnisko"] },
  ship: { component: Ship, group: "transport", keywords: ["statek", "prom", "rejs", "wycieczka"] },
  "car-taxi-front": {
    component: CarTaxiFront,
    group: "transport",
    keywords: ["taxi", "taksówka", "przejazd", "uber"],
  },

  // --- Dom i rachunki ---
  house: { component: House, group: "home", keywords: ["czynsz", "dom", "mieszkanie", "najem", "wynajem"] },
  sofa: { component: Sofa, group: "home", keywords: ["dom", "meble", "wyposażenie", "wnętrze", "kanapa"] },
  "bed-double": { component: BedDouble, group: "home", keywords: ["sypialnia", "łóżko", "meble", "materac"] },
  lamp: { component: Lamp, group: "home", keywords: ["lampa", "oświetlenie", "żarówka", "meble"] },
  wrench: { component: Wrench, group: "home", keywords: ["naprawy", "warsztat", "serwis", "remont", "mechanik"] },
  hammer: { component: Hammer, group: "home", keywords: ["remont", "budowa", "narzędzia", "majsterkowanie"] },
  paintbrush: { component: Paintbrush, group: "home", keywords: ["malowanie", "farba", "remont", "pędzel"] },
  zap: { component: Zap, group: "home", keywords: ["prąd", "energia", "elektryczność", "rachunki"] },
  flame: { component: Flame, group: "home", keywords: ["gaz", "ogrzewanie", "ciepło", "opał"] },
  droplet: {
    component: Droplet,
    group: "home",
    keywords: ["woda", "chemia domowa", "wodociągi", "ścieki", "rachunki"],
  },
  wifi: { component: Wifi, group: "home", keywords: ["internet", "sieć", "router", "światłowód"] },
  phone: { component: Phone, group: "home", keywords: ["telefon", "abonament", "komórka", "rozmowy"] },
  tv: { component: Tv, group: "home", keywords: ["telewizja", "abonament rtv", "streaming"] },
  "trash-2": { component: Trash2, group: "home", keywords: ["śmieci", "odpady", "wywóz", "sprzątanie"] },
  "flower-2": { component: Flower2, group: "home", keywords: ["rośliny", "kwiaty", "ogród", "doniczka"] },
  "washing-machine": { component: WashingMachine, group: "home", keywords: ["pralka", "agd", "pranie", "sprzęt"] },
  "spray-can": {
    component: SprayCan,
    group: "home",
    keywords: ["chemia domowa", "sprzątanie", "czystość", "detergenty"],
  },
  key: { component: Key, group: "home", keywords: ["klucze", "wynajem", "kaucja", "mieszkanie"] },

  // --- Zdrowie i uroda ---
  "heart-pulse": { component: HeartPulse, group: "health", keywords: ["zdrowie", "lekarz", "przychodnia", "badania"] },
  pill: { component: Pill, group: "health", keywords: ["apteka", "leki", "tabletki", "recepta"] },
  stethoscope: { component: Stethoscope, group: "health", keywords: ["lekarz", "wizyta", "doktor", "specjalista"] },
  syringe: { component: Syringe, group: "health", keywords: ["szczepienie", "zastrzyk", "badania krwi"] },
  smile: { component: Smile, group: "health", keywords: ["dentysta", "stomatolog", "zęby", "uśmiech"] },
  glasses: { component: Glasses, group: "health", keywords: ["okulary", "optyk", "wzrok", "soczewki"] },
  scissors: { component: Scissors, group: "health", keywords: ["fryzjer", "strzyżenie", "salon", "barber"] },
  sparkles: { component: Sparkles, group: "health", keywords: ["kosmetyki", "uroda", "pielęgnacja", "perfumy"] },
  bath: { component: Bath, group: "health", keywords: ["kąpiel", "spa", "łazienka", "masaż"] },
  dumbbell: { component: Dumbbell, group: "health", keywords: ["sport", "siłownia", "fitness", "trening", "karnet"] },
  activity: { component: Activity, group: "health", keywords: ["aktywność", "zdrowie", "kondycja", "bieganie"] },
  brain: { component: Brain, group: "health", keywords: ["psycholog", "terapia", "zdrowie psychiczne"] },
  baby: { component: Baby, group: "health", keywords: ["dziecko", "niemowlę", "opieka", "pieluchy"] },

  // --- Rozrywka i czas wolny ---
  "party-popper": { component: PartyPopper, group: "leisure", keywords: ["rozrywka", "impreza", "zabawa", "urodziny"] },
  clapperboard: { component: Clapperboard, group: "leisure", keywords: ["kino", "film", "seans", "netflix"] },
  popcorn: { component: Popcorn, group: "leisure", keywords: ["kino", "przekąski", "popcorn"] },
  puzzle: { component: Puzzle, group: "leisure", keywords: ["hobby", "gry", "planszówki", "układanka"] },
  "gamepad-2": { component: Gamepad2, group: "leisure", keywords: ["gry", "konsola", "gaming", "komputerowe"] },
  music: { component: Music, group: "leisure", keywords: ["muzyka", "koncert", "spotify", "płyty"] },
  headphones: { component: Headphones, group: "leisure", keywords: ["słuchawki", "muzyka", "audio", "podcast"] },
  guitar: { component: Guitar, group: "leisure", keywords: ["instrument", "gitara", "muzyka", "lekcje"] },
  ticket: { component: Ticket, group: "leisure", keywords: ["bilety", "wydarzenie", "wejściówki", "koncert"] },
  "book-open": { component: BookOpen, group: "leisure", keywords: ["książki", "czytanie", "księgarnia", "lektura"] },
  newspaper: { component: Newspaper, group: "leisure", keywords: ["prasa", "gazeta", "czasopismo", "subskrypcja"] },
  palette: { component: Palette, group: "leisure", keywords: ["sztuka", "malarstwo", "hobby", "plastyka"] },
  camera: { component: Camera, group: "leisure", keywords: ["fotografia", "zdjęcia", "aparat", "film"] },
  tent: { component: Tent, group: "leisure", keywords: ["kemping", "biwak", "namiot", "festiwal"] },
  mountain: { component: Mountain, group: "leisure", keywords: ["góry", "wycieczka", "wędrówka", "narty"] },
  theater: { component: Theater, group: "leisure", keywords: ["teatr", "spektakl", "opera", "kultura"] },

  // --- Zakupy i usługi ---
  "shopping-cart": {
    component: ShoppingCart,
    group: "shopping",
    keywords: ["zakupy", "sklep", "market", "spożywcze"],
  },
  "shopping-bag": { component: ShoppingBag, group: "shopping", keywords: ["zakupy", "torba", "sklep", "galeria"] },
  shirt: { component: Shirt, group: "shopping", keywords: ["ubrania", "odzież", "moda", "koszula"] },
  footprints: { component: Footprints, group: "shopping", keywords: ["buty", "obuwie", "sneakersy"] },
  store: { component: Store, group: "shopping", keywords: ["sklep", "punkt", "handel", "osiedlowy"] },
  gift: { component: Gift, group: "shopping", keywords: ["prezenty", "upominek", "podarunek", "święta"] },
  smartphone: { component: Smartphone, group: "shopping", keywords: ["elektronika", "telefon", "sprzęt", "komórka"] },
  laptop: { component: Laptop, group: "shopping", keywords: ["elektronika", "komputer", "laptop", "sprzęt"] },
  monitor: { component: Monitor, group: "shopping", keywords: ["elektronika", "monitor", "ekran", "komputer"] },
  printer: { component: Printer, group: "shopping", keywords: ["drukarka", "biuro", "wydruki", "toner"] },
  pencil: { component: Pencil, group: "shopping", keywords: ["papiernicze", "biuro", "przybory", "ołówek", "szkoła"] },
  package: { component: Package, group: "shopping", keywords: ["paczka", "przesyłka", "dostawa", "kurier"] },
  mail: { component: Mail, group: "shopping", keywords: ["poczta", "listy", "przesyłki", "znaczki"] },
  "paw-print": {
    component: PawPrint,
    group: "shopping",
    keywords: ["zwierzęta", "pies", "kot", "weterynarz", "karma"],
  },
  "concierge-bell": {
    component: ConciergeBell,
    group: "shopping",
    keywords: ["usługi", "hotel", "serwis", "obsługa"],
  },

  // --- Finanse i praca ---
  banknote: { component: Banknote, group: "finance", keywords: ["wynagrodzenie", "pensja", "wypłata", "gotówka"] },
  coins: { component: Coins, group: "finance", keywords: ["gotówka", "monety", "drobne", "bilon"] },
  wallet: { component: Wallet, group: "finance", keywords: ["portfel", "budżet", "gotówka", "kieszonkowe"] },
  "credit-card": {
    component: CreditCard,
    group: "finance",
    keywords: ["abonamenty", "karta", "subskrypcje", "płatność"],
  },
  "piggy-bank": {
    component: PiggyBank,
    group: "finance",
    keywords: ["oszczędności", "odłożone", "skarbonka", "lokata"],
  },
  "trending-up": { component: TrendingUp, group: "finance", keywords: ["inwestycje", "zyski", "wzrost", "akcje"] },
  "trending-down": { component: TrendingDown, group: "finance", keywords: ["straty", "spadek", "strata"] },
  landmark: { component: Landmark, group: "finance", keywords: ["bank", "urząd", "podatki", "państwo"] },
  "receipt-text": { component: ReceiptText, group: "finance", keywords: ["rachunki", "faktury", "paragony", "opłaty"] },
  briefcase: { component: Briefcase, group: "finance", keywords: ["freelance", "praca", "biznes", "zlecenia"] },
  "building-2": { component: Building2, group: "finance", keywords: ["firma", "biuro", "praca", "spółka"] },
  "graduation-cap": {
    component: GraduationCap,
    group: "finance",
    keywords: ["edukacja", "studia", "kursy", "szkoła", "czesne"],
  },
  "shield-check": { component: ShieldCheck, group: "finance", keywords: ["ubezpieczenie", "polisa", "ochrona", "oc"] },
  "hand-coins": { component: HandCoins, group: "finance", keywords: ["darowizny", "dotacje", "wsparcie", "zwroty"] },
  heart: { component: Heart, group: "finance", keywords: ["darowizny", "charytatywne", "wsparcie", "wolontariat"] },
  percent: { component: Percent, group: "finance", keywords: ["odsetki", "procent", "kredyt", "prowizja"] },

  // --- Inne ---
  tag: { component: Tag, group: "other", keywords: ["inne", "kategoria", "etykieta", "domyślna"] },
  circle: { component: Circle, group: "other", keywords: ["inne", "kropka", "znacznik"] },
  star: { component: Star, group: "other", keywords: ["ważne", "ulubione", "gwiazdka"] },
  flag: { component: Flag, group: "other", keywords: ["inne", "oznaczenie", "flaga", "cel"] },
  bookmark: { component: Bookmark, group: "other", keywords: ["zakładka", "oznaczenie", "zapisane"] },
  box: { component: Box, group: "other", keywords: ["inne", "pudełko", "rzeczy", "przechowywanie"] },
  "more-horizontal": { component: MoreHorizontal, group: "other", keywords: ["pozostałe", "inne", "reszta"] },
  "circle-help": { component: CircleHelp, group: "other", keywords: ["nieznane", "inne", "pytanie"] },
  sun: { component: Sun, group: "other", keywords: ["lato", "wakacje", "słońce"] },
  snowflake: { component: Snowflake, group: "other", keywords: ["zima", "ogrzewanie", "narty", "śnieg"] },
  calendar: { component: Calendar, group: "other", keywords: ["terminy", "daty", "kalendarz", "plan"] },
  clock: { component: Clock, group: "other", keywords: ["czas", "godziny", "abonament", "termin"] },
};

function componentsOf(catalogue: Record<CategoryIconName, IconEntry>): Record<CategoryIconName, LucideIcon> {
  const out = {} as Record<CategoryIconName, LucideIcon>;
  for (const name of CATEGORY_ICON_NAMES) {
    out[name] = catalogue[name].component;
  }
  return out;
}

export const ICON_COMPONENTS: Record<CategoryIconName, LucideIcon> = componentsOf(ICON_CATALOGUE);

export interface IconGroup {
  label: string;
  icons: { name: CategoryIconName; keywords: string[] }[];
}

// Derived rather than hand-maintained, so the grouping cannot disagree with
// ICON_CATALOGUE. Within a group, icons keep their CATEGORY_ICON_NAMES order.
export const ICON_GROUPS: IconGroup[] = GROUP_ORDER.map((key) => ({
  label: GROUP_LABELS[key],
  icons: CATEGORY_ICON_NAMES.filter((name) => ICON_CATALOGUE[name].group === key).map((name) => ({
    name,
    keywords: ICON_CATALOGUE[name].keywords,
  })),
}));

// Diacritic-insensitive, so "smieci" finds "śmieci" and "ksiazki" finds
// "książki" — a Polish user typing without diacritics is the common case on a
// phone keyboard, not the exception.
export function normalizeForSearch(text: string): string {
  return (
    text
      .toLocaleLowerCase("pl")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      // ł does not decompose under NFD — it is a single codepoint with a stroke,
      // not a base letter plus a combining mark — so it needs folding by hand.
      .replace(/ł/g, "l")
  );
}

// Matched against the lucide name too, so an English search term ("coffee")
// still finds its icon alongside the Polish keywords.
export function iconMatchesFilter(icon: { name: CategoryIconName; keywords: string[] }, needle: string): boolean {
  return [icon.name, ...icon.keywords].some((term) => normalizeForSearch(term).includes(needle));
}
