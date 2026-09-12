/**
 * @cloudflare/vite-plugin emits a flattened dist wrangler.json that lists
 * `definedEnvironments` but does not inline env.staging overrides. Patch the
 * built config so `wrangler deploy` targets the staging Worker + custom domain.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const STAGING_HOST = "micromist-staging.goldeneaglepersonal.dpdns.org";
const path = resolve("dist/micromist/wrangler.json");
const cfg = JSON.parse(readFileSync(path, "utf8"));
cfg.name = "micromist-staging";
cfg.topLevelName = "micromist-staging";
cfg.routes = [{ pattern: STAGING_HOST, custom_domain: true }];
cfg.workers_dev = true;
cfg.preview_urls = true;
writeFileSync(path, JSON.stringify(cfg));
console.log(
  `patched ${path} → name=${cfg.name}, route=${STAGING_HOST}`,
);
