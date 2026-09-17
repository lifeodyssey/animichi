import { experimental_readRawConfig } from 'wrangler';

export const ENTRIES = { catalog: 'index.js', users: 'index.js', edge: 'entry.js', migrator: 'index.js' };

export function sourceConfig(unit) {
  const config = unit === 'web' ? 'apps/web/wrangler.jsonc' : `workers/${unit}/wrangler.toml`;
  return experimental_readRawConfig({ config }).rawConfig;
}

function sealEnvironment(config, image) {
  const sealed = { ...config };
  delete sealed.build;
  if (sealed.containers) sealed.containers = sealed.containers.map(({ image_build_context, ...container }) => ({ ...container, image }));
  return sealed;
}

function ringContainers(config) {
  return [config, ...Object.values(config.env ?? {})].flatMap((ring) => ring.containers ?? []);
}

// #1606: a unit is sealed with an image exactly when its source still declares a container.
// The edge has none, so the retired agent digest must fail here rather than be dropped —
// that is the regression that would re-create an image no receipt observes.
function requireUsableContainerImage(unit, image, original) {
  const declaresContainer = ringContainers(original).length > 0;
  if (declaresContainer && !/@sha256:[a-f0-9]{64}$/.test(image)) throw new Error('immutable container image required');
  if (!declaresContainer && image !== '') throw new Error(`${unit} declares no container; refusing the image ${image}`);
}

export function sealedConfig(unit, image, original = sourceConfig(unit)) {
  requireUsableContainerImage(unit, image, original);
  const sealed = sealEnvironment(original, image);
  sealed.main = unit === 'web' ? '.output/server/index.mjs' : `bundle/${ENTRIES[unit]}`;
  sealed.env = Object.fromEntries(Object.entries(original.env).map(([name, config]) => [name, sealEnvironment(config, image)]));
  if (unit === 'migrator') Object.assign(sealed, {
    no_bundle: true, find_additional_modules: true, preserve_file_names: true, base_dir: 'bundle',
    rules: [...(original.rules ?? []), { type: 'Text', globs: ['contract.json', 'migrations/**/*'], fallthrough: true }],
  });
  return sealed;
}
