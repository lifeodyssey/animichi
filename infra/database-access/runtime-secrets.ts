import * as pulumi from "@pulumi/pulumi";
import * as cloudflare from "@pulumi/cloudflare";
import * as random from "@pulumi/random";

const config = new pulumi.Config();
const accountId = config.require("cloudflareAccountId");
const storeId = config.require("secretsStoreId");
const suffix = pulumi.getStack() === "prod" ? "_PROD" : "";
const anonymousAccessEnabled = config.requireBoolean("anonymousAccessEnabled");

// MiMo-only runtime (owner decision 2026-09-15): DeepSeek is not a deploy
// requirement, so no DEEPSEEK_API_KEY is provisioned or required here.
//
// The vendor keys are the ones whose authority lives OUTSIDE this program, so
// the operator sets them as secret stack config (ESC `fn::secret`) and they are
// never generated. "No provider can mint them" was true of the first four and
// is not the category: INGEST_SIGNING_KEY (#1792) is a value this program could
// mint and must not, because the egress service in Fly — which Pulumi does not
// manage — holds the copy that counts and verifies what catalog signs.
// Generating one would make Pulumi a second authority for a value another
// system already holds, and the two copies would drift a rotation apart; that
// disagreement surfaces at the consumer as a 401, never as a failed deploy.
// The two anonymous-access secrets are not config (#1676): TURNSTILE_SECRET is
// the adopted widget's own secret and ANON_ID_SECRET is generated.
const vendorNames = [
  "MIMO_API_KEY", "ZEN_GO_API_KEY", "GOOGLE_MAPS_API_KEY", "LOGFIRE_TOKEN",
  "INGEST_SIGNING_KEY",
];

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

/** Every runtime secret the store receives: the owner-set vendor keys, then
 * (with anonymous access on) the widget's secret and the generated identity
 * seed. One source per name — there is no second list that could omit one. */
function runtimeSecretSources(): Record<string, pulumi.Input<string>> {
  const vendor = vendorNames.map((name) => [name, requiredVendorSecret(name)] as const);
  const generated: (readonly [string, pulumi.Input<string>])[] = anonymous === undefined
    ? []
    : [["TURNSTILE_SECRET", anonymous.turnstileSecret], ["ANON_ID_SECRET", anonymous.identitySeed]];
  return Object.fromEntries([...vendor, ...generated]);
}

// ANON_ID_SECRET keeps `retainOnDelete`: turning anonymous access off must not
// DELETE the live seed from the store. A Secrets Store secret name is unique
// within its store and create does not adopt one, so turning access back on
// must first import the retained secret (`<account_id>/<store_id>/<secret_id>`)
// or delete it — re-declaring the name fails instead of rotating the value.
const secrets = Object.entries(runtimeSecretSources()).map(([name, value]) =>
  new cloudflare.SecretsStoreSecret(`${name}${suffix}`, {
    accountId,
    storeId,
    name: `${name}${suffix}`,
    value,
    scopes: ["workers"],
  }, name === "ANON_ID_SECRET" ? { retainOnDelete: true } : undefined));

export const edgeRuntimeSecretNames = pulumi.all(secrets.map((secret) => secret.name));
