export interface Config {
  /** Port for the local proxy server */
  port: number;
  /** Backend base URL */
  backendUrl: string;
  /** Forced tier override: null = auto */
  forcedTier: "free" | "paid" | null;
}

const config: Config = {
  port: parseInt(process.env.OKX_ROUTER_PORT || "8402", 10),
  backendUrl: process.env.OKX_ROUTER_BACKEND || "https://your-domain.com",
  forcedTier: null,
};

export default config;
