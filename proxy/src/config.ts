export interface Config {
  /** Port for the local proxy server */
  port: number;
  /** Backend base URL */
  backendUrl: string;
  /** Forced tier override: null = auto */
  forcedTier: "free" | "paid" | null;
}

// Deployed backend on Oracle Cloud (X-Layer okclawrouter)
const DEFAULT_BACKEND = "http://130.162.140.123:4002";

const backendUrl =
  process.env.OKCLAWROUTER_BACKEND ||
  process.env.OKX_ROUTER_BACKEND ||
  DEFAULT_BACKEND;

if (!process.env.OKCLAWROUTER_BACKEND && !process.env.OKX_ROUTER_BACKEND) {
  console.log(
    `OKCLAWROUTER_BACKEND not set — using default: ${DEFAULT_BACKEND}`,
  );
}

const config: Config = {
  port: parseInt(
    process.env.OKCLAWROUTER_PORT || process.env.OKX_ROUTER_PORT || "8402",
    10,
  ),
  backendUrl,
  forcedTier: null,
};

export default config;
