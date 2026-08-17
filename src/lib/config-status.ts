import { SUPABASE_URL, SUPABASE_KEY, CF_AI_TOKEN, CF_ACCOUNT_ID } from "astro:env/server";

export interface ConfigStatus {
  name: string;
  configured: boolean;
  message: string;
  docsUrl?: string;
  docsLabel?: string;
}

export const configStatuses: ConfigStatus[] = [
  {
    name: "Supabase",
    configured: Boolean(SUPABASE_URL && SUPABASE_KEY),
    message: "Supabase nie jest skonfigurowany — funkcje uwierzytelniania są wyłączone.",
    docsUrl: "https://github.com/przeprogramowani/10x-astro-starter#supabase-configuration",
    docsLabel: "Zobacz instrukcję konfiguracji",
  },
  {
    // Both halves are needed to build the Gateway URL, so a half-configured
    // setup has to read as unconfigured — otherwise the first receipt upload
    // fails at request time instead of on every page, which is exactly the
    // silent-failure shape the banner exists to prevent.
    name: "Cloudflare AI Gateway",
    configured: Boolean(CF_AI_TOKEN && CF_ACCOUNT_ID),
    message: "Cloudflare AI Gateway nie jest skonfigurowany — odczyt paragonów jest wyłączony.",
  },
];

export const missingConfigs = configStatuses.filter((s) => !s.configured);
