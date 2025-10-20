import { Crisp } from "crisp-api";

export function makeCrispClient({ identifier, key }) {
  const client = new Crisp();

  // Auth as plugin token
  // The wrapper sets Authorization; we still add X-Crisp-Tier as required.
  client.setTier("plugin"); // adds `X-Crisp-Tier: plugin`

  client.authenticate(identifier, key);

  return client;
}
