import * as pulumi from "@pulumi/pulumi";
import * as cloudflare from "@pulumi/cloudflare";
import * as random from "@pulumi/random";

const config = new pulumi.Config();
const accountId = config.require("cloudflareAccountId");
const storeId = config.require("secretsStoreId");
const suffix = pulumi.getStack() === "prod" ? "_PROD" : "";
const anonymousAccessEnabled = config.requireBoolean("anonymousAccessEnabled");

// MiMo-only runtime (owner decision 2026-09-15): DeepSeek is not a deploy
// requirement, so no DEEPSEEK_API_KEY is provisioned or required here. The four
// vendor keys are the ones no provider can mint, so they stay secret stack
// config (ESC `fn::secret`). The two anonymous-access secrets are not config
// (#1676): TURNSTILE_SECRET is the adopted widget's own secret and
// ANON_ID_SECRET is generated.
const vendorNames = ["MIMO_API_KEY", "ZEN_GO_API_KEY", "GOOGLE_MAPS_API_KEY", "LOGFIRE_TOKEN"];

// ── The account's single Turnstile widget (#1676) ──────────────────────────
// One widget — `animichi.com (Spin)`, site key `0x4AAAAAAD-SYZJEDljOH-SB`,
// managed mode — serves staging, production and local development, so exactly
// one stack may own it: staging adopts it through the provider's
// `<account_id>/<sitekey>` import identity with `protect` and `retainOnDelete`,
// so no destroy, rename or declaration removal can delete the widget production
// and local development keep using, and any other stack that needs its secret
// reads the same widget through the `getTurnstileWidget` data source instead of
// importing a second copy.
//
// Only the provider's required inputs are declared: the optional attributes are
// Optional+Computed upstream, so an omitted one adopts the live value instead of
// rewriting it. `domains` is already in the API's canonical alphabetical order.
const TURNSTILE_WIDGET_SITEKEY = "0x4AAAAAAD-SYZJEDljOH-SB";
const turnstileWidgetDef = {
  name: "animichi.com (Spin)",
  domains: ["127.0.0.1", "animichi.com", "localhost"],
  mode: "managed",
};
/** The one stack that owns the account's single widget (owner 2026-09-16). */
const TURNSTILE_WIDGET_OWNER_STACK = "staging";
const ownsTurnstileWidget = pulumi.getStack() === TURNSTILE_WIDGET_OWNER_STACK;

const adoptedWidget = ownsTurnstileWidget
  ? new cloudflare.TurnstileWidget("turnstile-widget", {
      accountId,
      name: turnstileWidgetDef.name,
      domains: turnstileWidgetDef.domains,
      mode: turnstileWidgetDef.mode,
    }, { import: `${accountId}/${TURNSTILE_WIDGET_SITEKEY}`, protect: true, retainOnDelete: true })
  : undefined;

// A stack that needs the widget's secret without owning the widget.
const readWidget = !ownsTurnstileWidget && anonymousAccessEnabled
  ? cloudflare.getTurnstileWidgetOutput({ accountId, sitekey: TURNSTILE_WIDGET_SITEKEY })
  : undefined;

const widgetSecret = adoptedWidget?.secret ?? readWidget?.secret;

/** The two anonymous-access secrets, neither of which is stack config. The
 * identity seed is generated, never hand-typed, logged or committed. */
function anonymousSources(): { turnstileSecret: pulumi.Output<string>; identitySeed: pulumi.Output<string> } {
  if (widgetSecret === undefined) throw new Error("anonymous access needs the Turnstile widget secret");
  return {
    turnstileSecret: widgetSecret,
    identitySeed: new random.RandomPassword("anon-id-secret", { length: 48, special: false }).result,
  };
}

const anonymous = anonymousAccessEnabled ? anonymousSources() : undefined;

function requiredVendorSecret(name: string): pulumi.Output<string> {
  return config.requireSecret(name).apply((value) => {
    if (value.trim().length === 0) throw new Error(`Empty runtime secret: ${name}`);
    return value;
  });
}

/** Every runtime secret the store receives: the four vendor keys, then (with
 * anonymous access on) the widget's secret and the generated identity seed. One
 * source per name — there is no second list that could omit one. */
function runtimeSecretSources(): Record<string, pulumi.Input<string>> {
  const vendor = vendorNames.map((name) => [name, requiredVendorSecret(name)] as const);
  const generated: (readonly [string, pulumi.Input<string>])[] = anonymous === undefined
    ? []
    : [["TURNSTILE_SECRET", anonymous.turnstileSecret], ["ANON_ID_SECRET", anonymous.identitySeed]];
  return Object.fromEntries([...vendor, ...generated]);
}

// ANON_ID_SECRET keeps `retainOnDelete`: turning anonymous access off must not
// DELETE the live seed from the store. Because the value is generated, a later
// re-declaration rotates it instead of importing the retained copy — the
// owner-accepted rotation (#1676) recorded in docs/ops/secrets.md.
const secrets = Object.entries(runtimeSecretSources()).map(([name, value]) =>
  new cloudflare.SecretsStoreSecret(`${name}${suffix}`, {
    accountId,
    storeId,
    name: `${name}${suffix}`,
    value,
    scopes: ["workers"],
  }, name === "ANON_ID_SECRET" ? { retainOnDelete: true } : undefined));

export const edgeRuntimeSecretNames = pulumi.all(secrets.map((secret) => secret.name));
