export interface Config {
  /** Port for the local proxy server */
  port: number;
  /** Backend base URL */
  backendUrl: string;
  /** Forced tier override: null = auto */
  forcedTier: "free" | "paid" | null;
}

const backendUrl = process.env.OKX_ROUTER_BACKEND || "";

if (!backendUrl) {
  console.error(
    "FATAL: OKX_ROUTER_BACKEND environment variable is required.",
  );
  console.error(
    "  Set it to your deployed backend URL, e.g.: export OKX_ROUTER_BACKEND=https://api.yourdomain.com",
  );
  process.exit(1);
}

const config: Config = {
  port: parseInt(process.env.OKX_ROUTER_PORT || "8402", 10),
  backendUrl,
  forcedTier: null,
};

export default config;
