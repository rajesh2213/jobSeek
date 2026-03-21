import type { SeedCompany } from "../seeding.types.js";

export function getStartupsDataset(): SeedCompany[] {
  return [
    { name: "Notion", domain: "notion.so" },
    { name: "Figma", domain: "figma.com" },
    { name: "Canva", domain: "canva.com" },
    { name: "Datadog", domain: "datadoghq.com" },
    { name: "Snowflake", domain: "snowflake.com" },
    { name: "Supabase", domain: "supabase.com" },
    { name: "Linear", domain: "linear.app" },
    { name: "Miro", domain: "miro.com" },
    { name: "Atlassian", domain: "atlassian.com" },
    { name: "Plaid", domain: "plaid.com" },
    { name: "Ramp", domain: "ramp.com" },
    { name: "Mercury", domain: "mercury.com" },
    { name: "OpenAI", domain: "openai.com" },
    { name: "Anthropic", domain: "anthropic.com" },
    { name: "GitLab", domain: "gitlab.com" },
  ];
}
