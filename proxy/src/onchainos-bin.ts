import { existsSync } from "fs";
import { homedir } from "os";

const FALLBACK_CANDIDATES = [
  `${homedir()}/.local/bin/onchainos`,
  "/opt/homebrew/bin/onchainos",
  "/usr/local/bin/onchainos",
];

export function getOnchainosBin(): string {
  const configured = process.env.ONCHAINOS_BIN;
  if (configured) {
    return configured;
  }

  const fallback = FALLBACK_CANDIDATES.find((candidate) => existsSync(candidate));
  return fallback || "onchainos";
}
