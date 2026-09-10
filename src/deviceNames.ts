// Two-word default names for devices that never picked one: "Dusty Badger",
// "Sonic Tumbleweed". Playa, festival and nerd flavoured, so the roster reads
// as people rather than as "device-3f9a" — and so two strangers' phones are
// told apart at a glance. Anyone can rename from the name chip in the top bar.

const ADJECTIVES = [
  "Dusty", "Glowing", "Neon", "Sparkly", "Cosmic", "Playa", "Midnight", "Golden",
  "Electric", "Velvet", "Feral", "Radiant", "Sonic", "Lunar", "Solar", "Mirrored",
  "Turbo", "Fuzzy", "Quantum", "Fractal", "Hexadecimal", "Recursive", "Binary",
  "Ultraviolet", "Infrared", "Prismatic", "Nomadic", "Wandering", "Whistling",
  "Humming", "Thumping", "Bass-heavy", "Sub-zero", "Overclocked", "Molten",
  "Glittering", "Shimmering", "Tangerine", "Magenta", "Cobalt", "Copper", "Chrome",
  "Fluffy", "Rowdy", "Sleepy", "Curious", "Fearless", "Sunburnt", "Dawn", "Dusk",
];

const NOUNS = [
  "Badger", "Tumbleweed", "Coyote", "Jackrabbit", "Raven", "Firefly", "Comet",
  "Nebula", "Pulsar", "Quasar", "Meteor", "Aurora", "Dust Devil", "Whiteout",
  "Art Car", "Bicycle", "Lantern", "Mutant Vehicle", "Temple", "Playa Chicken",
  "Dust Bunny", "Disco Ball", "Subwoofer", "Kick Drum", "Hi-hat", "Laser",
  "Fog Machine", "Tesla Coil", "Voxel", "Pixel", "Photon", "Neutrino", "Tardigrade",
  "Axolotl", "Octopus", "Manta Ray", "Narwhal", "Capybara", "Pangolin", "Hedgehog",
  "Robot", "Cyborg", "Wizard", "Pirate", "Unicorn", "Dragon", "Phoenix", "Sphinx",
  "Kaleidoscope", "Hologram", "Waveform", "Oscillator", "Capacitor", "Gyroscope",
];

function pick<T>(list: readonly T[]): T {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return list[bytes[0] % list.length];
}

export function generateDeviceName(): string {
  return `${pick(ADJECTIVES)} ${pick(NOUNS)}`;
}

const NAME_KEY = "empyrean-client-name";
/** Set while the stored name is a generated one nobody has confirmed yet. */
const GENERATED_KEY = "empyrean-client-name-generated";

/** The stored name, minting a two-word default the first time. */
export function loadDeviceName(): string {
  const stored = localStorage.getItem(NAME_KEY);
  if (stored) return stored;
  const minted = generateDeviceName();
  localStorage.setItem(NAME_KEY, minted);
  localStorage.setItem(GENERATED_KEY, "1");
  return minted;
}

/** True until the person has picked (or explicitly kept) a name. */
export function deviceNameUnconfirmed(): boolean {
  return localStorage.getItem(GENERATED_KEY) === "1";
}

export function confirmDeviceName() {
  localStorage.removeItem(GENERATED_KEY);
}
