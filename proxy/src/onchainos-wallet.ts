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
    const output = execSync("onchainos wallet status", {
      encoding: "utf-8",
      stdio: "pipe",
    });
    const data = JSON.parse(output);
    return {
      loggedIn: data.loggedIn === true,
      address: data.address,
      email: data.email,
      balance: data.balance,
    };
  } catch (err) {
    log.debug("Wallet status check failed:", err);
    return { loggedIn: false };
  }
}

export function walletLogin(email: string): void {
  execSync(`onchainos wallet login ${email}`, { stdio: "inherit" });
}

export function walletLogout(): void {
  execSync("onchainos wallet logout", { stdio: "inherit" });
}
