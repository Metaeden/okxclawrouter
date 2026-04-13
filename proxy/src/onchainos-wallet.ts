import { execSync } from "child_process";
import { log } from "./logger.js";

export interface WalletStatus {
  loggedIn: boolean;
  address?: string;
  email?: string;
  balance?: string;
}

export function isOnchainosInstalled(): boolean {
  try {
    execSync("onchainos --version", { encoding: "utf-8", stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export function checkWalletStatus(): WalletStatus {
  try {
    const [statusOut, addrsOut] = [
      execSync("onchainos wallet status", { encoding: "utf-8", stdio: "pipe" }),
      execSync("onchainos wallet addresses", { encoding: "utf-8", stdio: "pipe" }),
    ];
    const status = JSON.parse(statusOut);
    const addrs = JSON.parse(addrsOut);
    const inner = status?.data;
    const xlayerAddr = addrs?.data?.xlayer?.[0]?.address;
    return {
      loggedIn: inner?.loggedIn === true,
      address: xlayerAddr || inner?.evmAddress,
      email: inner?.email,
      balance: undefined,
    };
  } catch (err) {
    log.debug("Wallet status check failed:", err);
    return { loggedIn: false };
  }
}

export function getXLayerUsdcBalance(): string | undefined {
  try {
    const output = execSync("onchainos wallet balance", {
      encoding: "utf-8",
      stdio: "pipe",
    });
    const data = JSON.parse(output);
    const assets = data?.data?.details?.[0]?.tokenAssets || [];
    // X Layer USDC has chainIndex "196"
    const usdc = assets.find((t: any) => t.chainIndex === "196");
    return usdc?.balance;
  } catch {
    return undefined;
  }
}

export function walletLogin(email: string): void {
  execSync(`onchainos wallet login ${email}`, { stdio: "inherit" });
}

export function walletLogout(): void {
  execSync("onchainos wallet logout", { stdio: "inherit" });
}
